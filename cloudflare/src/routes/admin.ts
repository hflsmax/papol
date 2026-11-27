// The admin pages: every report, the emails sent and announcements to
// send, the tables as they are, and one raw statement at a time. What the database is made of is asked of the
// database, not of a model held beside it.

import limits from "../../../config/app_limits.json";
import { all, one, type Row } from "../db";
import { json, readJson, refuse, type Router } from "../http";
import { mailConfigured, sentEmail, sentEmails, type SentEmail } from "../jobs/mail";
import { queueAnnouncement } from "../jobs/notifications";
import { wake } from "../jobs/queue";
import * as validate from "../validate";
import { audienceOf, feedbackOut, requireAdmin } from "./inbox";

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RETURNS_ROWS = /^\s*(select|with|pragma|explain|values)\b/i;

interface Column { name: string; type: string; pk: number }

// The tables this schema declares. SQLite's own and D1's bookkeeping
// tables are not part of Papol.
async function tableNames(db: D1Database): Promise<string[]> {
  const rows = await all<{ name: string }>(db,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name != 'd1_migrations' ORDER BY name");
  return rows.map((r) => r.name);
}

async function columnsOf(db: D1Database, table: string): Promise<Column[]> {
  if (!NAME.test(table) || !(await tableNames(db)).includes(table)) refuse(404, "Table not found");
  return all<Column>(db, `PRAGMA table_info("${table}")`);
}

function singleKey(columns: Column[]): Column {
  const keys = columns.filter((c) => c.pk > 0);
  if (keys.length !== 1) refuse(400, "Table has no single-column primary key");
  return keys[0];
}

// A value typed into the admin UI, as the column's affinity would store
// it. Nothing typed is null; a number typed for a numeric column is a
// number; a date stays the ISO string every date here is.
function coerce(column: Column, value: unknown): unknown {
  if (value === null || value === "") return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value !== "string") return value;
  const affinity = column.type.toUpperCase();
  if (/INT|BOOL/.test(affinity)) {
    const n = Number(value);
    if (!Number.isInteger(n)) refuse(400, `Invalid value for ${column.name}`);
    return n;
  }
  if (/REAL|FLOA|DOUB|NUM|DEC/.test(affinity)) {
    const n = Number(value);
    if (Number.isNaN(n)) refuse(400, `Invalid value for ${column.name}`);
    return n;
  }
  return value;
}

// Emails sent within this long of each other, to the same subject from
// the same sender, are one send: an announcement's copies, one per
// recipient, arrive in Resend's record seconds apart.
const SEND_WINDOW_MS = 10 * 60 * 1000;

export interface Send {
  subject: string;
  from: string;
  sent_at: string;
  emails: { id: string; to: string; status: string | null }[];
}

// Resend's record, newest first, gathered into sends.
export function groupSends(emails: SentEmail[]): Send[] {
  const sends: Send[] = [];
  const time = (at: string) => Date.parse(at.replace(" ", "T").replace(/\+00$/, "Z"));
  for (const email of emails) {
    const last = sends[sends.length - 1];
    const copy = { id: email.id, to: email.to.join(", "), status: email.last_event };
    if (last && last.subject === email.subject && last.from === email.from && time(last.sent_at) - time(email.created_at) <= SEND_WINDOW_MS) {
      last.emails.push(copy);
      last.sent_at = email.created_at;
    } else {
      sends.push({ subject: email.subject, from: email.from, sent_at: email.created_at, emails: [copy] });
    }
  }
  return sends;
}

// Who has been using Papol lately, and who has just come: the open
// accounts last seen within a window, most recent first, and the ones made
// within another, newest first, each with what they have made. Seen is the
// latest of a signed-in request (auth_tokens.last_used_at, written at most
// once a minute), the visible-tab heartbeat (user_presence) and the end of
// a stretch of reading (activity).
const USER_ROWS = 100;
const DAYS_MAX = 365;

function days(value: string | null, fallback: number): number {
  if (value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > DAYS_MAX) refuse(400, `Days must be a whole number from 1 to ${DAYS_MAX}`);
  return n;
}

// Every date here is an ISO string, some written without their Z; julianday
// reads both, and strftime writes the one form back.
const SEEN = `SELECT user_uuid, max(at) AS at FROM (
    SELECT user_uuid, julianday(last_used_at) AS at FROM auth_tokens WHERE last_used_at IS NOT NULL
    UNION ALL SELECT user_uuid, julianday(last_seen_at) FROM user_presence
    UNION ALL SELECT user_uuid, julianday(max(ended_at)) FROM activity GROUP BY user_uuid
  ) GROUP BY user_uuid`;

