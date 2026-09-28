// People and their nooks: the Library's users, one user's corner of it,
// their shelves and their tags, and the Library's own list of papers.

import limits from "../../../config/app_limits.json";
import { currentUser, type User } from "../auth";
import { all, batch, newUuid, now, one, statement, type Row } from "../db";
import { json, readJson, refuse, type Router } from "../http";
import { paperListEntries } from "../papers/list";
import { writeSynced } from "../sync/write";
import * as validate from "../validate";
import { userPublic } from "./boards";
import { projectsOfUser } from "./projects";

interface Shelf extends Row {
  uuid: string;
  user_uuid: string;
  name: string;
  color: string;
  is_public: number;
  is_default: number;
  position: number;
  deleted_at: string | null;
}

async function liveShelves(env: Env, userUuid: string): Promise<Shelf[]> {
  return all<Shelf>(env.DB, "SELECT * FROM shelves WHERE user_uuid = ? AND deleted_at IS NULL ORDER BY position, created_at", userUuid);
}

async function shelfOut(env: Env, shelf: Shelf) {
  const papers = await one<{ n: number }>(env.DB, "SELECT count(*) AS n FROM copies WHERE shelf_uuid = ? AND deleted_at IS NULL", shelf.uuid);
  const boards = await one<{ n: number }>(env.DB, "SELECT count(*) AS n FROM boards WHERE shelf_uuid = ? AND deleted_at IS NULL", shelf.uuid);
  return {
    uuid: shelf.uuid, name: shelf.name, color: shelf.color, is_public: Boolean(shelf.is_public),
    is_default: Boolean(shelf.is_default), position: shelf.position, paper_count: papers!.n, board_count: boards!.n,
  };
}

async function ownShelf(env: Env, shelfUuid: string, user: User): Promise<Shelf> {
  const shelf = await one<Shelf>(env.DB, "SELECT * FROM shelves WHERE uuid = ? AND user_uuid = ?", shelfUuid, user.uuid);
  return shelf ?? refuse(404, "Shelf not found");
}

// One space between words, none around: how a name is kept.
function tidy(name: string): string {
  return name.split(/\s+/).filter(Boolean).join(" ");
}

