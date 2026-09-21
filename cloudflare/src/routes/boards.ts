// Boards: a user's canvases of cards, and the cards on them.
//
// Every write here goes through writeSynced, so a replica hears of it as
// it heard of the Python's commit_sync. A board's `updated_at` is its
// clock, moved by anything on it; only what a replica may write on the
// board itself versions it.

import limits from "../../../config/app_limits.json";
import { currentUser, type User } from "../auth";
import { all, batch, newUuid, now, one, statement, type Row } from "../db";
import { json, readJson, refuse, type RouteContext, type Router } from "../http";
import { WEBPAGE, YOUTUBE, publicWebUrl, youtubeId } from "../jobs/capture";
import { enqueue, wake } from "../jobs/queue";
import { BOARD_FILES } from "../sync/blobs";
import { rowSnapshot } from "../sync/rows";
import { writeSynced } from "../sync/write";
import * as validate from "../validate";

const BOARD_FILE_LIMIT = limits.files.board_file_mb * 1024 * 1024;
const COORDINATE = limits.board.coordinate_abs_max;

// ---------------------------------------------------------------- shapes

interface Board extends Row {
  uuid: string;
  user_uuid: string;
  shelf_uuid: string | null;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  revision: number;
  deleted_at: string | null;
}

interface Item extends Row {
  uuid: string;
  board_uuid: string;
  group_uuid: string | null;
  kind: string;
  staged: number;
  deleted_at: string | null;
  x: number;
  y: number;
}

interface Group extends Row {
  uuid: string;
  board_uuid: string;
  kind: string;
  title: string;
  header: string | null;
  auto_arrange: number;
  deleted_at: string | null;
}

// What other users see of a user. The email travels only when they chose
// to show it.
export function userPublic(user: Row) {
  return {
    uuid: user.uuid, display_name: user.display_name, affiliation: user.affiliation ?? null,
    avatar_path: user.avatar_path ?? null, email: user.email_public ? user.email : null,
  };
}

async function itemOut(env: Env, item: Row) {
  const { revision: _r, updated_at: _u, ...out } = await rowSnapshot(env.DB, "board_items", item);
  return out;
}

function groupOut(group: Group, itemUuids: string[]) {
  return { uuid: group.uuid, kind: group.kind, title: group.title, header: group.header ?? "", auto_arrange: Boolean(group.auto_arrange), item_uuids: itemUuids };
}

export async function boardOut(env: Env, board: Board, { includeItems = false, canEdit = false } = {}) {
  const owner = await one(env.DB, "SELECT * FROM users WHERE uuid = ?", board.user_uuid);
  const items = await all<Item>(env.DB, "SELECT * FROM board_items WHERE board_uuid = ? AND deleted_at IS NULL ORDER BY position, created_at, uuid", board.uuid);
  const active = items.filter((i) => !i.staged), staged = items.filter((i) => i.staged);
  const groups = includeItems ? await all<Group>(env.DB, "SELECT * FROM board_groups WHERE board_uuid = ? AND deleted_at IS NULL ORDER BY created_at, uuid", board.uuid) : [];
  return {
    uuid: board.uuid, revision: board.revision, user_uuid: board.user_uuid, owner: owner ? userPublic(owner) : null,
    shelf_uuid: board.shelf_uuid, can_edit: canEdit, name: board.name, description: board.description,
    created_at: board.created_at, updated_at: board.updated_at, item_count: active.length,
    items: includeItems ? await Promise.all(active.map((i) => itemOut(env, i))) : [],
    staged_items: includeItems && canEdit ? await Promise.all(staged.map((i) => itemOut(env, i))) : [],
    groups: groups.map((g) => groupOut(g, items.filter((i) => i.group_uuid === g.uuid).map((i) => i.uuid))),
  };
}

// ------------------------------------------------------------- ownership

