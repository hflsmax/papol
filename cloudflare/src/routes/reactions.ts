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
// these rows out (emoji IS NULL), so it is no news, raises no dot, no
// inbox line and no email, counts as no reply and no post, and moves
// nothing in the Lounge.

import emojis from "../../../config/reactions.json";
import { currentUser, type User } from "../auth";
import { all, batch, newUuid, now, one, statement, type Row } from "../db";
import { json, readJson, refuse, type Router } from "../http";
import { openDig } from "./digs";
import { userLiteral } from "./friends";
import { seesThread } from "./threads";

const EMOJIS: string[] = emojis;
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
interface Subject { in: Holder; holder: string; on: string | null }

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
    if (!(await one(env.DB, `SELECT 1 FROM threads t WHERE t.uuid = ? AND ${seesThread(reader)}`, uuid))) refuse(404, "Thread not found");
    return { in: "thread", holder: uuid, on: null };
  }
  if (kind === "reply") {
    const reply = await one<{ thread_uuid: string }>(env.DB,
      `SELECT r.thread_uuid FROM thread_replies r JOIN threads t ON t.uuid = r.thread_uuid WHERE r.uuid = ? AND r.emoji IS NULL AND ${seesThread(reader)}`, uuid);
    return reply ? { in: "thread", holder: reply.thread_uuid, on: uuid } : refuse(404, "Reply not found");
  }
  if (kind === "dig") {
    await openDig(env, uuid, me);
    return { in: "dig", holder: uuid, on: null };
  }
  if (kind === "post") {
    const post = await one<{ dig_uuid: string }>(env.DB, "SELECT dig_uuid FROM dig_posts WHERE uuid = ? AND emoji IS NULL", uuid);
    if (!post) return refuse(404, "Post not found");
    await openDig(env, post.dig_uuid, me);
    return { in: "dig", holder: post.dig_uuid, on: uuid };
  }
  return refuse(404, "Nothing here to react to");
}

async function answer(env: Env, subject: Subject, me: User) {
  return json({ reactions: (await reactionsIn(env, subject.in, [subject.holder], me)).get(subject.holder)?.get(subject.on ?? "") ?? [] });
}

function emojiOf(value: unknown): string {
  return typeof value === "string" && EMOJIS.includes(value) ? value : refuse(422, "That is not a reaction Papol offers");
}

export function reactionRoutes(router: Router) {
  // Set an emoji on something the reader sees. Setting one already set
  // changes nothing. Answers with the thing's reactions as they now stand.
  router.on("PUT", "/api/reactions/:kind/:uuid", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const subject = await seen(env, params.kind, params.uuid, me);
    const emoji = emojiOf((await readJson<Row>(request)).emoji);
    const { table, holder, on } = KEPT[subject.in];
    await batch(env.DB, [statement(env.DB,
      `INSERT OR IGNORE INTO ${table} (uuid, ${holder}, user_uuid, body, emoji, ${on}, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      newUuid(), subject.holder, me.uuid, emoji, emoji, subject.on, now())]);
    return answer(env, subject, me);
  });

  // Take back one's own emoji from something the reader sees.
  router.on("DELETE", "/api/reactions/:kind/:uuid", async ({ request, env, params, url }) => {
    const me = await currentUser(request, env);
    const subject = await seen(env, params.kind, params.uuid, me);
    const emoji = emojiOf(url.searchParams.get("emoji"));
    const { table, holder, on } = KEPT[subject.in];
    await batch(env.DB, [statement(env.DB,
      `DELETE FROM ${table} WHERE ${holder} = ? AND coalesce(${on}, '') = ? AND user_uuid = ? AND emoji = ?`, subject.holder, subject.on ?? "", me.uuid, emoji)]);
    return answer(env, subject, me);
  });
}
