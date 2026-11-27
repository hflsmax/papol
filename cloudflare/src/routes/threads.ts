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
// by whoever wrote it. What was said is reworded by whoever said it: the
// starter their own words, a reply's writer the reply. What was selected
// in the paper, and what was attached, stay as sent.

import limits from "../../../config/app_limits.json";
import { currentUser, type User } from "../auth";
import { all, batch, insert, newUuid, now, one, statement, update, type Row } from "../db";
import { blobKey, boardFileKey, DIGEST, fileUrl, stored } from "../files";
import { json, readJson, refuse, type Router } from "../http";
import * as validate from "../validate";
import { userPublic } from "./boards";
import { friendsOf, PERSON, userLiteral } from "./friends";

const FILES_MAX = limits.counts.thread_files;
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

// The pictures a browser draws in a page. Anything else is a file to open.
const PICTURE = /^image\/(png|jpeg|gif|webp)$/;

// Something attached to a thread: its name, what it is, and where it is
// fetched from (the bucket, or the Worker's route for it).
const fileOut = (env: Env, file: Row) => ({
  uuid: file.uuid, name: file.name, mime: file.mime ?? null, size: file.size, is_picture: PICTURE.test(String(file.mime ?? "")),
  url: fileUrl(env, boardFileKey(blobKey(String(file.sha256)))) ?? `/api/thread-files/${file.uuid}`,
});

async function filesOf(env: Env, threadUuids: string[]): Promise<Map<string, Row[]>> {
  const found = new Map<string, Row[]>();
  if (!threadUuids.length) return found;
  const rows = await all<Row>(env.DB,
    `SELECT uuid, thread_uuid, sha256, name, mime, size FROM thread_files WHERE thread_uuid IN (${threadUuids.map(() => "?").join(",")}) ORDER BY position`, ...threadUuids);
  for (const row of rows) found.set(String(row.thread_uuid), [...(found.get(String(row.thread_uuid)) ?? []), row]);
  return found;
}

// A file's bytes go when nothing names its digest any more: no card on a
// board, no thread's picture, no thread's attachment.
export async function dropUnnamedFiles(env: Env, digests: string[]) {
  for (const sha256 of new Set(digests)) {
    if (!DIGEST.test(sha256)) continue;
    if (await one(env.DB, "SELECT 1 FROM board_items WHERE sha256 = ?1 UNION ALL SELECT 1 FROM threads WHERE picture_sha256 = ?1 UNION ALL SELECT 1 FROM thread_files WHERE sha256 = ?1 LIMIT 1", sha256)) continue;
    await env.FILES.delete(boardFileKey(blobKey(sha256)));
  }
}

const replyOut = (row: Row, me: User) => ({
  uuid: row.reply_uuid, user: userPublic({ ...row, uuid: row.user_uuid }), body: row.body, created_at: row.created_at, edited_at: row.edited_at ?? null, is_mine: row.user_uuid === me.uuid,
});

// A thread as the API answers it. `thread` carries its starter's PERSON
// columns beside its own, the starter's uuid as `user_uuid`.
function threadOut(env: Env, thread: Row, replies: Row[], me: User, attached: Row[] = []) {
  return {
    uuid: thread.thread_uuid, user: userPublic({ ...thread, uuid: thread.user_uuid }), is_mine: thread.user_uuid === me.uuid,
    paper_sha256: thread.paper_sha256, page: thread.page, y: thread.y, mark: thread.mark ?? null, box: thread.box ?? null,
    excerpt: thread.excerpt ?? null, picture_url: pictureUrl(env, thread), words: thread.words ?? null,
    created_at: thread.created_at, edited_at: thread.edited_at ?? null, files: attached.map((f) => fileOut(env, f)), replies: replies.map((r) => replyOut(r, me)),
  };
}

