// The email of the Lounge: to each user, as often as they chose in
// Preferences (every day to begin with, or every week, or never; the
// `lounge_activity` kind of src/emails.ts), what their friends did in the
// Lounge since the last: the papers friends added, thought about, rated
// and dug, their boards and projects, and the threads they started and
// replied in. A run with nothing new sends nothing.
//
// Nothing is kept for it but a time. The email is made from the room's
// own rows (routes/room.ts `latest`), so it holds exactly what the
// Lounge would show its reader and nothing private can be in it. What is
// new is counted from the later of the last email (`lounge_mailed_at`)
// and the reader's last visit to the Lounge (`room_seen_at`): what they
// already read there is not sent after them. A user never yet written to
// is told of the last day, or the last week if they chose every week;
// nobody is told of more than a week.
//
// The daily cron trigger queues one job, which on Monday writes to those
// who chose every week as well; a job writes to a chunk of users, in
// uuid order, and queues the next chunk after itself, as the suggestions
// job does. Someone with no friends has no Lounge and is passed over.
//
// The time is recorded once the batch is sent. A job that died between
// the two is taken up again and may say the same twice; the other order
// would lose it.

import type { User } from "../auth";
import { all, now, statement, type Row } from "../db";
import { frequencyOf, frequencySql, type Frequency } from "../emails";
import { excerpt } from "../routes/projects";
import { latest } from "../routes/room";
import { escape, STYLE } from "./letter";
import { mailConfigured, sendEmails, type Mail } from "./mail";
import { siteUrl } from "./notifications";
import { enqueue, wake } from "./queue";

// An email of its own that comes at least as soon as this one does: what
// it says is left out here. One chosen weekly or never is not, so nobody
// waits a week for what the Lounge would have said today.
const SOON: Frequency[] = ["now", "daily"];

export const LOUNGE_NEWS = "lounge_news";

// Users to a job: each costs the room's queries, and one batch of mail.
const CHUNK = 20;
// Things to an email, and lines under one of them. The rest is counted.
const THINGS = 8;
const LINES = 4;

const DAY = 24 * 60 * 60 * 1000;
// Nobody is told of more than this, however long since the last email.
const FURTHEST = 7 * DAY;

type Person = { uuid: string; display_name: string };
type RoomRow = Awaited<ReturnType<typeof latest>>["rows"][number];

// One thing in the email: what it is, where it opens, and who did what.
export interface Item {
  // A word before the title, for what is not a paper.
  kind: "" | "Thread" | "Board" | "Project";
  title: string;
  // Under the title, quietly: the paper a thread came from.
  about?: string;
  path: string;
  lines: { who: string; did: string; words?: string | null }[];
  // Lines there was no room for.
  more: number;
}

// The paper's name as its links carry it (shared/paperName.js).
const paperPath = (sha256: unknown) => `/paper/${String(sha256).slice(0, 32).toLowerCase()}`;
const name = (user: unknown) => String((user as Person).display_name);
const quoted = (words: unknown) => (typeof words === "string" && words.trim() ? excerpt(words) : null);

// What the paper's line says its writer did, as the Lounge words it.
function didWith(line: Row, reader: string): string {
  const dig = line.dig as { page: number | null; owner: Person | null } | undefined;
  const place = dig?.page ? ` on page ${dig.page}` : "";
  if (line.did === "added") return "added it";
  if (line.did === "thought") return "thought";
  if (line.did === "rated") return "rated it";
  if (line.did === "dug") return `dug${place}`;
  const whose = dig?.owner?.uuid === reader ? "your" : dig?.owner?.uuid === (line.user as Person).uuid ? "their" : dig?.owner ? `${name(dig.owner)}’s` : "a";
  return `posted in ${whose} dig${place}`;
}

