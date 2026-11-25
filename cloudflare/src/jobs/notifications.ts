// The mail Papol sends.
//
// A message to send is a `send_email` job — one per recipient, so one
// refused address fails one job. Each is of a kind (src/emails.ts), and
// how often its recipient chose to be sent that kind says what is done
// with it: queued to send now, held for the day's or the week's email
// (digests.ts), or nothing at all.

import { insert, newUuid, now, one, type Row } from "../db";
import { frequencyOf, type ChosenEmailKind, type EmailKind, type Mailed, type SureEmailKind } from "../emails";
import { letterHtml, letterText } from "./letter";
import { mailConfigured, sendEmail, sendEmails } from "./mail";
import { enqueue, type Enqueued } from "./queue";

export const SEND_EMAIL = "send_email";

// What goes in the caller's batch, and the jobs to wake once it is
// written: none for an email that is held.
export interface Queued {
  statement: D1PreparedStatement;
  wake: string[];
}

// A kind nobody chooses is always queued, to an address; one its
// recipient chose never to be sent is nothing.
export function queueEmail(db: D1Database, kind: SureEmailKind, to: { email: string }, subject: string, body: string): Queued;
export function queueEmail(db: D1Database, kind: ChosenEmailKind, to: Mailed, subject: string, body: string): Queued | null;
export function queueEmail(db: D1Database, kind: EmailKind, to: { email: string } | Mailed, subject: string, body: string): Queued | null {
  const often = kind === "password_reset" || kind === "announcement" ? "now" : frequencyOf(to as Mailed, kind);
  if (often === "never") return null;
  if (often === "now") {
    const job = enqueue(db, SEND_EMAIL, { to: to.email, subject, body });
    return { statement: job.statement, wake: [job.uuid] };
  }
  return { statement: insert(db, "email_held", { uuid: newUuid(), user_uuid: (to as Mailed).uuid, kind, subject, body, created_at: now() }), wake: [] };
}

export async function sendEmailJob(env: Env, payload: Row): Promise<Row> {
  if (!mailConfigured(env)) return { sent: false, skipped: "Email not configured" };
  await sendEmail(env, { to: String(payload.to), subject: String(payload.subject), body: String(payload.body) });
  return { sent: true };
}

// An announcement is a kind nobody chooses (src/emails.ts): it goes to
// whoever the admin addressed. One an admin writes to many users is one job, each recipient
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