async function ownedBoard(env: Env, boardUuid: string, user: User): Promise<Board> {
  const board = await one<Board>(env.DB, "SELECT * FROM boards WHERE uuid = ? AND user_uuid = ? AND deleted_at IS NULL", boardUuid, user.uuid);
  // Do not reveal whether another user's private board exists.
  return board ?? refuse(404, "Board not found");
}

async function ownedItem(env: Env, itemUuid: string, user: User, { deleted = false } = {}): Promise<Item & { board: Board }> {
  const item = await one<Item>(env.DB, "SELECT * FROM board_items WHERE uuid = ?", itemUuid);
  const board = item ? await one<Board>(env.DB, "SELECT * FROM boards WHERE uuid = ?", item.board_uuid) : null;
  if (!item || !board || board.user_uuid !== user.uuid || (!deleted && item.deleted_at)) refuse(404, "Board item not found");
  return { ...item!, board: board! };
}

async function ownedGroup(env: Env, groupUuid: string, user: User): Promise<Group & { board: Board }> {
  const group = await one<Group>(env.DB, "SELECT * FROM board_groups WHERE uuid = ?", groupUuid);
  const board = group ? await one<Board>(env.DB, "SELECT * FROM boards WHERE uuid = ?", group.board_uuid) : null;
  if (!group || group.deleted_at || !board || board.user_uuid !== user.uuid) refuse(404, "Board group not found");
  return { ...group!, board: board! };
}

async function ownShelf(env: Env, shelfUuid: unknown, user: User): Promise<string> {
  const shelf = typeof shelfUuid === "string"
    ? await one<{ uuid: string }>(env.DB, "SELECT uuid FROM shelves WHERE uuid = ? AND user_uuid = ? AND deleted_at IS NULL", shelfUuid, user.uuid)
    : null;
  return shelf?.uuid ?? refuse(400, "Choose one of your shelves");
}

async function defaultShelf(env: Env, user: User): Promise<string | null> {
  const shelf = await one<{ uuid: string }>(env.DB,
    "SELECT uuid FROM shelves WHERE user_uuid = ? AND deleted_at IS NULL ORDER BY is_default DESC, position LIMIT 1", user.uuid);
  return shelf?.uuid ?? null;
}

function touched(env: Env, board: Board): D1PreparedStatement {
  board.updated_at = now();
  return statement(env.DB, "UPDATE boards SET updated_at = ? WHERE uuid = ?", board.updated_at, board.uuid);
}

async function activeItemCount(env: Env, board: Board): Promise<number> {
  return (await one<{ n: number }>(env.DB, "SELECT count(*) AS n FROM board_items WHERE board_uuid = ?", board.uuid))!.n;
}

function newItem(board: Board, fields: Row): Row {
  const at = now();
  return {
    uuid: newUuid(), board_uuid: board.uuid, group_uuid: null, kind: "comment", content: null, excerpt_text: null,
    file_path: null, sha256: null, original_filename: null, mime_type: null, source_url: null, source_label: null,
    staged: 0, text_align: "left", position: 0, x: 0, y: 0, width: 300, deleted_at: null, created_at: at, updated_at: at, revision: 0,
    ...fields,
  };
}

// A card's place when the caller names none: the next slot in a grid.
function slot(count: number): { x: number; y: number } {
  return { x: (count % 4) * 340, y: Math.floor(count / 4) * 260 };
}

async function writeItem(env: Env, board: Board, item: Row, isNew: boolean, more: D1PreparedStatement[] = []) {
  await batch(env.DB, [...await writeSynced(env.DB, "board_items", item, board.user_uuid, isNew), touched(env, board), ...more]);
  return json(await itemOut(env, item));
}

