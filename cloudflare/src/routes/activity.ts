// Activity: the time a user spends reading a paper in the viewer. The
// window that saw a stretch of it names it (shared/activity.js) and sends
// it again as it grows; here it is kept, and read back for the user alone.
// Every span is of kind "reading", and its subject is the paper's sha256.

import limits from "../../../config/app_limits.json";
import { currentUser, type User } from "../auth";
import { all, batch, one, statement, type Row } from "../db";
import { DIGEST } from "../files";
import { json, readJson, refuse, type Router } from "../http";

const KIND = "reading";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

interface Span {
  uuid: string;
  kind: typeof KIND;
  subject: string;
  started_at: string;
  ended_at: string;
  seconds: number;
}

function instant(value: unknown): number | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
}

// One span as a window sent it, or null for one that cannot be true: not a
// paper's, ending before it starts, longer than a span is let run, holding
// more time than it lasted, not happened yet, or older than any outbox
// keeps. (A board's span, from before boards stopped being recorded, is not
// a paper's.)
export function spanOf(value: unknown, at = Date.now()): Span | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Row;
  if (row.kind !== KIND) return null;
  const uuid = String(row.uuid ?? "").toLowerCase();
  const subject = String(row.subject ?? "").toLowerCase();
  if (!UUID.test(uuid) || !DIGEST.test(subject)) return null;
  const started = instant(row.started_at), ended = instant(row.ended_at);
  if (started == null || ended == null || ended < started) return null;
  if (ended - started > limits.activity.span_max_ms + MINUTE_MS) return null;
  if (ended > at + 5 * MINUTE_MS || started < at - limits.activity.span_age_days_max * DAY_MS) return null;
  const seconds = row.seconds;
  if (typeof seconds !== "number" || !Number.isInteger(seconds) || seconds < 0) return null;
  if (seconds > Math.ceil((ended - started) / 1000) + 5) return null;
  return { uuid, kind: KIND, subject, started_at: new Date(started).toISOString(), ended_at: new Date(ended).toISOString(), seconds };
}

const marks = (list: string[]) => list.map(() => "?").join(",");

// A user's total time on each paper, with when it last was.
export async function effortByPaper(db: D1Database, userUuid: string): Promise<Map<string, { seconds: number; last_at: string }>> {
  const rows = await all<{ subject: string; seconds: number; last_at: string }>(db,
    "SELECT subject, sum(seconds) AS seconds, max(ended_at) AS last_at FROM activity WHERE user_uuid = ? GROUP BY subject", userUuid);
  return new Map(rows.map((r) => [r.subject, { seconds: r.seconds, last_at: r.last_at }]));
}

export function activityRoutes(router: Router) {
  // Spans, new or grown. What cannot be true, or names a paper Papol does
  // not have, is let go and counted: an outbox must be able to empty itself
  // of it.
  router.on("POST", "/api/activity", async ({ request, env }) => {
    const user: User = await currentUser(request, env);
    const data = await readJson<Row>(request);
    if (!Array.isArray(data.spans)) refuse(400, "spans must be a list");
    if (data.spans.length > limits.activity.spans_per_request) refuse(400, `At most ${limits.activity.spans_per_request} spans at a time`);
    const at = Date.now();
    const valid = data.spans.map((s) => spanOf(s, at)).filter((s): s is Span => s != null);
    const named = [...new Set(valid.map((s) => s.subject))];
    const known = new Set(named.length
      ? (await all<{ sha256: string }>(env.DB, `SELECT sha256 FROM papers WHERE sha256 IN (${marks(named)})`, ...named)).map((p) => p.sha256)
      : []);
    const kept = valid.filter((s) => known.has(s.subject));
    // A span only ever grows, and only for the user and paper it was first
    // sent for; a uuid someone else already holds is left alone.
    await batch(env.DB, kept.map((s) => statement(env.DB,
      `INSERT INTO activity (uuid, user_uuid, kind, subject, started_at, ended_at, seconds) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (uuid) DO UPDATE SET ended_at = excluded.ended_at, seconds = excluded.seconds
       WHERE activity.user_uuid = excluded.user_uuid AND activity.subject = excluded.subject
         AND excluded.seconds >= activity.seconds`,
      s.uuid, user.uuid, s.kind, s.subject, s.started_at, s.ended_at, s.seconds)));
    return json({ recorded: kept.length, skipped: data.spans.length - kept.length });
  });

  // The spans that fall in [from, to), and what each paper is called. The
  // client asks for its own calendar's day, week or month and lays the
  // spans out in its own time zone. Only the user sees their own.
  router.on("GET", "/api/activity", async ({ request, env, url }) => {
    const user = await currentUser(request, env);
    const from = instant(url.searchParams.get("from")), to = instant(url.searchParams.get("to"));
    if (from == null || to == null || to <= from) refuse(400, "from and to must be times, from before to");
    if (to - from > limits.activity.range_days_max * DAY_MS) refuse(400, `At most ${limits.activity.range_days_max} days at a time`);
    const spans = await all<Span>(env.DB,
      `SELECT subject, started_at, ended_at, seconds FROM activity
       WHERE user_uuid = ? AND started_at < ? AND ended_at > ? ORDER BY started_at, uuid`,
      user.uuid, new Date(to).toISOString(), new Date(from).toISOString());
    const named = [...new Set(spans.map((s) => s.subject))];
    const papers: Record<string, { title: string; in_nook: boolean }> = {};
    if (named.length) {
      for (const p of await all<{ sha256: string; title: string; in_nook: number }>(env.DB,
        `SELECT p.sha256, p.title, EXISTS (SELECT 1 FROM copies c WHERE c.paper_sha256 = p.sha256 AND c.user_uuid = ? AND c.deleted_at IS NULL) AS in_nook
         FROM papers p WHERE p.sha256 IN (${marks(named)})`, user.uuid, ...named)) {
        papers[p.sha256] = { title: p.title, in_nook: Boolean(p.in_nook) };
      }
    }
    const first = await one<{ at: string | null }>(env.DB, "SELECT min(started_at) AS at FROM activity WHERE user_uuid = ?", user.uuid);
    return json({ spans, papers, first_at: first?.at ?? null });
  });

  // One paper's effort, for the window its line on the nook opens: every
  // second ever spent on it, when that began and last was, and the spans of
  // the last weeks the window draws.
  router.on("GET", "/api/activity/paper/:sha256", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const subject = params.sha256.toLowerCase();
    if (!DIGEST.test(subject)) refuse(404, "Not found");
    const total = await one<{ seconds: number | null; first_at: string | null; last_at: string | null }>(env.DB,
      "SELECT sum(seconds) AS seconds, min(started_at) AS first_at, max(ended_at) AS last_at FROM activity WHERE user_uuid = ? AND subject = ?",
      user.uuid, subject);
    const since = new Date(Date.now() - limits.activity.recent_days * DAY_MS).toISOString();
    const spans = await all<Span>(env.DB,
      `SELECT started_at, ended_at, seconds FROM activity
       WHERE user_uuid = ? AND subject = ? AND ended_at > ? ORDER BY started_at, uuid`,
      user.uuid, subject, since);
    return json({ sha256: subject, seconds: total?.seconds ?? 0, first_at: total?.first_at ?? null, last_at: total?.last_at ?? null, spans });
  });
}
