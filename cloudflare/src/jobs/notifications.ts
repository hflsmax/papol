// The mail Papol sends.
//
// A message to send is a `send_email` job — one per recipient, so one
// refused address fails one job.

import { one, type Row } from "../db";
import { letterHtml, letterText } from "./letter";
import { mailConfigured, sendEmail, sendEmails } from "./mail";
import { enqueue, type Enqueued } from "./queue";

export const SEND_EMAIL = "send_email";

export function queueEmail(db: D1Database, to: string, subject: string, body: string): Enqueued {
  return enqueue(db, SEND_EMAIL, { to, subject, body });
}

export async function sendEmailJob(env: Env, payload: Row): Promise<Row> {
  if (!mailConfigured(env)) return { sent: false, skipped: "Email not configured" };
  await sendEmail(env, { to: String(payload.to), subject: String(payload.subject), body: String(payload.body) });
  return { sent: true };
}

// An announcement an admin writes to many users is one job, each recipient
// still getting an email of their own: one batch call, not one call per
// recipient racing the provider's rate limit. The admin writes Markdown;
// each copy carries it as HTML, pictures and all, and as plain text.
export const SEND_ANNOUNCEMENT = "send_announcement";

export function queueAnnouncement(db: D1Database, to: string[], subject: string, body: string): Enqueued {
  return enqueue(db, SEND_ANNOUNCEMENT, { to, subject, body });
}

export async function sendAnnouncementJob(env: Env, payload: Row): Promise<Row> {
  if (!mailConfigured(env)) return { sent: false, skipped: "Email not configured" };
  const to = payload.to as string[];
  const markdown = String(payload.body);
  const body = letterText(markdown), html = letterHtml(markdown);
  await sendEmails(env, to.map((address) => ({ to: address, subject: String(payload.subject), body, html })));
  return { sent: true, recipients: to.length };
}

export async function siteUrl(env: Env): Promise<string> {
  const setting = await one<{ value: string }>(env.DB, "SELECT value FROM settings WHERE key = 'site_url'");
  return env.PAPOL_URL || setting?.value || "https://papol.io/";
}