export function nookRoutes(router: Router) {
  // Every user in the Library. Signed-in users only.
  router.on("GET", "/api/users", async ({ request, env }) => {
    await currentUser(request, env);
    const users = await all<Row>(env.DB,
      `SELECT u.uuid, u.display_name, u.affiliation, u.avatar_path, u.email, u.email_public,
              (SELECT count(*) FROM copies c JOIN shelves s ON s.uuid = c.shelf_uuid
                WHERE c.user_uuid = u.uuid AND c.deleted_at IS NULL AND s.is_public = 1) AS paper_count
       FROM users u WHERE u.deleted_at IS NULL ORDER BY u.display_name`);
    return json(users.map((u) => ({ ...userPublic(u), paper_count: u.paper_count })));
  });

  // A user's nook. Signed-in users only; of another's copies, only what
  // each lets be seen.
  router.on("GET", "/api/users/:uuid/nook", async ({ request, env, params }) => {
    // Every trip to the database costs the same however little it asks,
    // so the nook is read in as few as can be: who asks and whose nook it
    // is, together; then everything of the nook in one batch; then what
    // the papers' rows need.
    const [me, user] = await Promise.all([
      currentUser(request, env),
      one<User>(env.DB, "SELECT * FROM users WHERE uuid = ?", params.uuid),
    ]);
    if (!user) refuse(404, "User not found");
    // A tombstone has no nook — the copies went with the account.
    if (user.deleted_at) refuse(404, "This user has left Papol");
    const hidePrivate = me.uuid !== user.uuid;
    const own = (sql: string) => statement(env.DB, sql, user.uuid);
    // On display means sitting on a public shelf, so the shelf is what the
    // question is put to; the shelfless are shown to nobody but their user.
    // A nook's boards are its user's own and in no project, so their owner
    // is the user and their project none.
    const reads = [
      own(`SELECT c.*, coalesce(s.is_public, 0) AS shelf_public FROM copies c LEFT JOIN shelves s ON s.uuid = c.shelf_uuid
           WHERE c.user_uuid = ? AND c.deleted_at IS NULL ${hidePrivate ? "AND s.is_public = 1" : ""} ORDER BY c.created_at DESC`),
      own(`SELECT * FROM papers WHERE sha256 IN (SELECT paper_sha256 FROM copies WHERE user_uuid = ? AND deleted_at IS NULL)`),
      own(`SELECT b.*, (SELECT count(*) FROM board_items i WHERE i.board_uuid = b.uuid AND i.deleted_at IS NULL AND NOT i.staged) AS item_count
           FROM boards b LEFT JOIN shelves s ON s.uuid = b.shelf_uuid
           WHERE b.user_uuid = ? AND b.deleted_at IS NULL ${hidePrivate ? "AND s.is_public = 1" : ""}
           AND b.uuid NOT IN (SELECT board_uuid FROM project_boards) ORDER BY b.updated_at DESC, b.uuid DESC`),
      own(`SELECT s.*,
             (SELECT count(*) FROM copies c WHERE c.shelf_uuid = s.uuid AND c.deleted_at IS NULL) AS paper_count,
             (SELECT count(*) FROM boards b WHERE b.shelf_uuid = s.uuid AND b.deleted_at IS NULL) AS board_count
           FROM shelves s WHERE s.user_uuid = ? AND s.deleted_at IS NULL ${hidePrivate ? "AND s.is_public = 1" : ""} ORDER BY s.position, s.created_at`),
      ...(hidePrivate ? [] : [
        own("SELECT count(*) AS n FROM annotations WHERE user_uuid = ? AND kind = 'note' AND deleted_at IS NULL"),
        own("SELECT uuid, name FROM tags WHERE user_uuid = ? AND deleted_at IS NULL ORDER BY lower(name)"),
        // The time spent on each paper is its user's alone: how long someone
        // spends on a paper says nothing a shelf was asked to show.
        own("SELECT subject, sum(seconds) AS seconds, max(ended_at) AS last_at FROM activity WHERE user_uuid = ? GROUP BY subject"),
      ]),
    ];
    const [results, projects] = await Promise.all([env.DB.batch<Row>(reads), projectsOfUser(env, user.uuid, me)]);
    const [copies, paperRows, boards, shelves, notes, tags, effortRows] = results.map((r) => r.results);
    const papers = new Map(paperRows.map((p) => [p.sha256, p]));
    const effort = effortRows && new Map(effortRows.map((r) => [r.subject as string, { seconds: r.seconds, last_at: r.last_at }]));
    const entries = await paperListEntries(env.DB, copies.map((c) => ({ paper: papers.get(c.paper_sha256)!, copy: { ...c, is_public: Boolean(c.shelf_public) } })), hidePrivate);
    const owner = userPublic(user);
    return json({
      user: owner,
      papers: entries.map((p) => ({ ...p, effort: effort?.get(p.sha256 as string) ?? null })),
      boards: boards.map((b) => ({
        uuid: b.uuid, revision: b.revision, user_uuid: b.user_uuid, owner, project: null, digs: {},
        shelf_uuid: b.shelf_uuid, can_edit: !hidePrivate, name: b.name, description: b.description,
        created_at: b.created_at, updated_at: b.updated_at, item_count: b.item_count,
        items: [], staged_items: [], papers: [], groups: [],
      })),
      stats: hidePrivate ? null : {
        papers: copies.length,
        displayed: copies.filter((c) => c.shelf_public).length,
        notes: (notes[0] as { n: number }).n,
      },
      tags: tags ?? [],
      projects,
      shelves: shelves.map((s) => ({
        uuid: s.uuid, name: s.name, color: s.color, is_public: Boolean(s.is_public),
        is_default: Boolean(s.is_default), position: s.position, paper_count: s.paper_count, board_count: s.board_count,
      })),
    });
  });

  // Every paper, newest first, one row per paper. Nothing is filtered
  // out: no user's shelf decides what the Library holds. What display
  // governs is the row of users shown against a paper.
  router.on("GET", "/api/papers", async ({ request, env }) => {
    await currentUser(request, env);
    const papers = await all<Row>(env.DB, "SELECT * FROM papers ORDER BY created_at DESC, sha256");
    return json(await paperListEntries(env.DB, papers.map((paper) => ({ paper })), true));
  });

  // ---------------------------------------------------------------- tags

  router.on("POST", "/api/tags", async ({ request, env }) => {
    const user = await currentUser(request, env);
    const data = await readJson<Row>(request);
    const check = validate.checking();
    const given = check.string("name", data.name, { min: 1, max: limits.text.tag_name });
    check.done();
    const name = tidy(given!);
    if (!name) refuse(400, "Tag name cannot be empty");
    const existing = await one<{ uuid: string; name: string }>(env.DB, "SELECT uuid, name FROM tags WHERE user_uuid = ? AND lower(name) = lower(?)", user.uuid, name);
    if (existing) return json(existing);
    const at = now();
    const tag = { uuid: newUuid(), user_uuid: user.uuid, name, created_at: at, updated_at: at, revision: 0, deleted_at: null };
    await batch(env.DB, await writeSynced(env.DB, "tags", tag, user.uuid, true));
    return json({ uuid: tag.uuid, name: tag.name });
  });

  router.on("GET", "/api/tags", async ({ request, env }) => {
    const user = await currentUser(request, env);
    return json(await all(env.DB, "SELECT uuid, name FROM tags WHERE user_uuid = ? AND deleted_at IS NULL ORDER BY lower(name)", user.uuid));
  });

  router.on("DELETE", "/api/tags/:uuid", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const tag = await one<Row>(env.DB, "SELECT * FROM tags WHERE uuid = ? AND user_uuid = ?", params.uuid, user.uuid);
    if (!tag) refuse(404, "Tag not found");
    const at = now();
    const statements: D1PreparedStatement[] = [];
    for (const link of await all<Row>(env.DB, "SELECT * FROM copy_tags WHERE tag_uuid = ? AND deleted_at IS NULL", tag.uuid)) {
      link.deleted_at = at;
      statements.push(...await writeSynced(env.DB, "copy_tags", link, user.uuid, false));
    }
    tag.deleted_at = at;
    statements.push(...await writeSynced(env.DB, "tags", tag, user.uuid, false));
    await batch(env.DB, statements);
    return new Response(null, { status: 204 });
  });

  // ------------------------------------------------------------- shelves

  router.on("GET", "/api/shelves", async ({ request, env }) => {
    const user = await currentUser(request, env);
    return json(await Promise.all((await liveShelves(env, user.uuid)).map((s) => shelfOut(env, s))));
  });

  router.on("POST", "/api/shelves", async ({ request, env }) => {
    const user = await currentUser(request, env);
    const data = await readJson<Row>(request);
    const check = validate.checking();
    const given = check.string("name", data.name, { min: 1, max: limits.text.shelf_name });
    const color = check.string("color", data.color, { pattern: validate.COLOR });
    const isPublic = check.boolean("is_public", data.is_public ?? false)!;
    check.done();
    const shelves = await liveShelves(env, user.uuid);
    if (shelves.length >= limits.counts.shelves_per_nook) refuse(400, `A nook can have at most ${limits.counts.shelves_per_nook} shelves`);
    const name = tidy(given!);
    if (shelves.some((s) => s.name.toLowerCase() === name.toLowerCase())) refuse(400, "You already have a shelf with that name");
    const at = now();
    const shelf: Shelf = {
      uuid: newUuid(), user_uuid: user.uuid, name, color: color!.toLowerCase(), is_public: isPublic ? 1 : 0,
      is_default: 0, position: shelves.length, created_at: at, updated_at: at, revision: 0, deleted_at: null,
    };
    await batch(env.DB, await writeSynced(env.DB, "shelves", shelf, user.uuid, true));
    return json(await shelfOut(env, shelf));
  });

  router.on("PUT", "/api/shelves/:uuid", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const shelf = await ownShelf(env, params.uuid, user);
    const data = await readJson<Row>(request);
    const check = validate.checking();
    const others = (await liveShelves(env, user.uuid)).filter((s) => s.uuid !== shelf.uuid);
    if (data.name !== undefined) {
      const name = tidy(check.string("name", data.name, { min: 1, max: limits.text.shelf_name }) ?? "");
      check.done();
      if (!name) refuse(400, "Shelf name cannot be empty");
      if (others.some((s) => s.name.toLowerCase() === name.toLowerCase())) refuse(400, "You already have a shelf with that name");
      shelf.name = name;
    }
    if (data.color !== undefined) shelf.color = check.string("color", data.color, { pattern: validate.COLOR })!.toLowerCase();
    check.done();
    const statements: D1PreparedStatement[] = [];
    if (data.is_public !== undefined && Boolean(data.is_public) !== Boolean(shelf.is_public)) {
      // Every copy on the shelf moves with it: none was holding a
      // visibility of its own to update.
      shelf.is_public = data.is_public ? 1 : 0;
    }
    if (data.is_default) {
      for (const other of others.filter((s) => s.is_default)) {
        other.is_default = 0;
        statements.push(...await writeSynced(env.DB, "shelves", other, user.uuid, false));
      }
      shelf.is_default = 1;
    }
    statements.push(...await writeSynced(env.DB, "shelves", shelf, user.uuid, false));
    await batch(env.DB, statements);
    return json(await shelfOut(env, shelf));
  });

  router.on("DELETE", "/api/shelves/:uuid", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const shelf = await ownShelf(env, params.uuid, user);
    const remaining = (await liveShelves(env, user.uuid)).filter((s) => s.uuid !== shelf.uuid);
    if (!remaining.length) refuse(400, "A nook must have at least one shelf");
    const destination = remaining.find((s) => s.is_default) ?? remaining[0];
    const copies = await all<Row>(env.DB, "SELECT * FROM copies WHERE shelf_uuid = ? AND deleted_at IS NULL", shelf.uuid);
    const statements: D1PreparedStatement[] = [];
    for (const copy of copies) {
      copy.shelf_uuid = destination.uuid;
      statements.push(...await writeSynced(env.DB, "copies", copy, user.uuid, false));
    }
    for (const board of await all<Row>(env.DB, "SELECT * FROM boards WHERE shelf_uuid = ? AND deleted_at IS NULL", shelf.uuid)) {
      board.shelf_uuid = destination.uuid;
      statements.push(...await writeSynced(env.DB, "boards", board, user.uuid, false));
    }
    if (shelf.is_default) {
      destination.is_default = 1;
      statements.push(...await writeSynced(env.DB, "shelves", destination, user.uuid, false));
    }
    shelf.deleted_at = now();
    statements.push(...await writeSynced(env.DB, "shelves", shelf, user.uuid, false));
    await batch(env.DB, statements);
    return new Response(null, { status: 204 });
  });
}