const USER_STATS = `u.uuid, u.display_name, u.email, u.affiliation, u.avatar_path, u.is_admin,
    strftime('%Y-%m-%dT%H:%M:%SZ', u.created_at) AS created_at,
    strftime('%Y-%m-%dT%H:%M:%SZ', seen.at) AS last_active_at,
    (SELECT platform FROM auth_tokens t WHERE t.user_uuid = u.uuid AND t.last_used_at IS NOT NULL ORDER BY julianday(t.last_used_at) DESC LIMIT 1) AS platform,
    (SELECT count(*) FROM copies c WHERE c.user_uuid = u.uuid AND c.deleted_at IS NULL AND c.kept) AS papers,
    (SELECT count(*) FROM digs d WHERE d.user_uuid = u.uuid) AS digs,
    (SELECT count(*) FROM annotations a WHERE a.user_uuid = u.uuid AND a.kind = 'anchor' AND a.deleted_at IS NULL) AS anchors,
    (SELECT coalesce(sum(seconds), 0) FROM activity r WHERE r.user_uuid = u.uuid AND julianday(r.started_at) >= julianday('now', ?)) AS reading_recent_seconds,
    (SELECT coalesce(sum(seconds), 0) FROM activity r WHERE r.user_uuid = u.uuid) AS reading_seconds,
    (SELECT count(*) FROM friendships f WHERE f.state = 'friends' AND u.uuid IN (f.asker_uuid, f.asked_uuid)) AS friends,
    (SELECT count(*) FROM project_members m JOIN projects p ON p.uuid = m.project_uuid AND p.deleted_at IS NULL WHERE m.user_uuid = u.uuid) AS projects`;

export async function recentUsers(db: D1Database, activeDays: number, newDays: number) {
  const recent = `-${activeDays} days`;
  const [active, joined, totals] = await Promise.all([
    all<Row>(db, `SELECT ${USER_STATS} FROM users u JOIN (${SEEN}) seen ON seen.user_uuid = u.uuid
      WHERE u.deleted_at IS NULL AND seen.at >= julianday('now', ?) ORDER BY seen.at DESC, u.uuid LIMIT ?`, recent, recent, USER_ROWS),
    all<Row>(db, `SELECT ${USER_STATS} FROM users u LEFT JOIN (${SEEN}) seen ON seen.user_uuid = u.uuid
      WHERE u.deleted_at IS NULL AND julianday(u.created_at) >= julianday('now', ?) ORDER BY julianday(u.created_at) DESC, u.uuid LIMIT ?`, recent, `-${newDays} days`, USER_ROWS),
    one<{ users: number; active: number; joined: number }>(db, `SELECT count(*) AS users,
      coalesce(sum(seen.at >= julianday('now', ?)), 0) AS active,
      coalesce(sum(julianday(u.created_at) >= julianday('now', ?)), 0) AS joined
      FROM users u LEFT JOIN (${SEEN}) seen ON seen.user_uuid = u.uuid WHERE u.deleted_at IS NULL`, recent, `-${newDays} days`),
  ]);
  const out = (r: Row) => ({ ...r, is_admin: Boolean(r.is_admin) });
  return {
    active_days: activeDays, new_days: newDays,
    total_users: totals?.users ?? 0, active_count: totals?.active ?? 0, new_count: totals?.joined ?? 0,
    active: active.map(out), new: joined.map(out),
  };
}

