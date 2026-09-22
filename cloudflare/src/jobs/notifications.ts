// The mail that carries notifications out of Papol.
//
// A message to send is a `send_email` job — one per recipient, so one
// refused address fails one job. The daily digest is the hourly cron's:
// at the digest hour it queues the day's emails under a key naming the
// day, so it runs once however many isolates the hour finds.

import { all, one, statement, type Row } from "../db";
import { mailConfigured, sendEmail, sendEmails } from "./mail";
import { enqueue, type Enqueued } from "./queue";

export const SEND_EMAIL = "send_email";
export const DEFAULT_DIGEST_HOUR = 21;

export function queueEmail(db: D1Database, to: string, subject: string, body: string, notificationUuids: string[] = []): Enqueued {
  return enqueue(db, SEND_EMAIL, { to, subject, body, notification_uuids: notificationUuids });
}

export async function sendEmailJob(env: Env, payload: Row): Promise<Row> {
  if (!mailConfigured(env)) return { sent: false, skipped: "Email not configured" };
  await sendEmail(env, { to: String(payload.to), subject: String(payload.subject), body: String(payload.body) });
  const uuids = (payload.notification_uuids as string[] | undefined) ?? [];
  if (uuids.length) {
    await env.DB.batch(uuids.map((uuid) => statement(env.DB, "UPDATE notifications SET emailed = 1 WHERE uuid = ?", uuid)));
  }
  return { sent: true };
}

// An announcement an admin writes to many users is one job, each recipient
// still getting an email of their own: one batch call, not one call per
// recipient racing the provider's rate limit.
export const SEND_ANNOUNCEMENT = "send_announcement";

export function queueAnnouncement(db: D1Database, to: string[], subject: string, body: string): Enqueued {
  return enqueue(db, SEND_ANNOUNCEMENT, { to, subject, body });
}

export async function sendAnnouncementJob(env: Env, payload: Row): Promise<Row> {
  if (!mailConfigured(env)) return { sent: false, skipped: "Email not configured" };
  const to = payload.to as string[];
  await sendEmails(env, to.map((address) => ({ to: address, subject: String(payload.subject), body: String(payload.body) })));
  return { sent: true, recipients: to.length };
}

export async function siteUrl(env: Env): Promise<string> {
  const setting = await one<{ value: string }>(env.DB, "SELECT value FROM settings WHERE key = 'site_url'");
  return env.PAPOL_URL || setting?.value || "https://papol.io/";
}

// The digest_hour setting (0-23), read as UTC: a Worker has no host clock
// to be local to, so the admin sets the number in UTC.
export async function digestHour(env: Env): Promise<number> {
  const setting = await one<{ value: string }>(env.DB, "SELECT value FROM settings WHERE key = 'digest_hour'");
  const hour = Number(setting?.value);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULT_DIGEST_HOUR;
}

interface Notification extends Row {
  uuid: string;
  user_uuid: string;
  content: string;
}

// Queue each user an email of their unread notifications from the past
// day. A notification is emailed at most once. Returns the rows to write
// and the uuids to wake.
export async function dailyDigest(env: Env): Promise<{ statements: D1PreparedStatement[]; uuids: string[]; users: number }> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const news = await all<Notification>(
    env.DB,
    "SELECT uuid, user_uuid, content FROM notifications WHERE read = 0 AND emailed = 0 AND created_at >= ? ORDER BY created_at",
    since,
  );
  const byUser = new Map<string, Notification[]>();
  for (const n of news) byUser.set(n.user_uuid, [...(byUser.get(n.user_uuid) ?? []), n]);
  const statements: D1PreparedStatement[] = [];
  const uuids: string[] = [];
  if (!mailConfigured(env)) return { statements, uuids, users: byUser.size };
  const inbox = `${(await siteUrl(env)).replace(/\/$/, "")}/inbox`;
  for (const [userUuid, notifications] of byUser) {
    const user = await one<{ email: string; display_name: string }>(env.DB, "SELECT email, display_name FROM users WHERE uuid = ? AND deleted_at IS NULL", userUuid);
    if (!user) continue;
    const count = notifications.length;
    const plural = count === 1 ? "" : "s";
    const body = `Hello ${user.display_name},\n\nYou have ${count} new message${plural} in Papol today:\n\n`
      + notifications.map((n) => `  - ${n.content}`).join("\n")
      + `\n\nRead and reply in your inbox: ${inbox}\n\n— Papol`;
    const queued = queueEmail(env.DB, user.email, `Papol: ${count} new message${plural} today`, body, notifications.map((n) => n.uuid));
    statements.push(queued.statement);
    uuids.push(queued.uuid);
  }
  return { statements, uuids, users: byUser.size };
}
