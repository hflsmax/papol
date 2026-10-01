// A heartbeat, not a session ledger. Clients renew it while Papol is visible;
// project responses decide whether it is recent enough to call someone online.

import { currentUser } from "../auth";
import { now, statement } from "../db";
import { json, type Router } from "../http";

export function presenceRoutes(router: Router) {
  router.on("POST", "/api/presence", async ({ request, env }) => {
    const user = await currentUser(request, env);
    const seenAt = now();
    await statement(env.DB,
      `INSERT INTO user_presence (user_uuid, last_seen_at) VALUES (?, ?)
       ON CONFLICT(user_uuid) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
      user.uuid, seenAt).run();
    return json({ seen_at: seenAt });
  });
}
