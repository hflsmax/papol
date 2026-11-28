// Every kind of email Papol sends, and how often each user is sent it.
//
// This list is the one place a kind is declared. A password reset the
// user asked for a moment ago and an announcement, which an admin
// addresses to whoever it is for, are always sent, as they happen;
// Preferences does not list those. Every other kind is the recipient's
// choice of how often, in the Email block of their Preferences:
//
//   now     as it happens, an email each
//   daily   once a day, what gathered since the last as one email
//   weekly  the same, on Sunday evenings (23:00 UTC)
//   never   not at all
//
// A kind says which of those it offers and which it starts at (`preset`).
// A kind with `admins` is one only an admin gets, and only an admin is
// shown its choice.
//
// What a user chose is kept on their row, in `email_frequency`: a JSON
// object, kind to frequency, holding only what they changed. A kind added
// here is at its preset for everyone, with no migration.
//
// Mail to a user is queued by queueEmail (jobs/notifications.ts), which
// takes the kind and asks here: it sends now, holds for the day's or the
// week's email (jobs/digests.ts), or does nothing. A job that picks its
// own recipients in SQL (jobs/suggestions.ts, jobs/lounge.ts) filters
// with frequencySql.

import { refuse } from "./http";

export type Frequency = "now" | "daily" | "weekly" | "never";

interface Choice {
  choices: readonly Frequency[];
  preset: Frequency;
  admins: boolean;
  // The subject of one email carrying several of this kind.
  many?: (count: number) => string;
}

const EVERY: readonly Frequency[] = ["now", "daily", "weekly", "never"];

const CHOSEN = {
  friend_request: { choices: EVERY, preset: "now", admins: false, many: (count) => `${count} friend requests on Papol` },
  // Made on a schedule, not by something happening: there is no "now".
  friend_suggestions: { choices: ["daily", "weekly", "never"], preset: "weekly", admins: false },
  // What friends did in the Lounge since the last (jobs/lounge.ts).
  lounge_activity: { choices: ["daily", "weekly", "never"], preset: "daily", admins: false },
  // A friend dug a paper on a shelf of the reader's nook (routes/digs.ts).
  friend_dig: { choices: EVERY, preset: "daily", admins: false, many: (count) => `${count} digs by friends on papers in your nook` },
  // Someone posted in a dig the reader wrote or posted in.
  dig_reply: { choices: EVERY, preset: "now", admins: false, many: (count) => `${count} replies in digs you are in` },
  feedback_report: { choices: EVERY, preset: "now", admins: true, many: (count) => `${count} Papol feedback reports` },
} satisfies Record<string, Choice>;

export type ChosenEmailKind = keyof typeof CHOSEN;
export type SureEmailKind = "password_reset" | "announcement";
export type EmailKind = ChosenEmailKind | SureEmailKind;

// As much of a user as the question needs.
export interface Mailed { uuid: string; email: string; email_frequency?: string | null; is_admin?: number | boolean | null }

const KINDS = Object.keys(CHOSEN) as ChosenEmailKind[];
const choice = (kind: ChosenEmailKind): Choice => CHOSEN[kind];

export function isChosenKind(kind: string): kind is ChosenEmailKind {
  return Object.hasOwn(CHOSEN, kind);
}

function kept(user: Pick<Mailed, "email_frequency">): Record<string, unknown> {
  try {
    const chosen = JSON.parse(user.email_frequency || "{}");
    return chosen && typeof chosen === "object" && !Array.isArray(chosen) ? chosen : {};
  } catch {
    return {};
  }
}

// How often this user is sent this kind: what they chose, if the kind
// still offers it, else where the kind starts.
export function frequencyOf(user: Pick<Mailed, "email_frequency">, kind: ChosenEmailKind): Frequency {
  const chosen = kept(user)[kind];
  return choice(kind).choices.includes(chosen as Frequency) ? chosen as Frequency : choice(kind).preset;
}

// The same as an expression on a users row, for a query that picks who
// to write to.
export function frequencySql(kind: ChosenEmailKind, users = "users"): string {
  return `COALESCE(json_extract(${users}.email_frequency, '$.${kind}'), '${choice(kind).preset}')`;
}

export function digestSubject(kind: ChosenEmailKind, count: number): string {
  return choice(kind).many?.(count) ?? `${count} emails from Papol`;
}

// The choices this user has and what each is set to, as their
// Preferences shows them.
export function emailChoices(user: Pick<Mailed, "email_frequency" | "is_admin">): Partial<Record<ChosenEmailKind, Frequency>> {
  const choices: Partial<Record<ChosenEmailKind, Frequency>> = {};
  for (const kind of KINDS) {
    if (choice(kind).admins && !user.is_admin) continue;
    choices[kind] = frequencyOf(user, kind);
  }
  return choices;
}

// The user's row after they change some of their choices: `{ kind:
// frequency }` for any of the kinds they are shown, each to a frequency
// the kind offers. What they chose for a kind they are no longer shown
// is kept as it was.
export function emailFrequencyAfter(user: Pick<Mailed, "email_frequency" | "is_admin">, change: unknown): string {
  const mine = emailChoices(user);
  const offered = (kind: string, how: unknown) => kind in mine && choice(kind as ChosenEmailKind).choices.includes(how as Frequency);
  if (!change || typeof change !== "object" || Array.isArray(change) || !Object.entries(change).every(([kind, how]) => offered(kind, how))) {
    refuse(422, `emails must set ${Object.keys(mine).map((kind) => `${kind} to ${choice(kind as ChosenEmailKind).choices.join(", ")}`).join("; ")}`);
  }
  const chosen = { ...kept(user), ...(change as Record<string, Frequency>) };
  // Only what differs from where a kind starts is kept.
  return JSON.stringify(Object.fromEntries(KINDS.filter((kind) => kind in chosen && chosen[kind] !== choice(kind).preset).map((kind) => [kind, chosen[kind]])));
}