// An upload for a board, within the limit, stored under a name minted for
// this one write. Returns the key within the board files area and the digest.
async function receiveBoardFile(env: Env, board: Board, file: File, suffix: string, mime: string): Promise<{ key: string; digest: string }> {
  if (file.size > BOARD_FILE_LIMIT) refuse(413, `Board files may be at most ${limits.files.board_file_mb} MB`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > BOARD_FILE_LIMIT) refuse(413, `Board files may be at most ${limits.files.board_file_mb} MB`);
  const digestBytes = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  const digest = [...new Uint8Array(digestBytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const key = `${board.uuid}/${newUuid().replace(/-/g, "")}${suffix}`;
  await env.FILES.put(`${BOARD_FILES}${key}`, bytes, { httpMetadata: { contentType: mime } });
  return { key, digest };
}

async function form(request: Request): Promise<FormData> {
  try { return await request.formData(); } catch { return refuse(422, "The request is not a form"); }
}

function fileField(data: FormData, name = "file"): File {
  const value = data.get(name);
  return value instanceof File ? value : refuse(422, `${name} is required`);
}

function coordinate(field: string, value: unknown, optional = false): number | null {
  if (value === null || value === undefined || value === "") return optional ? null : refuse(422, `${field} is required`);
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || Math.abs(n) > COORDINATE) refuse(422, `${field} must be between ${-COORDINATE} and ${COORDINATE}`);
  return n;
}

// ---------------------------------------------------------------- routes

export function boardRoutes(router: Router) {
  router.on("GET", "/api/boards", async ({ request, env }) => {
    const user = await currentUser(request, env);
    const boards = await all<Board>(env.DB, "SELECT * FROM boards WHERE user_uuid = ? AND deleted_at IS NULL ORDER BY updated_at DESC, uuid DESC", user.uuid);
    return json(await Promise.all(boards.map((b) => boardOut(env, b, { canEdit: true }))));
  });

  // Boards whose shelves are public, for the shared Library.
  router.on("GET", "/api/library/boards", async ({ request, env }) => {
    const user = await currentUser(request, env);
    const boards = await all<Board>(env.DB,
      "SELECT b.* FROM boards b JOIN shelves s ON s.uuid = b.shelf_uuid WHERE s.is_public = 1 AND b.deleted_at IS NULL ORDER BY b.updated_at DESC, b.uuid DESC");
    return json(await Promise.all(boards.map((b) => boardOut(env, b, { canEdit: b.user_uuid === user.uuid }))));
  });

  router.on("POST", "/api/boards", async ({ request, env }) => {
    const user = await currentUser(request, env);
    const data = await readJson<Row>(request);
    const check = validate.checking();
    const name = check.string("name", data.name, { min: 1, max: limits.text.board_name });
    const description = check.string("description", data.description, { max: limits.text.board_description, optional: true });
    check.done();
    const shelf = data.shelf_uuid ? await ownShelf(env, data.shelf_uuid, user) : await defaultShelf(env, user);
    if (!shelf) refuse(400, "Choose one of your shelves");
    const at = now();
    const board: Board = {
      uuid: newUuid(), user_uuid: user.uuid, shelf_uuid: shelf, name: name!.trim(),
      description: description?.trim() || null, created_at: at, updated_at: at, revision: 0, deleted_at: null,
    };
    await batch(env.DB, await writeSynced(env.DB, "boards", board, user.uuid, true));
    return json(await boardOut(env, board, { canEdit: true }));
  });

  router.on("GET", "/api/boards/:uuid", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const board = await one<Board>(env.DB, "SELECT * FROM boards WHERE uuid = ? AND deleted_at IS NULL", params.uuid);
    if (!board) refuse(404, "Board not found");
    const canEdit = board.user_uuid === user.uuid;
    if (!canEdit) {
      const shelf = board.shelf_uuid ? await one<{ is_public: number }>(env.DB, "SELECT is_public FROM shelves WHERE uuid = ?", board.shelf_uuid) : null;
      if (!shelf?.is_public) refuse(404, "Board not found");
    }
    return json(await boardOut(env, board, { includeItems: true, canEdit }));
  });

  router.on("PUT", "/api/boards/:uuid", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const board = await ownedBoard(env, params.uuid, user);
    const data = await readJson<Row>(request);
    const check = validate.checking();
    if (data.name !== undefined && data.name !== null) board.name = check.string("name", data.name, { min: 1, max: limits.text.board_name })!.trim();
    if (data.description !== undefined && data.description !== null) {
      board.description = check.string("description", data.description, { max: limits.text.board_description })?.trim() || null;
    }
    check.done();
    if (data.shelf_uuid !== undefined && data.shelf_uuid !== null) board.shelf_uuid = await ownShelf(env, data.shelf_uuid, user);
    await batch(env.DB, await writeSynced(env.DB, "boards", board, user.uuid, false));
    return json(await boardOut(env, board, { includeItems: true, canEdit: true }));
  });

  router.on("DELETE", "/api/boards/:uuid", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const board = await ownedBoard(env, params.uuid, user);
    const at = now();
    board.deleted_at = at;
    const statements = await writeSynced(env.DB, "boards", board, user.uuid, false);
    for (const group of await all<Group>(env.DB, "SELECT * FROM board_groups WHERE board_uuid = ?", board.uuid)) {
      group.deleted_at = at;
      statements.push(...await writeSynced(env.DB, "board_groups", group, user.uuid, false));
    }
    for (const item of await all<Item>(env.DB, "SELECT * FROM board_items WHERE board_uuid = ?", board.uuid)) {
      item.deleted_at = at;
      statements.push(...await writeSynced(env.DB, "board_items", item, user.uuid, false));
    }
    await batch(env.DB, statements);
    return new Response(null, { status: 204 });
  });

  // ------------------------------------------------------------- cards

  router.on("POST", "/api/boards/:uuid/comments", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const board = await ownedBoard(env, params.uuid, user);
    const data = await readJson<Row>(request);
    const check = validate.checking();
    const content = check.string("content", data.content, { min: 1, max: limits.text.board_content });
    check.done();
    const where = slot(await activeItemCount(env, board));
    const item = newItem(board, {
      kind: "comment", content: content!.trim(),
      x: coordinate("x", data.x, true) ?? where.x, y: coordinate("y", data.y, true) ?? where.y,
    });
    return writeItem(env, board, item, true);
  });

  // A quoted passage sent to an owned board without placing it yet.
  router.on("POST", "/api/boards/:uuid/staging", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const board = await ownedBoard(env, params.uuid, user);
    const data = await readJson<Row>(request);
    const check = validate.checking();
    const excerpt = check.string("excerpt_text", data.excerpt_text, { min: 1, max: limits.text.board_content });
    const content = check.string("content", data.content, { max: limits.text.board_content, optional: true });
    const sourceUrl = check.string("source_url", data.source_url, { min: 1, max: limits.text.source_url, pattern: /^https?:\/\// });
    const sourceLabel = check.string("source_label", data.source_label, { min: 1, max: limits.text.source_label });
    check.done();
    const item = newItem(board, {
      kind: "excerpt", excerpt_text: excerpt!.trim(), content: content?.trim() || null,
      source_url: sourceUrl!.trim(), source_label: sourceLabel!.trim(), staged: 1,
    });
    return writeItem(env, board, item, true);
  });

  // A clipped PDF rectangle as an image, with its bounding-box backlink.
  router.on("POST", "/api/boards/:uuid/staging/clip", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const board = await ownedBoard(env, params.uuid, user);
    const data = await form(request);
    const caption = String(data.get("caption") ?? ""), sourceUrl = String(data.get("source_url") ?? ""), sourceLabel = String(data.get("source_label") ?? "");
    if (caption.length > limits.text.board_content || sourceUrl.length > limits.text.source_url || sourceLabel.length > limits.text.source_label) {
      refuse(422, "Clip metadata is too long");
    }
    if (!sourceUrl || !sourceLabel) refuse(422, "source_url and source_label are required");
    if (!/^https?:\/\//.test(sourceUrl)) refuse(422, "Invalid source URL");
    const { key, digest } = await receiveBoardFile(env, board, fileField(data), ".png", "image/png");
    const item = newItem(board, {
      kind: "image", content: caption.trim() || null, file_path: key, sha256: digest, original_filename: "paper-clip.png",
      mime_type: "image/png", source_url: sourceUrl.trim(), source_label: sourceLabel.trim(), staged: 1,
    });
    return writeItem(env, board, item, true);
  });

  router.on("POST", "/api/board-items/:uuid/place", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const item = await one<Item>(env.DB,
      `SELECT i.* FROM board_items i JOIN boards b ON b.uuid = i.board_uuid
       WHERE i.uuid = ? AND b.user_uuid = ? AND i.deleted_at IS NULL AND i.staged = 1`, params.uuid, user.uuid);
    if (!item) refuse(404, "Staged item not found");
    const data = await readJson<Row>(request);
    item.x = coordinate("x", data.x)!;
    item.y = coordinate("y", data.y)!;
    item.staged = 0;
    const board = (await one<Board>(env.DB, "SELECT * FROM boards WHERE uuid = ?", item.board_uuid))!;
    return writeItem(env, board, item, false);
  });

  router.on("POST", "/api/boards/:uuid/files", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const board = await ownedBoard(env, params.uuid, user);
    const data = await form(request);
    const caption = String(data.get("caption") ?? "");
    if (caption.length > limits.text.board_content) refuse(422, "Caption is too long");
    const file = fileField(data);
    const original = (file.name || "file").split(/[\\/]/).pop()!.slice(0, limits.text.uploaded_filename);
    const suffix = (original.match(/\.[^.]*$/)?.[0] ?? "").slice(0, limits.text.uploaded_suffix);
    const mime = (file.type || "application/octet-stream").slice(0, limits.text.mime_type);
    const { key, digest } = await receiveBoardFile(env, board, file, suffix, mime);
    const where = slot(await activeItemCount(env, board));
    const item = newItem(board, {
      kind: mime.startsWith("image/") ? "image" : "file", content: caption.trim() || null,
      file_path: key, sha256: digest, original_filename: original, mime_type: mime,
      x: coordinate("x", data.get("x"), true) ?? where.x, y: coordinate("y", data.get("y"), true) ?? where.y,
    });
    return writeItem(env, board, item, true);
  });

  // A link card, on the board at once; its picture is a job. The link is
  // checked here, so a URL that is not a video is refused now rather than
  // by a worker later; the client polls the job to learn when the card
  // has its picture.
  router.on("POST", "/api/boards/:uuid/youtube", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const board = await ownedBoard(env, params.uuid, user);
    const data = await readJson<Row>(request);
    const url = validate.checking().string("url", data.url, { min: 1, max: limits.text.external_url }) ?? refuse(422, "url is required");
    const videoId = youtubeId(url);
    if (!videoId) refuse(422, "Paste a valid YouTube video URL");
    const item = newItem(board, { kind: "youtube", content: url.trim(), source_url: url.trim(), x: coordinate("x", data.x)!, y: coordinate("y", data.y)! });
    const job = enqueue(env.DB, YOUTUBE, { item_uuid: item.uuid, url: url.trim(), video_id: videoId }, { userUuid: user.uuid });
    await batch(env.DB, [...await writeSynced(env.DB, "board_items", item, user.uuid, true), touched(env, board), job.statement]);
    await wake(env, [job.uuid]);
    return json({ job: job.uuid, item: await itemOut(env, item) }, { status: 202 });
  });

  router.on("POST", "/api/boards/:uuid/webpage", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const board = await ownedBoard(env, params.uuid, user);
    const data = await readJson<Row>(request);
    const given = validate.checking().string("url", data.url, { min: 1, max: limits.text.external_url }) ?? refuse(422, "url is required");
    const url = publicWebUrl(given);
    const hostname = new URL(url).hostname;
    const item = newItem(board, { kind: "webpage", content: hostname, source_url: url, x: coordinate("x", data.x)!, y: coordinate("y", data.y)!, width: 480 });
    const job = enqueue(env.DB, WEBPAGE, { item_uuid: item.uuid, url }, { userUuid: user.uuid });
    await batch(env.DB, [...await writeSynced(env.DB, "board_items", item, user.uuid, true), touched(env, board), job.statement]);
    await wake(env, [job.uuid]);
    return json({ job: job.uuid, item: await itemOut(env, item) }, { status: 202 });
  });

  router.on("DELETE", "/api/board-items/:uuid", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const { board, ...item } = await ownedItem(env, params.uuid, user);
    item.deleted_at = now();
    await batch(env.DB, [...await writeSynced(env.DB, "board_items", item, user.uuid, false), touched(env, board)]);
    return new Response(null, { status: 204 });
  });

  router.on("POST", "/api/board-items/:uuid/restore", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const { board, ...item } = await ownedItem(env, params.uuid, user, { deleted: true });
    item.deleted_at = null;
    return writeItem(env, board, item, false);
  });

  router.on("PUT", "/api/board-items/:uuid", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const { board, ...item } = await ownedItem(env, params.uuid, user);
    const data = await readJson<Row>(request);
    if ("group_uuid" in data) {
      if (data.group_uuid === null) item.group_uuid = null;
      else {
        const group = await one<{ uuid: string }>(env.DB, "SELECT uuid FROM board_groups WHERE uuid = ? AND board_uuid = ?", data.group_uuid, item.board_uuid);
        item.group_uuid = group?.uuid ?? refuse(400, "Booklet not found on this board");
      }
    }
    const check = validate.checking();
    if (data.x != null) item.x = check.number("x", data.x, { min: -COORDINATE, max: COORDINATE })!;
    if (data.y != null) item.y = check.number("y", data.y, { min: -COORDINATE, max: COORDINATE })!;
    if (data.width != null) item.width = check.number("width", data.width, { min: limits.board.item_width_min, max: limits.board.item_width_max })!;
    if (data.position != null) item.position = check.integer("position", data.position, { min: 0, max: limits.board.position_max })!;
    if (data.content != null) item.content = check.string("content", data.content, { max: limits.text.board_content })!.trim() || null;
    if (data.text_align != null) item.text_align = check.oneOf("text_align", data.text_align, validate.TEXT_ALIGNS)!;
    check.done();
    return writeItem(env, board, item, false);
  });

  // ------------------------------------------------------------ groups

  router.on("POST", "/api/boards/:uuid/groups", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const board = await ownedBoard(env, params.uuid, user);
    const data = await readJson<Row>(request);
    const check = validate.checking();
    const kind = check.oneOf("kind", data.kind ?? "booklet", validate.BOARD_GROUP_KINDS)!;
    const title = check.string("title", data.title ?? "", { max: limits.text.board_group_title }) ?? "";
    const header = check.string("header", data.header ?? "", { max: limits.text.board_group_header }) ?? "";
    const autoArrange = check.boolean("auto_arrange", data.auto_arrange ?? false)!;
    if (!Array.isArray(data.item_uuids) || data.item_uuids.length < 2 || data.item_uuids.length > limits.counts.board_group_items) {
      check.fail(`item_uuids must hold between 2 and ${limits.counts.board_group_items} items`);
    }
    check.done();
    const itemUuids = [...new Set((data.item_uuids as unknown[]).map(String))];
    if (itemUuids.length < 2) refuse(400, "Select at least two items");
    const items = await all<Item>(env.DB,
      `SELECT * FROM board_items WHERE board_uuid = ? AND deleted_at IS NULL AND uuid IN (${itemUuids.map(() => "?").join(",")})`, board.uuid, ...itemUuids);
    if (items.length !== itemUuids.length) refuse(400, "Some selected items are unavailable");
    const at = now();
    const group: Group = {
      uuid: newUuid(), board_uuid: board.uuid, kind, title: title.trim(), header: header.trim() || null,
      auto_arrange: kind === "collection" && autoArrange ? 1 : 0, created_at: at, updated_at: at, revision: 0, deleted_at: null,
    };
    const statements = await writeSynced(env.DB, "board_groups", group, user.uuid, true);
    const anchorX = Math.min(...items.map((i) => i.x));
    for (const item of items) {
      item.group_uuid = group.uuid;
      if (kind === "booklet") item.x = anchorX;
      statements.push(...await writeSynced(env.DB, "board_items", item, user.uuid, false));
    }
    await batch(env.DB, [...statements, touched(env, board)]);
    return json(groupOut(group, itemUuids));
  });

  router.on("PUT", "/api/board-groups/:uuid/move", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const { board, ...group } = await ownedGroup(env, params.uuid, user);
    const data = await readJson<Row>(request);
    const dx = coordinate("dx", data.dx)!, dy = coordinate("dy", data.dy)!;
    const items = await all<Item>(env.DB, "SELECT * FROM board_items WHERE group_uuid = ? AND deleted_at IS NULL ORDER BY position, created_at, uuid", group.uuid);
    const statements: D1PreparedStatement[] = [];
    for (const item of items) {
      item.x += dx;
      item.y += dy;
      statements.push(...await writeSynced(env.DB, "board_items", item, user.uuid, false));
    }
    await batch(env.DB, [...statements, touched(env, board)]);
    return json(await Promise.all(items.map((i) => itemOut(env, i))));
  });

  router.on("PUT", "/api/board-groups/:uuid", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const { board, ...group } = await ownedGroup(env, params.uuid, user);
    const data = await readJson<Row>(request);
    const check = validate.checking();
    if (data.title != null) group.title = check.string("title", data.title, { max: limits.text.board_group_title })!.trim();
    if (data.header != null) group.header = check.string("header", data.header, { max: limits.text.board_group_header })!.trim() || null;
    check.done();
    if (data.auto_arrange != null) {
      if (group.kind !== "collection") refuse(400, "Only collections can use auto-arrange");
      group.auto_arrange = data.auto_arrange ? 1 : 0;
    }
    await batch(env.DB, [...await writeSynced(env.DB, "board_groups", group, user.uuid, false), touched(env, board)]);
    const members = await all<{ uuid: string }>(env.DB, "SELECT uuid FROM board_items WHERE group_uuid = ? AND deleted_at IS NULL ORDER BY position, created_at, uuid", group.uuid);
    return json(groupOut(group, members.map((m) => m.uuid)));
  });

  router.on("POST", "/api/board-groups/:uuid/ungroup", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const { board, ...group } = await ownedGroup(env, params.uuid, user);
    const data = await readJson<{ items?: Row[] }>(request);
    const entries = Array.isArray(data.items) ? data.items : [];
    if (entries.length < 2 || entries.length > limits.counts.board_group_items) refuse(422, "items must name every card of the group");
    const members = await all<Item>(env.DB, "SELECT * FROM board_items WHERE group_uuid = ? AND deleted_at IS NULL", group.uuid);
    const current = new Set(members.map((m) => m.uuid)), restored = new Set(entries.map((e) => String(e.uuid)));
    if (current.size !== restored.size || [...current].some((u) => !restored.has(u))) refuse(400, "Group membership changed");
    const targets = [...new Set(entries.map((e) => e.group_uuid).filter((g): g is string => typeof g === "string"))];
    if (targets.length) {
      const known = await one<{ n: number }>(env.DB,
        `SELECT count(*) AS n FROM board_groups WHERE board_uuid = ? AND uuid IN (${targets.map(() => "?").join(",")})`, group.board_uuid, ...targets);
      if (known!.n !== targets.length) refuse(400, "A previous group no longer exists");
    }
    group.deleted_at = now();
    const statements = await writeSynced(env.DB, "board_groups", group, user.uuid, false);
    const byUuid = new Map(members.map((m) => [m.uuid, m]));
    for (const entry of entries) {
      const item = byUuid.get(String(entry.uuid))!;
      const target = typeof entry.group_uuid === "string"
        ? await one<{ uuid: string }>(env.DB, "SELECT uuid FROM board_groups WHERE uuid = ? AND board_uuid = ? AND deleted_at IS NULL", entry.group_uuid, group.board_uuid)
        : null;
      item.group_uuid = target?.uuid ?? null;
      item.x = coordinate("x", entry.x)!;
      item.y = coordinate("y", entry.y)!;
      statements.push(...await writeSynced(env.DB, "board_items", item, user.uuid, false));
    }
    await batch(env.DB, [...statements, touched(env, board)]);
    return new Response(null, { status: 204 });
  });

  router.on("PUT", "/api/board-groups/:uuid/layout", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const { board, ...group } = await ownedGroup(env, params.uuid, user);
    const data = await readJson<{ items?: Row[] }>(request);
    const entries = Array.isArray(data.items) ? data.items : [];
    const members = await all<Item>(env.DB, "SELECT * FROM board_items WHERE group_uuid = ? AND deleted_at IS NULL", group.uuid);
    const byUuid = new Map(members.map((m) => [m.uuid, m]));
    const named = new Set(entries.map((e) => String(e.uuid)));
    if (named.size !== byUuid.size || [...byUuid.keys()].some((u) => !named.has(u))) refuse(400, "Group membership changed");
    const statements: D1PreparedStatement[] = [];
    const placed: Item[] = [];
    for (const entry of entries) {
      const item = byUuid.get(String(entry.uuid))!;
      item.x = coordinate("x", entry.x)!;
      item.y = coordinate("y", entry.y)!;
      statements.push(...await writeSynced(env.DB, "board_items", item, user.uuid, false));
      placed.push(item);
    }
    await batch(env.DB, [...statements, touched(env, board)]);
    return json(await Promise.all(placed.map((i) => itemOut(env, i))));
  });

  // Board files are write-once: edits change card metadata, never the
  // bytes at this URL, so a private file may sit in the user's cache for
  // good. Served from the bucket by the Worker; the desktop and the
  // browser see one origin.
  router.on("GET", "/api/board-items/:uuid/file", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const item = await one<Item & { file_path: string | null; mime_type: string | null; original_filename: string | null }>(env.DB, "SELECT * FROM board_items WHERE uuid = ?", params.uuid);
    const board = item ? await one<Board>(env.DB, "SELECT * FROM boards WHERE uuid = ?", item.board_uuid) : null;
    if (!item?.file_path || !board) refuse(404, "Board file not found");
    if (board.user_uuid !== user.uuid) {
      const shelf = board.shelf_uuid ? await one<{ is_public: number }>(env.DB, "SELECT is_public FROM shelves WHERE uuid = ?", board.shelf_uuid) : null;
      if (!shelf?.is_public) refuse(404, "Board file not found");
    }
    const object = await env.FILES.get(`${BOARD_FILES}${item.file_path}`);
    if (!object) refuse(404, "Board file not found");
    const headers: Record<string, string> = {
      "content-type": item.mime_type ?? "application/octet-stream",
      "content-length": String(object.size),
      "cache-control": "private, max-age=31536000, immutable",
    };
    if (item.original_filename) headers["content-disposition"] = `attachment; filename="${item.original_filename.replace(/["\\]/g, "")}"`;
    return new Response(object.body, { headers });
  });
}

export type { RouteContext };
