// Reactions: an emoji a user sets on something said. Four things take
// one: a thread, a reply in a thread, a dig, and a post in a dig.
//
// A reaction is a reply of a special sort, drawn differently (decided
// 2026-11-28): in a thread it is a row of thread_replies, in a dig a row
// of dig_posts, with its emoji named. It is on the thread or the dig
// itself, or on one reply or post, which it then names (on_reply_uuid,
// on_post_uuid). So one rule holds without being written twice: whoever
// sees the thread or the dig sees every reaction in it, with who set
// each, and can set their own (seesThread, openDig); whoever does not is
// told the thing is not there; and a reaction goes when what holds it
// goes. A user sets each emoji once on a thing and takes back only their
// own.
//
// A reaction is nothing said: every reader of replies and posts leaves
// these rows out (emoji IS NULL), so it is no news, raises no dot and no
// email, counts as no reply and no post, and moves nothing in the Lounge.
// It is told one way only: a line in the inbox of whoever wrote the thing
// (told, below), there while the emoji stands unread.

import { currentUser, type User } from "../auth";
import { all, batch, newUuid, now, one, statement, type Row } from "../db";
import { json, readJson, refuse, type Router } from "../http";
import { digLink, openDig } from "./digs";
import { friendSees, notice, userLiteral } from "./friends";
import { seesThread } from "./threads";

// Any one emoji is a reaction: one the Unicode standard recommends, alone
// (a flag, a family and a face with a skin tone are each one). The pages
// offer a common few first and the rest behind More (config/reactions.json,
// config/emoji.json); the server holds neither list.
const EMOJI = new RegExp("^\\p{RGI_Emoji}$", "v");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Reaction { emoji: string; count: number; mine: boolean; who: string[] }

// Where reactions are kept for each of the two things that hold them:
// the table, the column naming the holder, and the one naming the reply
// or post a reaction is on.
const KEPT = {
  thread: { table: "thread_replies", holder: "thread_uuid", on: "on_reply_uuid" },
  dig: { table: "dig_posts", holder: "dig_uuid", on: "on_post_uuid" },
} as const;
type Holder = keyof typeof KEPT;

// What a reaction is on, as a route names it: the holder, and the reply
// or post in it, if it is on one.
// With it, what its writer's inbox line needs: who wrote it, the words
// that name it to them, where the line leads, and whether they still see
// it there.
interface Subject { in: Holder; holder: string; on: string | null; writer: string; named: string; link: string | null; shown: boolean }

const REACTED = "reaction";

// A dig as its writer's inbox names it and reaches it: in its project, or
// on its paper's jacket.
async function digTold(env: Env, uuid: string, me: User) {
  const { dig, project } = await openDig(env, uuid, me);
  const paper = dig.paper_sha256 ? await one<{ title: string }>(env.DB, "SELECT title FROM papers WHERE sha256 = ?", dig.paper_sha256) : null;
  return { dig, project, where: project ? ` in ${project.name}` : paper ? ` on ${paper.title}` : "", link: project ? `/project/${project.uuid}` : dig.paper_sha256 ? digLink(dig) : null };
}

// The reactions in each of the given threads or digs. For each holder,
// by what they are on ("" for the thread or dig itself, else the reply's
// or post's uuid): each emoji once, in the order it was first set, with
// how many set it, who (by name, in order), and whether the reader did.
export async function reactionsIn(env: Env, kind: Holder, holders: string[], me: User): Promise<Map<string, Map<string, Reaction[]>>> {
  const { table, holder, on } = KEPT[kind];
  const found = new Map<string, Map<string, Reaction[]>>();
  const unique = [...new Set(holders)];
  // D1 binds at most a hundred values to a statement.
  for (let at = 0; at < unique.length; at += 90) {
    const part = unique.slice(at, at + 90);
    const rows = await all<Row>(env.DB,
      `SELECT x.${holder} AS holder, coalesce(x.${on}, '') AS subject, x.emoji, x.user_uuid, u.display_name FROM ${table} x JOIN users u ON u.uuid = x.user_uuid
       WHERE x.emoji IS NOT NULL AND x.${holder} IN (${part.map(() => "?").join(",")}) ORDER BY x.created_at, x.uuid`, ...part);
    for (const row of rows) {
      const within = found.get(String(row.holder)) ?? found.set(String(row.holder), new Map()).get(String(row.holder))!;
      const list = within.get(String(row.subject)) ?? within.set(String(row.subject), []).get(String(row.subject))!;
      const tally = list.find((r) => r.emoji === row.emoji) ?? list[list.push({ emoji: String(row.emoji), count: 0, mine: false, who: [] }) - 1];
      tally.count += 1;
      tally.who.push(String(row.display_name));
      if (row.user_uuid === me.uuid) tally.mine = true;
    }
  }
  return found;
}

