// Outgoing email, through Resend's HTTP API.
//
// A Worker has no place for an SMTP conversation, so mail is one HTTP
// call: from, to, subject, text, a bearer key. EMAIL_API_URL is Resend's
// emails endpoint (https://api.resend.com/emails); a batch is posted to
// its /batch, and the admin page's record of what was sent is read back
// from the same endpoint, so Resend is the one record of every email.
// Unset, mail is skipped and the job says so. The settings-table
// fallback for SMTP credentials is not carried: a secret belongs in a
// secret, not in a table the admin page edits. A Worker's fetch sends no
// User-Agent of its own, and Resend refuses a request without one.

import limits from "../../../config/app_limits.json";
import { JobError } from "./queue";

export interface Mail {
  to: string;
  subject: string;
  body: string;
}

// Resend takes at most this many emails in one batch.
const BATCH = 100;

export function mailConfigured(env: Env): boolean {
  return Boolean(env.EMAIL_API_URL && env.EMAIL_API_KEY && env.EMAIL_FROM);
}

function emailApi(env: Env, path = "", init: RequestInit = {}): Promise<Response> {
  return fetch(`${env.EMAIL_API_URL}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${env.EMAIL_API_KEY}`, "content-type": "application/json", "user-agent": "Papol/1.0" },
  });
}

function outgoing(env: Env, mail: Mail) {
  return { from: env.EMAIL_FROM, to: [mail.to], subject: mail.subject, text: mail.body };
}

export async function sendEmail(env: Env, mail: Mail): Promise<void> {
  const response = await emailApi(env, "", { method: "POST", body: JSON.stringify(outgoing(env, mail)) });
  if (!response.ok) throw new JobError(`Email to ${mail.to} failed: ${response.status} ${(await response.text()).slice(0, 200)}`);
}

// Many emails, each to one recipient, a hundred to a request: one call
// where one per recipient would run into the provider's rate limit.
export async function sendEmails(env: Env, mails: Mail[]): Promise<void> {
  for (let start = 0; start < mails.length; start += BATCH) {
    const chunk = mails.slice(start, start + BATCH);
    const response = await emailApi(env, "/batch", { method: "POST", body: JSON.stringify(chunk.map((mail) => outgoing(env, mail))) });
    if (!response.ok) throw new JobError(`Email to ${chunk.length} recipients failed after ${start} sent: ${response.status} ${(await response.text()).slice(0, 200)}`);
  }
}

export interface SentEmail {
  id: string;
  to: string[];
  from: string;
  subject: string;
  created_at: string;
  last_event: string | null;
}

async function read<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`The email API answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return response.json<T>();
}

// Every email sent, newest first, as far back as a few pages reach.
export async function sentEmails(env: Env): Promise<SentEmail[]> {
  const emails: SentEmail[] = [];
  let after = "";
  for (let page = 0; page < limits.counts.sent_email_pages; page++) {
    const list = await read<{ data: SentEmail[]; has_more: boolean }>(await emailApi(env, `?limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`));
    emails.push(...list.data);
    if (!list.has_more || !list.data.length) break;
    after = list.data[list.data.length - 1].id;
  }
  return emails;
}

export async function sentEmail(env: Env, id: string): Promise<{ text: string | null; html: string | null }> {
  const email = await read<{ text?: string | null; html?: string | null }>(await emailApi(env, `/${encodeURIComponent(id)}`));
  return { text: email.text ?? null, html: email.html ?? null };
}
