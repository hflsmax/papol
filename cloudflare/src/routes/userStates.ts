// Small things a user's devices keep for them: where they left each paper,
// and the tips they have seen or dismissed. Each device keeps its own copy
// in its storage, and sends a change here when it can (shared/userState.js);
// here the change made last wins, by when it was made, not by when it
// arrived, so a change sent late from a device that was offline does not
// undo one made since elsewhere. A time ahead of the server's clock is
// taken as now, so a fast clock cannot pin a value.
//
// One rule for every kind; each kind says only what its key and value may be.

import limits from "../../../config/app_limits.json";
import { currentUser } from "../auth";
import { all, batch, one, statement, type Row } from "../db";
import { DIGEST } from "../files";
import { json, readJson, refuse, type Router } from "../http";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export interface Place {
  page: number;
  x: number;
  y: number;
  scale: number;
}

export interface StateChange {
  kind: string;
  key: string;
  value: unknown;
  at: string;
}

const fraction = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

// Where the middle of the viewer was, as fractions of its page, and the zoom.
export function placeOf(value: unknown): Place | null {
  if (!value || typeof value !== "object") return null;
  const { page, x, y, scale } = value as Row;
  if (typeof page !== "number" || !Number.isInteger(page) || page < 1 || page > 100_000) return null;
  if (!fraction(x) || !fraction(y)) return null;
  if (typeof scale !== "number" || !Number.isFinite(scale) || scale <= 0 || scale > 20) return null;
  return { page, x: x as number, y: y as number, scale };
}

// What each kind may hold. A flag is a short word, or null for unset.
const KINDS: Record<string, { key: RegExp; value: (value: unknown) => unknown | undefined }> = {
  place: { key: DIGEST, value: (value) => placeOf(value) ?? undefined },
  flag: {
    key: /^[a-z][a-z0-9_.]{0,63}$/i,
    value: (value) => (value === null || (typeof value === "string" && value.length > 0 && value.length <= 32) ? value : undefined),
  },
};

// A change as a device sent it, or null for one that cannot be true.
export function changeOf(raw: unknown, at = Date.now()): StateChange | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Row;
  const kind = typeof row.kind === "string" ? KINDS[row.kind] : undefined;
  if (!kind || typeof row.key !== "string" || !kind.key.test(row.key)) return null;
  const value = kind.value(row.value);
  if (value === undefined) return null;
  if (typeof row.at !== "string" || row.at.length > 40) return null;
  const made = Date.parse(row.at);
  if (!Number.isFinite(made) || made < at - limits.user_state.age_days_max * DAY_MS) return null;
  const key = row.kind === "place" ? row.key.toLowerCase() : row.key;
  return { kind: row.kind as string, key, value, at: new Date(Math.min(made, at)).toISOString() };
}

const stateOf = (row: { key: string; value: string | null; at: string }) =>
  ({ key: row.key, value: row.value == null ? null : JSON.parse(row.value), at: row.at });

export function userStateRoutes(router: Router) {
  // Changes, each kept only if it was made after the one already held.
  // What cannot be true is let go and counted, so an outbox can empty
  // itself of it.
  router.on("POST", "/api/user-state", async ({ request, env }) => {
    const user = await currentUser(request, env);
    const data = await readJson<Row>(request);
    if (!Array.isArray(data.changes)) refuse(400, "changes must be a list");
    if (data.changes.length > limits.user_state.changes_per_request) {
      refuse(400, `At most ${limits.user_state.changes_per_request} changes at a time`);
    }
    const at = Date.now();
    const valid = data.changes.map((c) => changeOf(c, at)).filter((c): c is StateChange => c != null);
    const papers = [...new Set(valid.filter((c) => c.kind === "place").map((c) => c.key))];
    const known = new Set(papers.length
      ? (await all<{ sha256: string }>(env.DB,
        `SELECT sha256 FROM papers WHERE sha256 IN (${papers.map(() => "?").join(",")})`, ...papers)).map((p) => p.sha256)
      : []);
    const kept = valid.filter((c) => c.kind !== "place" || known.has(c.key));
    const flags = kept.filter((c) => c.kind === "flag").length;
    if (flags) {
      const held = await one<{ n: number }>(env.DB, "SELECT count(*) AS n FROM user_states WHERE user_uuid = ? AND kind = 'flag'", user.uuid);
      if ((held?.n ?? 0) + flags > limits.user_state.flags_max) refuse(400, `At most ${limits.user_state.flags_max} flags`);
    }
    await batch(env.DB, kept.map((c) => statement(env.DB,
      `INSERT INTO user_states (user_uuid, kind, "key", value, at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_uuid, kind, "key") DO UPDATE SET value = excluded.value, at = excluded.at
       WHERE excluded.at > user_states.at`,
      user.uuid, c.kind, c.key, c.value == null ? null : JSON.stringify(c.value), c.at)));
    return json({ recorded: kept.length, skipped: data.changes.length - kept.length });
  });

  // Every flag the user has, as each device asks for them when it opens.
  router.on("GET", "/api/user-state/flag", async ({ request, env }) => {
    const user = await currentUser(request, env);
    const rows = await all<{ key: string; value: string | null; at: string }>(env.DB,
      `SELECT "key", value, at FROM user_states WHERE user_uuid = ? AND kind = 'flag' ORDER BY "key"`, user.uuid);
    return json({ states: rows.map(stateOf) });
  });

  // Where the user left one paper, as the viewer asks when it opens it.
  router.on("GET", "/api/user-state/place/:sha256", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const paper = params.sha256.toLowerCase();
    if (!DIGEST.test(paper)) refuse(404, "Paper not found");
    const row = await one<{ key: string; value: string | null; at: string }>(env.DB,
      `SELECT "key", value, at FROM user_states WHERE user_uuid = ? AND kind = 'place' AND "key" = ?`, user.uuid, paper);
    return json({ state: row ? stateOf(row) : null });
  });
}
