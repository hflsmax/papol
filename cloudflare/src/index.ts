// Papol's backend as a Worker. The routes are added as they are ported
// (docs/cloud-migration.md, phase 4); what is not here yet is not here.

import { requirements, verdict } from "./clientRequirements";
import { json, Router } from "./http";
import { consume, digestIfDue, sweep, type Wakeup } from "./jobs/run";
import { authRoutes } from "./routes/auth";
import { boardRoutes } from "./routes/boards";
import { jobRoutes } from "./routes/jobs";
import { getBlob, headBlob, putBlob } from "./sync/blobs";
import { pull, snapshot } from "./sync/pull";
import { push } from "./sync/push";

const router = new Router();

// Deliberately unauthenticated: a user who is signed out, or whose
// credential was just refused, is the one most likely to be holding a
// build that can no longer sign in, and they still need to be told.
router.on("GET", "/api/client-requirements", ({ request }) => json({ ...requirements(), verdict: verdict(request) }));

authRoutes(router);
jobRoutes(router);
boardRoutes(router);

router.on("POST", "/api/sync/push", push);
router.on("GET", "/api/sync/snapshot", snapshot);
router.on("GET", "/api/sync/pull", pull);
router.on("HEAD", "/api/sync/blobs/:sha256", headBlob);
router.on("PUT", "/api/sync/blobs/:sha256", putBlob);
router.on("GET", "/api/sync/blobs/:sha256", getBlob);

export const SWEEP_CRON = "*/2 * * * *";
export const HOURLY_CRON = "0 * * * *";

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return router.handle(request, env);
  },

  // A wake-up for a job the API just wrote.
  queue(batch: MessageBatch<Wakeup>, env: Env, _ctx: ExecutionContext): Promise<void> {
    return consume(batch, env);
  },

  // Every two minutes, what nobody was woken for; every hour, the digest
  // if it is its hour.
  async scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    if (controller.cron === HOURLY_CRON) await digestIfDue(env, new Date(controller.scheduledTime));
    else await sweep(env);
  },
} satisfies ExportedHandler<Env, Wakeup>;
