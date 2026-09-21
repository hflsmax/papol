// Outgoing email, through an HTTP email API.
//
// A Worker has no place for an SMTP conversation, and every
// transactional mail provider offers the
// same one-call HTTP shape — from, to, subject, text, a bearer key — so
// that is what this speaks. The provider is chosen at cutover by setting
// the three variables; unset, mail is skipped and the job says so. The
// settings-table
// fallback for SMTP credentials is not carried: a secret belongs in a
// secret, not in a table the admin page edits.

import { JobError } from "./queue";

export interface Mail {
  to: string;
  subject: string;
  body: string;
}

export function mailConfigured(env: Env): boolean {
  return Boolean(env.EMAIL_API_URL && env.EMAIL_API_KEY && env.EMAIL_FROM);
}

export async function sendEmail(env: Env, mail: Mail): Promise<void> {
  const response = await fetch(env.EMAIL_API_URL!, {
    method: "POST",
    headers: { authorization: `Bearer ${env.EMAIL_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [mail.to], subject: mail.subject, text: mail.body }),
  });
  if (!response.ok) throw new JobError(`Email to ${mail.to} failed: ${response.status} ${(await response.text()).slice(0, 200)}`);
}
