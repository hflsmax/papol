// The weekly email of people to ask: to each user who has not turned it
// off, those Papol suggests (routes/suggestions.ts) whom no earlier email
// named. A week with nobody new sends nothing, so nobody is written to
// about the same people twice, and a user nobody can be suggested to
// never hears of it at all.
//
// The cron trigger queues one job; a job writes to a chunk of users, in
// uuid order, and queues the next chunk after itself, as the venues job
// does (papers/venues.ts): a Worker invocation has only so many requests
// out. Each email is its recipient's own, sent a batch to a chunk.
//
// What an email names is recorded once the batch is sent. A job that died
// between the two is taken up again and may name the same people twice;
// the other order would lose them.

import { all, now, statement, type Row } from "../db";
import { suggestionsFor, type Suggestion } from "../routes/suggestions";
import { escape, STYLE } from "./letter";
import { mailConfigured, sendEmails, type Mail } from "./mail";
import { siteUrl } from "./notifications";
import { enqueue, wake } from "./queue";

export const SUGGEST_FRIENDS = "suggest_friends";

// Mondays at 14:00 UTC, as wrangler.toml declares it: morning in the
// Americas, afternoon in Europe, the evening in Asia.
export const SUGGESTIONS_CRON = "0 14 * * 1";

// Users to a job: each costs a few queries, and one batch of mail.
const CHUNK = 20;
// People to an email.
const NAMED = 3;

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

// Why someone is suggested, in words: the projects both are in, then how
// many friends both have.
export function reasonOf(s: Suggestion): string {
  const parts: string[] = [];
  if (s.project_count > 0) {
    const more = s.project_count - 1;
    parts.push(`in ${s.projects[0].name}${more > 0 ? ` and ${more} more ${plural(more, "project", "projects")}` : ""} with you`);
  }
  if (s.mutual_count > 0) parts.push(`${s.mutual_count} ${plural(s.mutual_count, "friend", "friends")} in common`);
  const said = parts.join(", and ");
  return said ? said[0].toUpperCase() + said.slice(1) : "";
}

// One user's email, as text and as HTML. Names and titles are other
// people's words: escaped into the HTML, and never read as Markdown.
export function suggestionMail(to: { email: string; display_name: string }, suggestions: Suggestion[], site: string): Mail {
  const base = site.replace(/\/$/, "");
  const one = suggestions.length === 1;
  const name = (s: Suggestion) => String(s.user.display_name);
  const subject = one ? `${name(suggestions[0])} is on Papol too` : "People you may know on Papol";
  const intro = one ? "Someone you may know:" : "People you may know:";
  const foot = "Papol sends this once a week, when there is someone new to suggest.";
  const off = "under Preferences on your page";
  const nook = (s: Suggestion) => `${base}/u/${s.user.uuid}`;
  const where = (s: Suggestion) => (s.user.affiliation ? ` (${s.user.affiliation})` : "");

  const body = [
    `Hello ${to.display_name},`, "", intro, "",
    ...suggestions.flatMap((s) => [`- ${name(s)}${where(s)}`, `  ${reasonOf(s)}.`, `  ${nook(s)}`, ""]),
    `See everyone suggested, and ask them, in the Lounge: ${base}/lounge`, "", "— Papol", "",
    `${foot} Turn it off ${off}: ${base}/profile`,
  ].join("\n");

  const link = (href: string, words: string) => `<a href="${escape(href)}" style="${STYLE.a}">${escape(words)}</a>`;
  const p = (inner: string, style = STYLE.p) => `<p style="${style}">${inner}</p>`;
  const quiet = `${STYLE.p}font-size:13px;color:#666666;`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>`
    + `<body style="${STYLE.body}"><div style="${STYLE.sheet}">`
    + p(`Hello ${escape(to.display_name)},`) + p(escape(intro))
    + suggestions.map((s) => p(
      `<strong>${link(nook(s), name(s))}</strong>${escape(where(s))}<br>`
      + `<span style="color:#555555;">${escape(reasonOf(s))}.</span>`)).join("")
    + p(`${link(`${base}/lounge`, "See everyone suggested in the Lounge")}.`)
    + p("— Papol")
    + `<hr style="${STYLE.hr}">`
    + p(`${escape(foot)} Turn it off ${link(`${base}/profile`, off)}.`, quiet)
    + `</div></body></html>`;

  return { to: to.email, subject, body, html };
}

// The cron trigger's part: one job, starting from the first user.
export async function queueSuggestions(env: Env): Promise<string> {
  const first = enqueue(env.DB, SUGGEST_FRIENDS, { after: "" });
  await first.statement.run();
  await wake(env, [first.uuid]);
  return first.uuid;
}

export async function suggestFriendsJob(env: Env, payload: Row): Promise<Row> {
  // Nothing is recorded as said that could not be sent.
  if (!mailConfigured(env)) return { sent: false, skipped: "Email not configured" };
  const after = String(payload.after ?? "");
  const users = await all<{ uuid: string; email: string; display_name: string }>(env.DB,
    `SELECT uuid, email, display_name FROM users
     WHERE deleted_at IS NULL AND suggestion_email = 1 AND uuid > ? ORDER BY uuid LIMIT ?`, after, CHUNK);
  const site = (await siteUrl(env)).replace(/\/$/, "");

  const mails: Mail[] = [];
  const said: D1PreparedStatement[] = [];
  const at = now();
  for (const user of users) {
    const suggestions = await suggestionsFor(env, user.uuid, { limit: NAMED, unmailed: true });
    if (!suggestions.length) continue;
    mails.push(suggestionMail(user, suggestions, site));
    for (const s of suggestions) {
      said.push(statement(env.DB,
        `INSERT INTO friend_suggestions (user_uuid, suggested_uuid, mailed_at) VALUES (?1, ?2, ?3)
         ON CONFLICT (user_uuid, suggested_uuid) DO UPDATE SET mailed_at = ?3`, user.uuid, s.user.uuid, at));
    }
  }
  if (mails.length) {
    await sendEmails(env, mails);
    await env.DB.batch(said);
  }

  if (users.length === CHUNK) {
    const next = enqueue(env.DB, SUGGEST_FRIENDS, { after: users[users.length - 1].uuid });
    await next.statement.run();
    await wake(env, [next.uuid]);
  }
  return { sent: true, users: users.length, recipients: mails.length };
}
