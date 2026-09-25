// Activity: the time a user spends with a paper open in the viewer, or
// one of their boards open, while it is in front of them and in use. The
// window that saw a stretch of it names it (shared/activity.js) and sends
// it again as it grows; here it is kept, and read back for the user alone.

import limits from "../../../config/app_limits.json";
import { currentUser, type User } from "../auth";
import { all, batch, one, statement, type Row } from "../db";
import { DIGEST } from "../files";
import { json, readJson, refuse, type Router } from "../http";

export const ACTIVITY_KINDS = ["reading", "board"] as const;
type Kind = (typeof ACTIVITY_KINDS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

interface Span {
  uuid: string;
  kind: Kind;
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

// One span as a window sent it, or null for one that cannot be true: a
// span that ends before it starts, is longer than a span is let run,
// holds more time than it lasted, has not happened yet, or is older than
// any outbox keeps.
export function spanOf(value: unknown, at = Date.now()): Span | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Row;
  const kind = row.kind as Kind;
  if (!ACTIVITY_KINDS.includes(kind)) return null;
  const uuid = String(row.uuid ?? "").toLowerCase();
  const subject = String(row.subject ?? "").toLowerCase();
  if (!UUID.test(uuid) || !(kind === "reading" ? DIGEST : UUID).test(subject)) return null;
  const started = instant(row.started_at), ended = instant(row.ended_at);
  if (started == null || ended == null || ended < started) return null;
  if (ended - started > limits.activity.span_max_ms + MINUTE_MS) return null;
  if (ended > at + 5 * MINUTE_MS || started < at - limits.activity.span_age_days_max * DAY_MS) return null;
  const seconds = row.seconds;
  if (typeof seconds !== "number" || !Number.isInteger(seconds) || seconds < 0) return null;
  if (seconds > Math.ceil((ended - started) / 1000) + 5) return null;
  return { uuid, kind, subject, started_at: new Date(started).toISOString(), ended_at: new Date(ended).toISOString(), seconds };
}

// Of the subjects named, the ones this user may spend time on: any paper
// Papol has, and their own boards.
async function knownSubjects(env: Env, user: User, spans: Span[]): Promise<Set<string>> {
  const known = new Set<string>();
  const papers = [...new Set(spans.filter((s) => s.kind === "reading").map((s) => s.subject))];
  const boards = [...new Set(spans.filter((s) => s.kind === "board").map((s) => s.subject))];
  const marks = (list: string[]) => list.map(() => "?").join(",");
  if (papers.length) {
    for (const p of await all<{ sha256: string }>(env.DB, `SELECT sha256 FROM papers WHERE sha256 IN (${marks(papers)})`, ...papers)) known.add(`reading:${p.sha256}`);
  }
  if (boards.length) {
    for (const b of await all<{ uuid: string }>(env.DB, `SELECT uuid FROM boards WHERE user_uuid = ? AND uuid IN (${marks(boards)})`, user.uuid, ...boards)) known.add(`board:${b.uuid}`);
  }
  return known;
}

// A user's total time on each paper and board, with when it last was.
export async function effortBySubject(db: D1Database, userUuid: string): Promise<Map<string, { seconds: number; last_at: string }>> {
  const rows = await all<{ kind: string; subject: string; seconds: number; last_at: string }>(db,
    "SELECT kind, subject, sum(seconds) AS seconds, max(ended_at) AS last_at FROM activity WHERE user_uuid = ? GROUP BY kind, subject", userUuid);
  return new Map(rows.map((r) => [`${r.kind}:${r.subject}`, { seconds: r.seconds, last_at: r.last_at }]));
}

export function activityRoutes(router: Router) {
  // Spans, new or grown. What cannot be true, or names a paper Papol does
  // not have or a board that is not theirs, is let go and counted: an
  // outbox must be able to empty itself of it.
  router.on("POST", "/api/activity", async ({ request, env }) => {
    const user = await currentUser(request, env);
    const data = await readJson<Row>(request);
    if (!Array.isArray(data.spans)) refuse(400, "spans must be a list");
    if (data.spans.length > limits.activity.spans_per_request) refuse(400, `At most ${limits.activity.spans_per_request} spans at a time`);
    const at = Date.now();
    const valid = data.spans.map((s) => spanOf(s, at)).filter((s): s is Span => s != null);
    const known = await knownSubjects(env, user, valid);
    const kept = valid.filter((s) => known.has(`${s.kind}:${s.subject}`));
    // A span only ever grows, and only for the user, paper or board it
    // was first sent for; a uuid someone else already holds is left alone.
    await batch(env.DB, kept.map((s) => statement(env.DB,
      `INSERT INTO activity (uuid, user_uuid, kind, subject, started_at, ended_at, seconds) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (uuid) DO UPDATE SET ended_at = excluded.ended_at, seconds = excluded.seconds
       WHERE activity.user_uuid = excluded.user_uuid AND activity.kind = excluded.kind AND activity.subject = excluded.subject
         AND excluded.seconds >= activity.seconds`,
      s.uuid, user.uuid, s.kind, s.subject, s.started_at, s.ended_at, s.seconds)));
    return json({ recorded: kept.length, skipped: data.spans.length - kept.length });
  });

  // The spans that fall in [from, to), and what each paper and board is
  // called. The client asks for its own calendar's day, week or month and
  // lays the spans out in its own time zone. Only the user sees their own.
  router.on("GET", "/api/activity", async ({ request, env, url }) => {
    const user = await currentUser(request, env);
    const from = instant(url.searchParams.get("from")), to = instant(url.searchParams.get("to"));
    if (from == null || to == null || to <= from) refuse(400, "from and to must be times, from before to");
    if (to - from > limits.activity.range_days_max * DAY_MS) refuse(400, `At most ${limits.activity.range_days_max} days at a time`);
    const spans = await all<Span>(env.DB,
      `SELECT kind, subject, started_at, ended_at, seconds FROM activity
       WHERE user_uuid = ? AND started_at < ? AND ended_at > ? ORDER BY started_at, uuid`,
      user.uuid, new Date(to).toISOString(), new Date(from).toISOString());
    const marks = (list: string[]) => list.map(() => "?").join(",");
    const paperKeys = [...new Set(spans.filter((s) => s.kind === "reading").map((s) => s.subject))];
    const boardKeys = [...new Set(spans.filter((s) => s.kind === "board").map((s) => s.subject))];
    const papers: Record<string, { title: string; in_nook: boolean }> = {};
    if (paperKeys.length) {
      for (const p of await all<{ sha256: string; title: string; in_nook: number }>(env.DB,
        `SELECT p.sha256, p.title, EXISTS (SELECT 1 FROM copies c WHERE c.paper_sha256 = p.sha256 AND c.user_uuid = ? AND c.deleted_at IS NULL) AS in_nook
         FROM papers p WHERE p.sha256 IN (${marks(paperKeys)})`, user.uuid, ...paperKeys)) {
        papers[p.sha256] = { title: p.title, in_nook: Boolean(p.in_nook) };
      }
    }
    const boards: Record<string, { name: string; deleted: boolean }> = {};
    if (boardKeys.length) {
      for (const b of await all<{ uuid: string; name: string; deleted_at: string | null }>(env.DB,
        `SELECT uuid, name, deleted_at FROM boards WHERE user_uuid = ? AND uuid IN (${marks(boardKeys)})`, user.uuid, ...boardKeys)) {
        boards[b.uuid] = { name: b.name, deleted: b.deleted_at != null };
      }
    }
    const first = await one<{ at: string | null }>(env.DB, "SELECT min(started_at) AS at FROM activity WHERE user_uuid = ?", user.uuid);
    return json({ spans, papers, boards, first_at: first?.at ?? null });
  });

  // One paper's or board's effort, for the window its line on the nook
  // opens: every second ever spent on it, when that began and last was,
  // and the spans of the last weeks the window draws.
  router.on("GET", "/api/activity/:kind/:subject", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const kind = params.kind as Kind, subject = params.subject.toLowerCase();
    if (!ACTIVITY_KINDS.includes(kind) || !(kind === "reading" ? DIGEST : UUID).test(subject)) refuse(404, "Not found");
    const total = await one<{ seconds: number | null; first_at: string | null; last_at: string | null }>(env.DB,
      "SELECT sum(seconds) AS seconds, min(started_at) AS first_at, max(ended_at) AS last_at FROM activity WHERE user_uuid = ? AND kind = ? AND subject = ?",
      user.uuid, kind, subject);
    const since = new Date(Date.now() - limits.activity.recent_days * DAY_MS).toISOString();
    const spans = await all<Span>(env.DB,
      `SELECT started_at, ended_at, seconds FROM activity
       WHERE user_uuid = ? AND kind = ? AND subject = ? AND ended_at > ? ORDER BY started_at, uuid`,
      user.uuid, kind, subject, since);
    return json({ kind, subject, seconds: total?.seconds ?? 0, first_at: total?.first_at ?? null, last_at: total?.last_at ?? null, spans });
  });
}
