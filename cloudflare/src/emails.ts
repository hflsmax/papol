// Every kind of email Papol sends, and which of them a user may turn off.
//
// This list is the one place a kind is declared. A kind with `choice` is
// sent only to whoever has not turned it off, in the Email block of their
// Preferences; one without is always sent: a password reset the user
// asked for a moment ago, and an announcement, which an admin addresses
// to whoever it is for. A kind with `admins` is one only an admin gets,
// and only an admin is shown its choice.
//
// What a user turned off is kept on their row, in `email_off`: a JSON
// list of kinds. A kind added here is on for everyone until they say
// otherwise, with no migration.
//
// Mail to a user is queued by queueEmail (jobs/notifications.ts), which
// takes the kind and asks here; a job that picks its own recipients in
// SQL (jobs/suggestions.ts) filters with wantsEmailSql.

import { refuse } from "./http";

export const EMAIL_KINDS = {
  password_reset: { choice: false, admins: false },
  announcement: { choice: false, admins: false },
  friend_request: { choice: true, admins: false },
  friend_suggestions: { choice: true, admins: false },
  feedback_report: { choice: true, admins: true },
} as const;

export type EmailKind = keyof typeof EMAIL_KINDS;
export type ChosenEmailKind = { [K in EmailKind]: (typeof EMAIL_KINDS)[K]["choice"] extends true ? K : never }[EmailKind];
export type SureEmailKind = Exclude<EmailKind, ChosenEmailKind>;

// As much of a user as the question needs.
export interface Mailed { email: string; email_off?: string | null; is_admin?: number | boolean | null }

const CHOSEN = (Object.keys(EMAIL_KINDS) as EmailKind[]).filter((kind) => EMAIL_KINDS[kind].choice) as ChosenEmailKind[];

function off(user: Mailed): string[] {
  try {
    const list = JSON.parse(user.email_off || "[]");
    return Array.isArray(list) ? list.map(String) : [];
  } catch {
    return [];
  }
}

export function wantsEmail(user: Mailed, kind: EmailKind): boolean {
  return !EMAIL_KINDS[kind].choice || !off(user).includes(kind);
}

// The same question as a condition on a users row, for a query that
// picks who to write to.
export function wantsEmailSql(kind: ChosenEmailKind, users = "users"): string {
  return `NOT EXISTS (SELECT 1 FROM json_each(${users}.email_off) WHERE value = '${kind}')`;
}

// The choices this user has, each on or off, as their Preferences shows
// them.
export function emailChoices(user: Mailed): Partial<Record<ChosenEmailKind, boolean>> {
  const turnedOff = off(user);
  const choices: Partial<Record<ChosenEmailKind, boolean>> = {};
  for (const kind of CHOSEN) {
    if (EMAIL_KINDS[kind].admins && !user.is_admin) continue;
    choices[kind] = !turnedOff.includes(kind);
  }
  return choices;
}

// The user's row after they change some of their choices: `{ kind: on }`
// for any of the kinds they are shown. What they said about a kind they
// are no longer shown is kept as it was.
export function emailOffAfter(user: Mailed, change: unknown): string {
  const mine = emailChoices(user);
  if (!change || typeof change !== "object" || Array.isArray(change)
      || !Object.entries(change).every(([kind, on]) => kind in mine && typeof on === "boolean")) {
    refuse(422, `emails must turn ${Object.keys(mine).join(", ")} on or off`);
  }
  const turnedOff = new Set(off(user));
  for (const [kind, on] of Object.entries(change as Record<string, boolean>)) {
    if (on) turnedOff.delete(kind); else turnedOff.add(kind);
  }
  return JSON.stringify(CHOSEN.filter((kind) => turnedOff.has(kind)));
}