// The room's new rows as the email's things, each with only what was
// done after `since` by someone other than the reader, oldest first
// under each as a conversation reads.
//
// `told` names what the reader is emailed about on its own, at once or daily
// (emails.ts): a friend's dig on a paper in their nook, a post in a dig
// they are in. Those lines are left out, so nothing is said twice.
export function itemsOf(rows: RoomRow[], reader: string, since: string, told: { friend_dig?: boolean; dig_reply?: boolean } = {}): Item[] {
  const items: Item[] = [];
  const put = (item: Omit<Item, "more">) => {
    if (!item.lines.length) return;
    items.push({ ...item, lines: item.lines.slice(0, LINES), more: Math.max(0, item.lines.length - LINES) });
  };
  for (const row of rows) {
    if (!row.is_new) continue;
    if (row.kind === "paper") {
      const paper = row.paper as Row;
      const said = (row.lines as Row[]).filter((line) => String(line.at) > since).reverse()
        .filter((line) => !(told.friend_dig && line.did === "dug" && row.in_my_nook))
        .filter((line) => !(told.dig_reply && line.did === "posted" && (line.dig as { involved?: boolean } | undefined)?.involved));
      put({
        kind: "", title: String(paper.title || "Untitled paper"), path: paperPath(paper.sha256),
        lines: said.map((line) => ({ who: name(line.user), did: didWith(line, reader), words: quoted(line.words) })),
      });
    } else if (row.kind === "board") {
      const board = row.board as Row;
      put({ kind: "Board", title: String(board.name), path: `/board/${board.uuid}`, lines: [{ who: name(row.user), did: "made it" }] });
    } else if (row.kind === "project") {
      const project = row.project as Row;
      const said = (row.lines as Row[]).filter((line) => String(line.at) > since);
      put({
        kind: "Project", title: String(project.name), path: project.is_member ? `/project/${project.uuid}` : "/projects",
        lines: said.map((line) => ({ who: name(line.user), did: line.did === "started" ? "started it" : "joined it" })),
      });
    } else if (row.kind === "thread") {
      const thread = row.thread as Row & { replies: Row[]; files: Row[] };
      const paper = row.paper as Row | null;
      const files = thread.files ?? [];
      const carried = files.length === 0 ? "" : files.length === 1 ? String(files[0].name) : `${files.length} files`;
      const about = quoted(thread.words) ?? (quoted(thread.excerpt) ? `“${quoted(thread.excerpt)}”` : carried || "A clip");
      const lines: Item["lines"] = [];
      if (!thread.is_mine && String(thread.created_at) > since) lines.push({ who: name(thread.user), did: "started it" });
      for (const reply of thread.replies) {
        if (!reply.is_mine && String(reply.created_at) > since) lines.push({ who: name(reply.user), did: "replied", words: quoted(reply.body) });
      }
      put({
        kind: "Thread", title: about, path: `/thread/${thread.uuid}`, lines,
        ...(paper ? { about: `${paper.title || "Untitled paper"}, page ${thread.page}` } : {}),
      });
    }
  }
  return items;
}

// Who the email is about, each once, as its subject names them.
function subjectOf(items: Item[]): string {
  const people = [...new Set(items.flatMap((item) => item.lines.map((line) => line.who)))];
  const others = people.length - 2;
  const named = people.length === 1 ? people[0]
    : people.length === 2 ? `${people[0]} and ${people[1]}`
      : `${people[0]}, ${people[1]} and ${others} ${others === 1 ? "other" : "others"}`;
  return `New in the Lounge from ${named}`;
}

