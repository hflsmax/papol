// Papol's backend as a Worker. The routes are added as they are ported
// (docs/cloud-migration.md, phase 4); what is not here yet is not here.

import { requirements, verdict } from "./clientRequirements";

export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Deliberately unauthenticated: a user who is signed out, or whose
    // credential was just refused, is the one most likely to be holding a
    // build that can no longer sign in, and they still need to be told.
    if (url.pathname === "/api/client-requirements" && request.method === "GET") {
      return json({ ...requirements(), verdict: verdict(request) });
    }

    return json({ detail: "Not Found" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
