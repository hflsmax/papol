// Threads: the Lounge's free-form talk. A user sends something they
// selected in a paper to the Lounge, words or a clipped rectangle as a
// picture, with words of their own if they have any, or starts one in
// the Lounge itself with words alone, and their friends reply under it.
//
// One audience and one rule: a thread is seen by its starter and by the
// starter's friends, and whoever sees it can reply. Nothing is voted on
// or counted for approval. A thread never marks the paper it came from:
// it lives in the Lounge alone and keeps its place only to lead back
// there. It has a jacket of its own, as a paper and a board have, which
// is why one thread is answered with its paper. Its starter removes it, replies and all; a reply is taken back
// by whoever wrote it.

import limits from "../../../config/app_limits.json";
import { currentUser, type User } from "../auth";
import { all, batch, insert, newUuid, now, one, statement, type Row } from "../db";
import { blobKey, boardFileKey, DIGEST, fileUrl, stored } from "../files";
import { json, readJson, refuse, type Router } from "../http";
import * as validate from "../validate";
import { userPublic } from "./boards";
import { friendsOf, PERSON, userLiteral } from "./friends";

const { thread_excerpt: EXCERPT_MAX, thread_words: WORDS_MAX, thread_place: PLACE_MAX } = limits.text;
// The viewer's own way of writing a highlight in its address: base64.
const PLACE = /^[A-Za-z0-9+/=_-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Whether thread `t` is the reader's to see: their own, or a friend's.
// `reader` is an SQL expression for the reader's uuid.
export function seesThread(reader: string): string {
  return `(t.user_uuid = ${reader} OR t.user_uuid IN ${friendsOf(reader)})`;
}

// Where a thread's picture is fetched from: the bucket, or the Worker's
// route for that thread.
function pictureUrl(env: Env, thread: Row): string | null {
  if (!thread.picture_sha256) return null;
  return fileUrl(env, boardFileKey(blobKey(String(thread.picture_sha256)))) ?? `/api/threads/${thread.thread_uuid}/picture`;
}

const replyOut = (row: Row, me: User) => ({
  uuid: row.reply_uuid, user: userPublic({ ...row, uuid: row.user_uuid }), body: row.body, created_at: row.created_at, is_mine: row.user_uuid === me.uuid,
});

// A thread as the API answers it. `thread` carries its starter's PERSON
// columns beside its own, the starter's uuid as `user_uuid`.
function threadOut(env: Env, thread: Row, replies: Row[], me: User) {
  return {
    uuid: thread.thread_uuid, user: userPublic({ ...thread, uuid: thread.user_uuid }), is_mine: thread.user_uuid === me.uuid,
    paper_sha256: thread.paper_sha256, page: thread.page, y: thread.y, mark: thread.mark ?? null, box: thread.box ?? null,
    excerpt: thread.excerpt ?? null, picture_url: pictureUrl(env, thread), words: thread.words ?? null,
    created_at: thread.created_at, replies: replies.map((r) => replyOut(r, me)),
  };
}

const THREAD = `t.uuid AS thread_uuid, t.user_uuid, t.paper_sha256, t.page, t.y, t.mark, t.box, t.excerpt, t.picture_sha256, t.words, t.created_at, ${PERSON}`;
const REPLY = `r.uuid AS reply_uuid, r.thread_uuid, r.user_uuid, r.body, r.created_at, ${PERSON}`;

// The paper a thread came from, for the thread's jacket and its Lounge
// row to name. A thread outlives a paper taken out of Papol, and then
// names none.
const PAPER = "p.sha256 AS paper_found, p.title, p.authors, p.journal, p.year";
const paperOut = (row: Row) => (row.paper_found == null ? null : { sha256: row.paper_sha256, title: row.title, authors: row.authors, journal: row.journal, year: row.year });

async function repliesOf(env: Env, threadUuids: string[]): Promise<Map<string, Row[]>> {
  const found = new Map<string, Row[]>();
  if (!threadUuids.length) return found;
  const rows = await all<Row>(env.DB,
    `SELECT ${REPLY} FROM thread_replies r JOIN users u ON u.uuid = r.user_uuid
     WHERE r.thread_uuid IN (${threadUuids.map(() => "?").join(",")}) ORDER BY r.created_at, r.uuid`, ...threadUuids);
  for (const row of rows) found.set(String(row.thread_uuid), [...(found.get(String(row.thread_uuid)) ?? []), row]);
  return found;
}

// The thread a route was asked about, if the reader sees it.
async function seenThread(env: Env, uuid: string, me: User): Promise<Row> {
  const thread = UUID.test(uuid) ? await one<Row>(env.DB,
    `SELECT ${THREAD}, ${PAPER} FROM threads t JOIN users u ON u.uuid = t.user_uuid LEFT JOIN papers p ON p.sha256 = t.paper_sha256 AND p.deleted_at IS NULL
     WHERE t.uuid = ? AND ${seesThread(userLiteral(me.uuid))}`, uuid.toLowerCase()) : null;
  return thread ?? refuse(404, "Thread not found");
}

async function answer(env: Env, uuid: string, me: User) {
  const thread = await seenThread(env, uuid, me);
  const replies = (await repliesOf(env, [String(thread.thread_uuid)])).get(String(thread.thread_uuid)) ?? [];
  return json({ ...threadOut(env, thread, replies, me), paper: paperOut(thread) });
}

// The Lounge's thread rows: every thread the reader sees that was started
// or replied in since `since`, with its paper. A thread is new to the
// reader when someone else started it or replied in it after `seen`.
export async function threadRows(env: Env, me: User, since: string, seen: string) {
  const mine = userLiteral(me.uuid);
  const threads = await all<Row>(env.DB,
    `SELECT ${THREAD}, ${PAPER}
     FROM threads t JOIN users u ON u.uuid = t.user_uuid LEFT JOIN papers p ON p.sha256 = t.paper_sha256 AND p.deleted_at IS NULL
     WHERE ${seesThread(mine)} AND (t.paper_sha256 IS NULL OR p.sha256 IS NOT NULL)
       AND (t.created_at > ?1 OR EXISTS (SELECT 1 FROM thread_replies x WHERE x.thread_uuid = t.uuid AND x.created_at > ?1))`, since);
  const replies = await repliesOf(env, threads.map((t) => String(t.thread_uuid)));
  return threads.map((t) => {
    const said = replies.get(String(t.thread_uuid)) ?? [];
    const out = threadOut(env, t, said, me);
    // Who spoke in it, each once, the starter first: what the Lounge
    // narrows a friend's rows by.
    const lines = [{ user: out.user, did: "started", at: String(t.created_at) }];
    for (const reply of out.replies) {
      const line = lines.find((l) => (l.user as { uuid: unknown }).uuid === reply.user.uuid);
      if (line) { if (line.did === "replied") line.at = String(reply.created_at); } else lines.push({ user: reply.user, did: "replied", at: String(reply.created_at) });
    }
    const times = [{ at: String(t.created_at), by: t.user_uuid }, ...said.map((r) => ({ at: String(r.created_at), by: r.user_uuid }))];
    const at = times.reduce((latest, x) => (x.at > latest ? x.at : latest), "");
    return {
      kind: "thread", key: `thread:${t.thread_uuid}`, at, is_new: times.some((x) => x.by !== me.uuid && x.at > seen),
      thread: out, paper: paperOut(t), lines,
    };
  });
}

export function threadRoutes(router: Router) {
  // Send something selected in a paper to the Lounge: its words, or the
  // picture of a clipped rectangle already uploaded as a board file is,
  // the place it came from, and the sender's own words.
  router.on("POST", "/api/threads", async ({ request, env }) => {
    const me = await currentUser(request, env);
    const data = await readJson<Row>(request);
    const check = validate.checking();
    // A thread comes from a paper, or is started in the Lounge itself
    // with words alone and names no paper and no place.
    const fromPaper = data.paper_sha256 != null;
    const digest = fromPaper ? check.string("paper_sha256", data.paper_sha256, { pattern: DIGEST }) : null;
    const page = fromPaper ? check.integer("page", data.page, { min: 1 }) : null;
    const y = fromPaper ? check.number("y", data.y, { min: 0, max: 1 }) : null;
    const mark = fromPaper ? check.string("mark", data.mark, { min: 1, max: PLACE_MAX, pattern: PLACE, optional: true }) : null;
    const box = fromPaper ? check.string("box", data.box, { min: 1, max: PLACE_MAX, pattern: PLACE, optional: true }) : null;
    const excerpt = check.string("excerpt", data.excerpt, { max: EXCERPT_MAX, optional: true })?.trim() || null;
    const picture = check.string("picture_sha256", data.picture_sha256, { pattern: DIGEST, optional: true });
    const words = check.string("words", data.words, { max: WORDS_MAX, optional: true })?.trim() || null;
    if (fromPaper && !excerpt && !picture) check.fail("a thread from a paper starts from selected words or a picture");
    if (!fromPaper && (excerpt || picture)) check.fail("selected words and a picture come from a paper");
    if (!fromPaper && !words) check.fail("a thread started in the Lounge needs words");
    check.done();
    if (digest) {
      const paper = await one<Row>(env.DB, "SELECT sha256 FROM papers WHERE sha256 = ? AND deleted_at IS NULL", digest);
      if (!paper) refuse(404, "Paper not found");
    }
    if (picture && !(await stored(env, boardFileKey(blobKey(picture))))) refuse(409, "The picture has not been uploaded");
    const uuid = newUuid();
    await batch(env.DB, [insert(env.DB, "threads", {
      uuid, user_uuid: me.uuid, paper_sha256: digest, page, y, mark: mark ?? null, box: box ?? null,
      excerpt, picture_sha256: picture ?? null, words, created_at: now(),
    })]);
    return answer(env, uuid, me);
  });

  router.on("GET", "/api/threads/:uuid", async ({ request, env, params }) => {
    return answer(env, params.uuid, await currentUser(request, env));
  });

  // Reply in a thread the reader sees.
  router.on("POST", "/api/threads/:uuid/replies", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const thread = await seenThread(env, params.uuid, me);
    const data = await readJson<Row>(request);
    const check = validate.checking();
    const body = check.string("body", typeof data.body === "string" ? data.body.trim() : data.body, { min: 1, max: WORDS_MAX });
    check.done();
    await batch(env.DB, [insert(env.DB, "thread_replies", { uuid: newUuid(), thread_uuid: thread.thread_uuid, user_uuid: me.uuid, body, created_at: now() })]);
    return answer(env, String(thread.thread_uuid), me);
  });

  // Its starter removes a thread, replies and all.
  router.on("DELETE", "/api/threads/:uuid", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const thread = await seenThread(env, params.uuid, me);
    if (thread.user_uuid !== me.uuid) refuse(403, "Only whoever started a thread removes it");
    await batch(env.DB, [
      statement(env.DB, "DELETE FROM thread_replies WHERE thread_uuid = ?", thread.thread_uuid),
      statement(env.DB, "DELETE FROM threads WHERE uuid = ?", thread.thread_uuid),
    ]);
    return json({ message: "Thread removed" });
  });

  // A reply is taken back by whoever wrote it; the thread stays.
  router.on("DELETE", "/api/thread-replies/:uuid", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const reply = UUID.test(params.uuid) ? await one<Row>(env.DB, "SELECT uuid, thread_uuid FROM thread_replies WHERE uuid = ? AND user_uuid = ?", params.uuid.toLowerCase(), me.uuid) : null;
    if (!reply) refuse(404, "Reply not found");
    await batch(env.DB, [statement(env.DB, "DELETE FROM thread_replies WHERE uuid = ?", reply.uuid)]);
    return answer(env, String(reply.thread_uuid), me);
  });

  // A thread's picture, where the bucket has no address of its own. As
  // with a card's file, both names are minted (the thread's uuid and the
  // picture's digest), so asking who is asking would protect nothing the
  // bucket does not already hand out.
  router.on("GET", "/api/threads/:uuid/picture", async ({ env, params }) => {
    const thread = UUID.test(params.uuid) ? await one<Row>(env.DB, "SELECT picture_sha256 FROM threads WHERE uuid = ?", params.uuid.toLowerCase()) : null;
    if (!thread?.picture_sha256) refuse(404, "Picture not found");
    const key = boardFileKey(blobKey(String(thread.picture_sha256)));
    const address = fileUrl(env, key);
    if (address) return new Response(null, { status: 301, headers: { location: address, "cache-control": "public, max-age=86400" } });
    const object = await env.FILES.get(key);
    if (!object) refuse(404, "Picture not found");
    return new Response(object.body, { headers: { "content-type": "image/png", "content-length": String(object.size), "cache-control": "public, max-age=31536000, immutable" } });
  });
}
