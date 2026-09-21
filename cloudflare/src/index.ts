// Papol's backend as a Worker. The routes are added as they are ported
// (docs/cloud-migration.md, phase 4); what is not here yet is not here.

import { requirements, verdict } from "./clientRequirements";
import { json, Router } from "./http";
import { consume, digestIfDue, sweep, type Wakeup } from "./jobs/run";
import { accountRoutes } from "./routes/account";
import { adminRoutes } from "./routes/admin";
import { annotationRoutes } from "./routes/annotations";
import { authRoutes } from "./routes/auth";
import { boardRoutes } from "./routes/boards";
import { inboxRoutes } from "./routes/inbox";
import { jobRoutes } from "./routes/jobs";
import { nookRoutes } from "./routes/nook";
import { paperRoutes } from "./routes/papers";
import { referenceRoutes } from "./routes/references";
import { roomRoutes } from "./routes/rooms";
import { sharableRoutes } from "./routes/sharables";
import { getBlob, headBlob, putBlob } from "./sync/blobs";
import { pull, snapshot } from "./sync/pull";
import { push } from "./sync/push";

// What no route claims is the website: the main frontend's files and,
// for any clean path, its document (History API routing). An unknown
// API or upload path is an error, not a page.
const router = new Router(({ request, env, url }) => {
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/uploads/")) return json({ detail: "Not Found" }, { status: 404 });
  return env.ASSETS.fetch(request);
});

// A board is its own full-screen app with its own build, served under
// /boards; its document answers for every board's URL.
router.on("GET", "/boards/:uuid", ({ request, env, url }) => env.ASSETS.fetch(new Request(`${url.origin}/boards/`, request)));

// Deliberately unauthenticated: a user who is signed out, or whose
// credential was just refused, is the one most likely to be holding a
// build that can no longer sign in, and they still need to be told.
router.on("GET", "/api/client-requirements", ({ request }) => json({ ...requirements(), verdict: verdict(request) }));

authRoutes(router);
accountRoutes(router);
jobRoutes(router);
boardRoutes(router);
nookRoutes(router);
paperRoutes(router);
annotationRoutes(router);
roomRoutes(router);
inboxRoutes(router);
sharableRoutes(router);
adminRoutes(router);
referenceRoutes(router);

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
    // Only over HTTPS: a page loaded over plain HTTP is an insecure
    // context, where the browser withholds crypto.randomUUID and the
    // apps cannot mint an id.
    const url = new URL(request.url);
    if (url.protocol === "http:") {
      url.protocol = "https:";
      return Promise.resolve(Response.redirect(url.toString(), 301));
    }
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