// The thing a request names, if the reader sees it; else it is not there.
// A reaction is not itself something to react to.
async function seen(env: Env, kind: string, given: string, me: User): Promise<Subject> {
  if (!UUID.test(given)) return refuse(404, "Nothing here to react to");
  const uuid = given.toLowerCase();
  const reader = userLiteral(me.uuid);
  if (kind === "thread") {
    const thread = await one<{ user_uuid: string }>(env.DB, `SELECT t.user_uuid FROM threads t WHERE t.uuid = ? AND ${seesThread(reader)}`, uuid);
    if (!thread) return refuse(404, "Thread not found");
    return { in: "thread", holder: uuid, on: null, writer: thread.user_uuid, named: "your thread", link: `/thread/${uuid}`, shown: true };
  }
  if (kind === "reply") {
    // A replier no longer the starter's friend does not see the thread.
    const reply = await one<{ thread_uuid: string; user_uuid: string; shown: number }>(env.DB,
      `SELECT r.thread_uuid, r.user_uuid, ${seesThread("r.user_uuid")} AS shown FROM thread_replies r JOIN threads t ON t.uuid = r.thread_uuid
       WHERE r.uuid = ? AND r.emoji IS NULL AND ${seesThread(reader)}`, uuid);
    if (!reply) return refuse(404, "Reply not found");
    return { in: "thread", holder: reply.thread_uuid, on: uuid, writer: reply.user_uuid, named: "your reply in a thread", link: `/thread/${reply.thread_uuid}`, shown: Boolean(reply.shown) };
  }
  if (kind === "dig") {
    const { dig, where, link } = await digTold(env, uuid, me);
    return { in: "dig", holder: uuid, on: null, writer: dig.user_uuid, named: `your dig${where}`, link, shown: true };
  }
  if (kind === "post") {
    const post = await one<{ dig_uuid: string; user_uuid: string }>(env.DB, "SELECT dig_uuid, user_uuid FROM dig_posts WHERE uuid = ? AND emoji IS NULL", uuid);
    if (!post) return refuse(404, "Post not found");
    const { dig, project, where, link } = await digTold(env, post.dig_uuid, me);
    // Whoever posted still sees the dig as its writer, as a member of the
    // project it is read in, or as its writer's friend while it is shown.
    const shown = post.user_uuid === dig.user_uuid
      || Boolean(project && await one(env.DB, "SELECT 1 FROM project_members WHERE project_uuid = ? AND user_uuid = ?", project.uuid, post.user_uuid))
      || Boolean(await one(env.DB, `SELECT 1 FROM digs d WHERE d.uuid = ? AND ${friendSees(userLiteral(post.user_uuid))}`, dig.uuid));
    return { in: "dig", holder: post.dig_uuid, on: uuid, writer: post.user_uuid, named: `your post in a dig${where}`, link, shown };
  }
  return refuse(404, "Nothing here to react to");
}

async function answer(env: Env, subject: Subject, me: User) {
  return json({ reactions: (await reactionsIn(env, subject.in, [subject.holder], me)).get(subject.holder)?.get(subject.on ?? "") ?? [] });
}

// The line an emoji puts in the inbox of whoever wrote the thing, and the
// statement that takes that line out while it is unread: an emoji taken
// back, or set again, leaves no stale line and never two.
function told(env: Env, subject: Subject, me: User, emoji: string) {
  const content = `${me.display_name} reacted ${emoji} to ${subject.named}.`;
  return {
    line: () => notice(env, subject.writer, content, REACTED, me, subject.link ?? "/inbox"),
    gone: statement(env.DB, "DELETE FROM notifications WHERE user_uuid = ? AND actor_uuid = ? AND kind = ? AND content = ? AND read = 0", subject.writer, me.uuid, REACTED, content),
  };
}

function emojiOf(value: unknown): string {
  return typeof value === "string" && value.length <= 32 && EMOJI.test(value) ? value : refuse(422, "A reaction is one emoji");
}

export function reactionRoutes(router: Router) {
  // Set an emoji on something the reader sees. Setting one already set
  // changes nothing. Answers with the thing's reactions as they now stand.
  router.on("PUT", "/api/reactions/:kind/:uuid", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const subject = await seen(env, params.kind, params.uuid, me);
    const emoji = emojiOf((await readJson<Row>(request)).emoji);
    const { table, holder, on } = KEPT[subject.in];
    // Only an emoji newly set is told, to its writer if that is someone
    // else who still sees the thing.
    const fresh = !(await one(env.DB, `SELECT 1 FROM ${table} WHERE ${holder} = ? AND coalesce(${on}, '') = ? AND user_uuid = ? AND emoji = ?`, subject.holder, subject.on ?? "", me.uuid, emoji));
    const tell = fresh && subject.writer !== me.uuid && subject.shown ? told(env, subject, me, emoji) : null;
    await batch(env.DB, [statement(env.DB,
      `INSERT OR IGNORE INTO ${table} (uuid, ${holder}, user_uuid, body, emoji, ${on}, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      newUuid(), subject.holder, me.uuid, emoji, emoji, subject.on, now()),
      ...(tell ? [tell.gone, tell.line()] : [])]);
    return answer(env, subject, me);
  });

  // Take back one's own emoji from something the reader sees.
  router.on("DELETE", "/api/reactions/:kind/:uuid", async ({ request, env, params, url }) => {
    const me = await currentUser(request, env);
    const subject = await seen(env, params.kind, params.uuid, me);
    const emoji = emojiOf(url.searchParams.get("emoji"));
    const { table, holder, on } = KEPT[subject.in];
    await batch(env.DB, [statement(env.DB,
      `DELETE FROM ${table} WHERE ${holder} = ? AND coalesce(${on}, '') = ? AND user_uuid = ? AND emoji = ?`, subject.holder, subject.on ?? "", me.uuid, emoji),
      told(env, subject, me, emoji).gone]);
    return answer(env, subject, me);
  });
}
