// Refuse a build this server can no longer speak to.
//
// 426 rather than one more 400: the request was well formed and the
// credential was good, and what is wrong is the program that sent it. The
// client recognizes this status specifically — it stops and tells its
// user — so it must never be folded in with ordinary refusals.

import { AGENT_PREFIX, INCOMPATIBLE, refusal, verdict } from "../clientRequirements";
import { refuse } from "../http";

export function requireSupportedClient(request: Request): void {
  if (verdict(request) === INCOMPATIBLE) refuse(426, refusal());
}

// The client announces itself as "Papol macOS/0.3.0"; the version is kept
// on its sync row so that who runs what can be read off the table.
// Anything else is some other caller and records nothing.
export function appVersion(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const start = userAgent.indexOf(AGENT_PREFIX);
  if (start < 0) return null;
  const rest = userAgent.slice(start + AGENT_PREFIX.length).split(/\s+/);
  return rest[0] || null;
}