export function adminRoutes(router: Router) {
  // The users seen lately and the users new lately, with their numbers.
  router.on("GET", "/api/admin/users", async ({ request, env, url }) => {
    await requireAdmin(request, env);
    return json(await recentUsers(env.DB, days(url.searchParams.get("active_days"), 7), days(url.searchParams.get("new_days"), 30)));
  });

  // Email an announcement to every open account, to the ones picked, or,
  // as a test, to the admin alone. One job sends every copy.
  router.on("POST", "/api/admin/announcements", async ({ request, env }) => {
    const admin = await requireAdmin(request, env);
    const data = await readJson<Row>(request);
    const check = validate.checking();
    const subject = check.string("subject", data.subject, { min: 1, max: limits.text.announcement_subject });
    const body = check.string("body", data.body, { min: 1, max: limits.text.announcement_body });
    const test = check.boolean("test", data.test ?? false);
    if (data.user_uuids !== undefined && data.user_uuids !== null && (!Array.isArray(data.user_uuids) || !data.user_uuids.length)) check.fail("user_uuids must name at least one user");
    check.done();
    if (!subject!.trim() || !body!.trim()) refuse(400, "An announcement needs a subject and a body");
    const to = test ? [admin.email] : (await audienceOf(env, data.user_uuids)).map((r) => r.email);
    const job = queueAnnouncement(env.DB, to, subject!.trim(), body!.trim());
    await job.statement.run();
    await wake(env, [job.uuid]);
    return json({ job: job.uuid, recipient_count: to.length });
  });

  // Every email Papol has sent — announcements, digests, feedback — as
  // Resend recorded it, gathered into sends.
  router.on("GET", "/api/admin/emails", async ({ request, env }) => {
    await requireAdmin(request, env);
    if (!mailConfigured(env)) return json({ configured: false, from: null, sends: [] });
    return json({ configured: true, from: env.EMAIL_FROM, sends: groupSends(await sentEmails(env)) });
  });

  // What one email said.
  router.on("GET", "/api/admin/emails/:id", async ({ request, env, params }) => {
    await requireAdmin(request, env);
    if (!mailConfigured(env)) refuse(404, "Email is not configured");
    return json(await sentEmail(env, params.id));
  });

  // Every bug report and feature request, the open ones first, newest first.
  router.on("GET", "/api/admin/feedback", async ({ request, env }) => {
    await requireAdmin(request, env);
    const rows = await all<Row>(env.DB, "SELECT f.*, u.uuid AS u_uuid, u.display_name, u.affiliation, u.avatar_path, u.email FROM feedback f LEFT JOIN users u ON u.uuid = f.user_uuid ORDER BY f.resolved, f.created_at DESC, f.uuid DESC");
    return json(rows.map((fb) => feedbackOut(fb, fb.u_uuid ? { ...fb, uuid: fb.u_uuid } : null)));
  });

  // Mark a report done, or reopen it.
  router.on("PUT", "/api/admin/feedback/:uuid", async ({ request, env, params }) => {
    await requireAdmin(request, env);
    const data = await readJson<{ resolved?: unknown }>(request);
    const check = validate.checking();
    const resolved = check.boolean("resolved", data.resolved);
    check.done();
    const fb = await one<Row>(env.DB, "SELECT * FROM feedback WHERE uuid = ?", params.uuid);
    if (!fb) refuse(404, "Report not found");
    fb.resolved = resolved ? 1 : 0;
    await env.DB.prepare("UPDATE feedback SET resolved = ? WHERE uuid = ?").bind(fb.resolved, fb.uuid).run();
    const user = fb.user_uuid ? await one<Row>(env.DB, "SELECT * FROM users WHERE uuid = ?", fb.user_uuid) : null;
    return json(feedbackOut(fb, user));
  });

  router.on("GET", "/api/admin/tables", async ({ request, env }) => {
    await requireAdmin(request, env);
    return json({ tables: await tableNames(env.DB) });
  });

  router.on("GET", "/api/admin/tables/:table", async ({ request, env, params }) => {
    await requireAdmin(request, env);
    const columns = await columnsOf(env.DB, params.table);
    const rows = await all<Row>(env.DB, `SELECT * FROM "${params.table}" LIMIT ?`, limits.counts.admin_table_rows);
    return json({ columns: columns.map((c) => c.name), primary_key: columns.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name), rows });
  });

  router.on("PUT", "/api/admin/tables/:table/rows/:key", async ({ request, env, params }) => {
    await requireAdmin(request, env);
    const columns = await columnsOf(env.DB, params.table);
    const key = singleKey(columns);
    const data = await readJson<Record<string, unknown>>(request);
    const edits = columns.filter((c) => c.name !== key.name && c.name in data).map((c) => [c.name, coerce(c, data[c.name])] as const);
    if (!edits.length) refuse(400, "No editable columns in payload");
    const result = await env.DB.prepare(`UPDATE "${params.table}" SET ${edits.map(([name]) => `"${name}" = ?`).join(", ")} WHERE "${key.name}" = ?`)
      .bind(...edits.map(([, value]) => value), coerce(key, params.key)).run();
    if (!result.meta.changes) refuse(404, "Row not found");
    return json({ updated: result.meta.changes });
  });

  router.on("DELETE", "/api/admin/tables/:table/rows/:key", async ({ request, env, params }) => {
    await requireAdmin(request, env);
    const key = singleKey(await columnsOf(env.DB, params.table));
    const result = await env.DB.prepare(`DELETE FROM "${params.table}" WHERE "${key.name}" = ?`).bind(coerce(key, params.key)).run();
    if (!result.meta.changes) refuse(404, "Row not found");
    return json({ deleted: result.meta.changes });
  });

  // One raw SQL statement. Admin only, and the admin is trusted with it.
  router.on("POST", "/api/admin/sql", async ({ request, env }) => {
    await requireAdmin(request, env);
    const data = await readJson<{ query?: unknown }>(request);
    const check = validate.checking();
    const query = check.string("query", data.query, { min: 1, max: limits.text.admin_query })!;
    check.done();
    let result: D1Result<Row>;
    try {
      result = await env.DB.prepare(query).all<Row>();
    } catch (error) {
      return refuse(400, (error as Error).message);
    }
    if (RETURNS_ROWS.test(query)) {
      const rows = result.results.slice(0, limits.counts.admin_table_rows);
      return json({ rows, columns: rows.length ? Object.keys(rows[0]) : [] });
    }
    return json({ rowcount: result.meta.changes });
  });
}