// One user's email, as text and as HTML. Names, titles and what was
// written are other people's words: escaped into the HTML, and never
// read as Markdown.
export function loungeMail(to: { email: string; display_name: string }, items: Item[], site: string, often: Frequency = "daily"): Mail {
  const base = site.replace(/\/$/, "");
  const shown = items.slice(0, THINGS);
  const left = items.length - shown.length;
  const intro = "New from your friends in the Lounge:";
  const rest = left > 0 ? `And ${left} more in the Lounge.` : "";
  const foot = `Papol sends this once a ${often === "weekly" ? "week" : "day"}, when there is something new in the Lounge.`;
  const off = "under Preferences on your page";
  const said = (line: Item["lines"][number]) => `${line.who} ${line.did}${line.words ? `: “${line.words}”` : ""}`;
  const heading = (item: Item) => `${item.kind ? `${item.kind}: ` : ""}${item.title}`;
  const more = (item: Item) => (item.more > 0 ? `and ${item.more} more` : "");

  const body = [
    `Hello ${to.display_name},`, "", intro, "",
    ...shown.flatMap((item) => [
      heading(item),
      ...(item.about ? [`  ${item.about}`] : []),
      ...item.lines.map((line) => `  ${said(line)}`),
      ...(more(item) ? [`  ${more(item)}`] : []),
      `  ${base}${item.path}`, "",
    ]),
    ...(rest ? [rest, ""] : []),
    `Read it all in the Lounge: ${base}/lounge`, "", "— Papol", "",
    `${foot} Change how often, or turn it off, ${off}: ${base}/profile`,
  ].join("\n");

  const link = (href: string, words: string) => `<a href="${escape(href)}" style="${STYLE.a}">${escape(words)}</a>`;
  const p = (inner: string, style = STYLE.p) => `<p style="${style}">${inner}</p>`;
  const quiet = "color:#555555;";
  const small = `${STYLE.p}font-size:13px;color:#666666;`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>`
    + `<body style="${STYLE.body}"><div style="${STYLE.sheet}">`
    + p(`Hello ${escape(to.display_name)},`) + p(escape(intro))
    + shown.map((item) => p(
      `${item.kind ? `<span style="${quiet}">${item.kind}:</span> ` : ""}<strong>${link(`${base}${item.path}`, item.title)}</strong>`
      + (item.about ? `<br><span style="${quiet}">${escape(item.about)}</span>` : "")
      + item.lines.map((line) => `<br>${escape(`${line.who} ${line.did}`)}${line.words ? `: <span style="${quiet}">“${escape(line.words)}”</span>` : ""}`).join("")
      + (more(item) ? `<br><span style="${quiet}">${more(item)}</span>` : ""))).join("")
    + (rest ? p(escape(rest)) : "")
    + p(`${link(`${base}/lounge`, "Read it all in the Lounge")}.`)
    + p("— Papol")
    + `<hr style="${STYLE.hr}">`
    + p(`${escape(foot)} Change how often, or turn it off, ${link(`${base}/profile`, off)}.`, small)
    + `</div></body></html>`;

  return { to: to.email, subject: subjectOf(shown), body, html };
}

// The time a user's news is counted from, at a run at `at`.
export function newsSince(user: Row, often: Frequency, at: number): string {
  const ago = (ms: number) => new Date(at - ms).toISOString();
  const last = typeof user.lounge_mailed_at === "string" ? user.lounge_mailed_at : ago(often === "weekly" ? 7 * DAY : DAY);
  const seen = typeof user.room_seen_at === "string" ? user.room_seen_at : "";
  return [last, seen, ago(FURTHEST)].reduce((a, b) => (a > b ? a : b));
}

// The cron trigger's part: one job, starting from the first user.
// `weekly` on the day those who chose every week are written to.
export async function queueLoungeNews(env: Env, weekly: boolean): Promise<string> {
  const first = enqueue(env.DB, LOUNGE_NEWS, { weekly, after: "" });
  await first.statement.run();
  await wake(env, [first.uuid]);
  return first.uuid;
}

export async function loungeNewsJob(env: Env, payload: Row): Promise<Row> {
  // Nothing is recorded as said that could not be sent.
  if (!mailConfigured(env)) return { sent: false, skipped: "Email not configured" };
  const after = String(payload.after ?? "");
  const weekly = Boolean(payload.weekly);
  const often = frequencySql("lounge_activity");
  const users = await all<User & { often: Frequency }>(env.DB,
    `SELECT users.*, ${often} AS often FROM users
     WHERE deleted_at IS NULL AND ${often} IN ('daily'${weekly ? ", 'weekly'" : ""}) AND uuid > ?
       AND EXISTS (SELECT 1 FROM friendships f WHERE f.state = 'friends' AND (f.asker_uuid = users.uuid OR f.asked_uuid = users.uuid))
     ORDER BY uuid LIMIT ?`, after, CHUNK);
  const site = (await siteUrl(env)).replace(/\/$/, "");

  const mails: Mail[] = [];
  const at = now();
  for (const user of users) {
    const since = newsSince(user, user.often, Date.parse(at));
    const items = itemsOf((await latest(env, user, since)).rows, user.uuid, since,
      { friend_dig: SOON.includes(frequencyOf(user, "friend_dig")), dig_reply: SOON.includes(frequencyOf(user, "dig_reply")) });
    if (items.length) mails.push(loungeMail(user, items, site, user.often));
  }
  if (mails.length) await sendEmails(env, mails);
  // Everyone looked at starts from here next time, written to or not.
  if (users.length) {
    await statement(env.DB, `UPDATE users SET lounge_mailed_at = ? WHERE uuid IN (${users.map(() => "?").join(",")})`, at, ...users.map((user) => user.uuid)).run();
  }

  if (users.length === CHUNK) {
    const next = enqueue(env.DB, LOUNGE_NEWS, { weekly, after: users[users.length - 1].uuid });
    await next.statement.run();
    await wake(env, [next.uuid]);
  }
  return { sent: true, users: users.length, recipients: mails.length };
}
