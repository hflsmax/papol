// What Papol requires of a client that talks to it: the schema it was built for.
//
// One number, `schema_version` in schema/sync_registry.json,
// names the data model and the wire that carries it. A Papol client sends
// the one it was compiled with on every request, and the server compares.
// Equal is supported; anything else is a build that cannot be talked to,
// and is told so with a 426 and somewhere to get the build that can. A
// caller that sends no number is not a Papol client and is not gated —
// unless it names itself as the native app in its User-Agent, which a
// build from before the header did, and predating the header means
// predating this schema.

import registry from "../../schema/sync_registry.json";

export const SCHEMA_HEADER = "X-Papol-Schema";
export const AGENT_PREFIX = "Papol macOS/";
export const DOWNLOAD_URL = "https://github.com/hflsmax/papol/releases";

export const SUPPORTED = "supported";
export const INCOMPATIBLE = "incompatible";

export function schemaVersion(): number {
  return registry.schema_version;
}

// The schema this caller was built for, or null for a caller that says nothing.
export function clientSchema(request: Request): number | null {
  const value = request.headers.get(SCHEMA_HEADER);
  if (value === null) return null;
  const announced = Number(value);
  return Number.isInteger(announced) ? announced : -1; // a header nobody can read is not this build's
}

export function verdict(request: Request): string {
  const announced = clientSchema(request);
  if (announced === null) {
    if ((request.headers.get("user-agent") ?? "").includes(AGENT_PREFIX)) return INCOMPATIBLE;
    return SUPPORTED;
  }
  return announced === schemaVersion() ? SUPPORTED : INCOMPATIBLE;
}

// What the server asks of its clients, as the app is told it.
export function requirements() {
  return { schema_version: schemaVersion(), download_url: DOWNLOAD_URL };
}

// The body of a 426: what was refused, and where to go.
export function refusal() {
  return { error: "client_incompatible", ...requirements() };
}