const THREAD = `t.uuid AS thread_uuid, t.user_uuid, t.paper_sha256, t.page, t.y, t.mark, t.box, t.excerpt, t.picture_sha256, t.words, t.created_at, t.edited_at, ${PERSON}`;
const REPLY = `r.uuid AS reply_uuid, r.thread_uuid, r.user_uuid, r.body, r.created_at, r.edited_at, ${PERSON}`;

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
  const uuids = [String(thread.thread_uuid)];
  const replies = (await repliesOf(env, uuids)).get(uuids[0]) ?? [];
  const attached = (await filesOf(env, uuids)).get(uuids[0]) ?? [];
  return json({ ...threadOut(env, thread, replies, me, attached), paper: paperOut(thread) });
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
  const attached = await filesOf(env, threads.map((t) => String(t.thread_uuid)));
  return threads.map((t) => {
    const said = replies.get(String(t.thread_uuid)) ?? [];
    const out = threadOut(env, t, said, me, attached.get(String(t.thread_uuid)) ?? []);
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
    // What the starter attached: pictures and files, uploaded already as
    // board files are, each named by its digest.
    const given = Array.isArray(data.files) ? data.files as Row[] : (data.files == null ? [] : (check.fail("files must be a list"), []));
    if (given.length > FILES_MAX) check.fail(`a thread takes at most ${FILES_MAX} files`);
    if (fromPaper && given.length) check.fail("files are attached to a thread started in the Lounge");
    const attached = given.slice(0, FILES_MAX).map((file, at) => ({
      sha256: check.string(`files[${at}].sha256`, file?.sha256, { pattern: DIGEST }),
      name: check.string(`files[${at}].name`, file?.name, { min: 1, max: validate.text.uploaded_filename })?.trim(),
      mime: check.string(`files[${at}].mime`, file?.mime, { max: validate.text.mime_type, optional: true })?.split(";")[0].trim() || null,
      size: check.integer(`files[${at}].size`, file?.size, { min: 1 }),
    }));
    if (!fromPaper && !words && !attached.length) check.fail("a thread started in the Lounge needs words or a file");
    check.done();
    for (const file of attached) {
      if (!(await stored(env, boardFileKey(blobKey(file.sha256!))))) refuse(409, `${file.name} has not been uploaded`);
    }
    if (digest) {
      const paper = await one<Row>(env.DB, "SELECT sha256 FROM papers WHERE sha256 = ? AND deleted_at IS NULL", digest);
      if (!paper) refuse(404, "Paper not found");
    }
    if (picture && !(await stored(env, boardFileKey(blobKey(picture))))) refuse(409, "The picture has not been uploaded");
    const uuid = newUuid();
    await batch(env.DB, [insert(env.DB, "threads", {
      uuid, user_uuid: me.uuid, paper_sha256: digest, page, y, mark: mark ?? null, box: box ?? null,
      excerpt, picture_sha256: picture ?? null, words, created_at: now(),
    }), ...attached.map((file, position) => insert(env.DB, "thread_files", { uuid: newUuid(), thread_uuid: uuid, ...file, position }))]);
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

  // Its starter rewords a thread: their own words, and nothing else of
  // it. Words can be taken away where something else is left to read:
  // what was selected in the paper, or what was attached.
  router.on("PUT", "/api/threads/:uuid", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const thread = await seenThread(env, params.uuid, me);
    if (thread.user_uuid !== me.uuid) refuse(403, "Only whoever started a thread rewords it");
    const data = await readJson<Row>(request);
    const check = validate.checking();
    const words = check.string("words", data.words, { max: WORDS_MAX, optional: true })?.trim() || null;
    if (!words && !thread.excerpt && !thread.picture_sha256
      && !(await one(env.DB, "SELECT 1 FROM thread_files WHERE thread_uuid = ? LIMIT 1", thread.thread_uuid))) check.fail("a thread started in the Lounge needs words or a file");
    check.done();
    if (words !== (thread.words ?? null)) await batch(env.DB, [update(env.DB, "threads", "uuid", thread.thread_uuid, { words, edited_at: now() })]);
    return answer(env, String(thread.thread_uuid), me);
  });

  // Its starter removes a thread, replies and all.
  router.on("DELETE", "/api/threads/:uuid", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const thread = await seenThread(env, params.uuid, me);
    if (thread.user_uuid !== me.uuid) refuse(403, "Only whoever started a thread removes it");
    const gone = await all<Row>(env.DB, "SELECT sha256 FROM thread_files WHERE thread_uuid = ?", thread.thread_uuid);
    await batch(env.DB, [
      statement(env.DB, "DELETE FROM thread_replies WHERE thread_uuid = ?", thread.thread_uuid),
      statement(env.DB, "DELETE FROM thread_files WHERE thread_uuid = ?", thread.thread_uuid),
      statement(env.DB, "DELETE FROM threads WHERE uuid = ?", thread.thread_uuid),
    ]);
    // Its attachments go with it, unless something else names the same bytes.
    await dropUnnamedFiles(env, gone.map((f) => String(f.sha256)));
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

  // A reply is reworded by whoever wrote it, while they still see the thread.
  router.on("PUT", "/api/thread-replies/:uuid", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const reply = UUID.test(params.uuid) ? await one<Row>(env.DB, "SELECT uuid, thread_uuid, body FROM thread_replies WHERE uuid = ? AND user_uuid = ?", params.uuid.toLowerCase(), me.uuid) : null;
    if (!reply) refuse(404, "Reply not found");
    const thread = await seenThread(env, String(reply.thread_uuid), me);
    const data = await readJson<Row>(request);
    const check = validate.checking();
    const body = check.string("body", typeof data.body === "string" ? data.body.trim() : data.body, { min: 1, max: WORDS_MAX });
    check.done();
    if (body !== reply.body) await batch(env.DB, [update(env.DB, "thread_replies", "uuid", reply.uuid, { body, edited_at: now() })]);
    return answer(env, String(thread.thread_uuid), me);
  });

  // Something attached to a thread, where the bucket has no address of
  // its own. Named by a minted uuid, as a card's file is.
  router.on("GET", "/api/thread-files/:uuid", async ({ env, params }) => {
    const file = UUID.test(params.uuid) ? await one<Row>(env.DB, "SELECT sha256, name, mime FROM thread_files WHERE uuid = ?", params.uuid.toLowerCase()) : null;
    if (!file) refuse(404, "File not found");
    const key = boardFileKey(blobKey(String(file.sha256)));
    const address = fileUrl(env, key);
    if (address) return new Response(null, { status: 301, headers: { location: address, "cache-control": "public, max-age=86400" } });
    const object = await env.FILES.get(key);
    if (!object) refuse(404, "File not found");
    const picture = PICTURE.test(String(file.mime ?? ""));
    return new Response(object.body, { headers: {
      // Only a picture is shown as what it says it is; anything else is handed over as a download.
      "content-type": picture ? String(file.mime) : "application/octet-stream", "content-length": String(object.size),
      "content-disposition": `${picture ? "inline" : "attachment"}; filename="${String(file.name).replace(/["\\\r\n]/g, "")}"`,
      "x-content-type-options": "nosniff", "cache-control": "public, max-age=31536000, immutable",
    } });
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
