// The day's and the week's email: what a user chose to be sent daily or
// weekly, gathered.
//
// queueEmail (notifications.ts) holds such an email as a row of
// `email_held` where it would have queued a send. Once a day the cron
// trigger queues this job; it sends each user what is held for them, a
// kind to an email, and deletes the rows. What a user is sent weekly
// waits for the Monday run. One held email goes as it was written;
// several of a kind go as one, each under its own subject.
//
// How often is asked when the job runs, not when the email was held: a
// user who since chose "never" is sent nothing and the rows go, and one
// who since chose "now" is sent what was waiting.
//
// The job writes to a chunk of users, in uuid order, and queues the next
// chunk after itself, as the suggestions job does. Rows are deleted once
// the batch is sent; a job that died between the two is taken up again
// and may send the same twice, where the other order would lose them.

import { all, statement, type Row } from "../db";
import { digestSubject, frequencyOf, isChosenKind, type ChosenEmailKind, type Mailed } from "../emails";
import { mailConfigured, sendEmails, type Mail } from "./mail";
import { enqueue, wake } from "./queue";

export const SEND_DIGESTS = "send_digests";

// Every day at 14:00 UTC, as wrangler.toml declares it: morning in the
// Americas, afternoon in Europe, the evening in Asia. Monday's is also
// the week's.
export const DAILY_CRON = "0 14 * * *";
export const isWeekly = (at: number) => new Date(at).getUTCDay() === 1;

// Users to a job.
const CHUNK = 20;
// Rows to a DELETE: under D1's limit on bound values.
const DELETED = 90;

const SIGNED = /\n*— Papol\s*$/;
const RULE = "\n\n----------\n\n";

interface Held { uuid: string; kind: string; subject: string; body: string }

// One user's held emails of one kind, as the email to send.
export function digestMail(to: string, kind: ChosenEmailKind, held: Held[]): Mail {
  if (held.length === 1) return { to, subject: held[0].subject, body: held[0].body };
  return {
    to,
    subject: digestSubject(kind, held.length),
    body: `${held.map((mail) => `${mail.subject}\n\n${mail.body.replace(SIGNED, "")}`).join(RULE)}\n\n— Papol`,
  };
}

export async function queueDigests(env: Env, weekly: boolean): Promise<string> {
  const first = enqueue(env.DB, SEND_DIGESTS, { weekly, after: "" });
  await first.statement.run();
  await wake(env, [first.uuid]);
  return first.uuid;
}

export async function sendDigestsJob(env: Env, payload: Row): Promise<Row> {
  // What is held stays held until it can be sent.
  if (!mailConfigured(env)) return { sent: false, skipped: "Email not configured" };
  const weekly = Boolean(payload.weekly);
  const after = String(payload.after ?? "");
  const users = await all<Mailed>(env.DB,
    `SELECT uuid, email, email_frequency, is_admin, is_mock FROM users
     WHERE deleted_at IS NULL AND uuid > ? AND uuid IN (SELECT user_uuid FROM email_held) ORDER BY uuid LIMIT ?`, after, CHUNK);

  const mails: Mail[] = [];
  const gone: string[] = [];
  for (const user of users) {
    const held = await all<Held>(env.DB, "SELECT uuid, kind, subject, body FROM email_held WHERE user_uuid = ? ORDER BY created_at, uuid", user.uuid);
    for (const kind of new Set(held.map((mail) => mail.kind))) {
      const theirs = held.filter((mail) => mail.kind === kind);
      // A kind Papol no longer has, or one they no longer want, is let go.
      const often = isChosenKind(kind) ? frequencyOf(user, kind) : "never";
      if (often === "weekly" && !weekly) continue;
      if (often !== "never") mails.push(digestMail(user.email, kind as ChosenEmailKind, theirs));
      gone.push(...theirs.map((mail) => mail.uuid));
    }
  }
  if (mails.length) await sendEmails(env, mails);
  for (let start = 0; start < gone.length; start += DELETED) {
    const chunk = gone.slice(start, start + DELETED);
    await statement(env.DB, `DELETE FROM email_held WHERE uuid IN (${chunk.map(() => "?").join(",")})`, ...chunk).run();
  }

  if (users.length === CHUNK) {
    const next = enqueue(env.DB, SEND_DIGESTS, { weekly, after: users[users.length - 1].uuid });
    await next.statement.run();
    await wake(env, [next.uuid]);
  }
  return { sent: true, users: users.length, emails: mails.length };
}
