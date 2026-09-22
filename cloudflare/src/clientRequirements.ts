// What Papol requires of a client that talks to it: the schema it was built
// for, and, of the desktop app, a build that speaks to the bucket itself.
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
//
// The desktop app also names its version in that User-Agent, and a build
// older than MINIMUM_DESKTOP_VERSION is refused too: it would send its
// files through routes this Worker no longer has (phase 5, step 15).

import registry from "../../schema/sync_registry.json";

export const SCHEMA_HEADER = "X-Papol-Schema";
export const AGENT_PREFIX = "Papol macOS/";
export const DOWNLOAD_URL = "https://github.com/hflsmax/papol/releases";
export const MINIMUM_DESKTOP_VERSION = "0.5.0";

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

// The desktop build's version as its User-Agent states it, or null for
// any other caller.
export function desktopVersion(request: Request): string | null {
  const agent = request.headers.get("user-agent") ?? "";
  const start = agent.indexOf(AGENT_PREFIX);
  if (start < 0) return null;
  return agent.slice(start + AGENT_PREFIX.length).split(/\s+/)[0] || "";
}

// Whether a version reads as at least the minimum: numbers compared in
// order, a missing part being zero, and anything unreadable being older.
export function atLeast(version: string, minimum: string): boolean {
  const parts = (v: string) => v.split(".").map((p) => Number.parseInt(p, 10));
  const a = parts(version), b = parts(minimum);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0;
    if (!Number.isInteger(x)) return false;
    if (x !== y) return x > y;
  }
  return true;
}

export function verdict(request: Request): string {
  const announced = clientSchema(request);
  const desktop = desktopVersion(request);
  if (desktop !== null && !atLeast(desktop, MINIMUM_DESKTOP_VERSION)) return INCOMPATIBLE;
  if (announced === null) return SUPPORTED;
  return announced === schemaVersion() ? SUPPORTED : INCOMPATIBLE;
}

// What the server asks of its clients, as the app is told it, and where
// the files are: the bucket's own address, or null when this Worker
// serves them itself.
export function requirements(env?: Env) {
  return {
    schema_version: schemaVersion(), download_url: DOWNLOAD_URL, minimum_desktop_version: MINIMUM_DESKTOP_VERSION,
    files_url: env?.FILES_URL ? env.FILES_URL.replace(/\/+$/, "") : null,
  };
}

// The body of a 426: what was refused, and where to go.
export function refusal() {
  return { error: "client_incompatible", ...requirements() };
}
