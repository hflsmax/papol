// Digs: one person's writing about one thing a project holds: a paper, a
// member's thought on a paper, a board, a card on a board, or an
// annotation a member left on one of the papers. Never the project
// itself, which would be about nothing in particular, and never another
// dig or a post in one.
//
// A dig is its owner's: they started it, and a thing holds one dig per
// person. Anyone who can see a dig can post in it. The first post opens a
// dig and the last one taken back closes it.
//
// The routes still answer at their old /discussion paths for the Mac
// builds that ask there.

import limits from "../../../config/app_limits.json";
import { currentUser, type User } from "../auth";
import { all, batch, insert, newUuid, now, one, statement, update, type Row } from "../db";
import { json, readJson, refuse, type Router } from "../http";
import * as validate from "../validate";
import { userPublic } from "./boards";
import { digsOf, liveProject, membership, SUBJECT_COLUMNS, SUBJECT_JOINS, subjectOut, type Member, type Project } from "./projects";

const DIGEST = /^[0-9a-f]{64}$/;

interface Dig extends Row {
  uuid: string;
  user_uuid: string;
  project_uuid: string;
  subject: string;
  paper_sha256: string | null;
  take_user_uuid: string | null;
  board_uuid: string | null;
  board_item_uuid: string | null;
  annotation_uuid: string | null;
  created_at: string;
  updated_at: string;
}

function postBody(value: unknown): string {
  const check = validate.checking();
  const body = check.string("body", value, { min: 1, max: limits.text.discussion_post });
  check.done();
  return body!.trim() || refuse(422, "body is required");
}

export interface Subject {
  subject: string;
  paper_sha256: string | null;
  take_user_uuid: string | null;
  board_uuid: string | null;
  board_item_uuid: string | null;
  annotation_uuid: string | null;
}

const NONE = { paper_sha256: null, take_user_uuid: null, board_uuid: null, board_item_uuid: null, annotation_uuid: null };

async function paperIn(env: Env, project: Project, value: string): Promise<string> {
  const digest = value.toLowerCase();
  if (!DIGEST.test(digest) || !(await one(env.DB, "SELECT 1 FROM project_papers WHERE project_uuid = ? AND paper_sha256 = ?", project.uuid, digest))) {
    refuse(404, "That paper is not in this project");
  }
  return digest;
}

// Which subject a request names, checked to be in the project. A subject
// is named by its key; `paper_sha256` and `board_item_uuid` still name a
// paper and a card.
async function subjectOf(env: Env, project: Project, data: Row): Promise<Subject> {
  let key = typeof data.subject === "string" ? data.subject : null;
  if (!key && typeof data.paper_sha256 === "string") key = `paper:${data.paper_sha256}`;
  if (!key && typeof data.board_item_uuid === "string") key = `card:${data.board_item_uuid}`;
  if (!key) return refuse(422, "Say what the dig is about");
  const [kind, first, second] = key.split(":");
  if (kind === "paper" && first && second === undefined) {
    const digest = await paperIn(env, project, first);
    return { ...NONE, subject: `paper:${digest}`, paper_sha256: digest };
  }
  if (kind === "take" && first && second) {
    const digest = await paperIn(env, project, first);
    const holder = await one(env.DB,
      `SELECT 1 FROM project_members m JOIN copies c ON c.user_uuid = m.user_uuid AND c.paper_sha256 = ? AND c.deleted_at IS NULL
       WHERE m.project_uuid = ? AND m.user_uuid = ?`, digest, project.uuid, second);
    if (!holder) refuse(404, "That member has no copy of this paper");
    return { ...NONE, subject: `take:${digest}:${second}`, paper_sha256: digest, take_user_uuid: second };
  }
  if (kind === "board" && first && second === undefined) {
    const board = await one(env.DB,
      "SELECT 1 FROM project_boards pb JOIN boards b ON b.uuid = pb.board_uuid WHERE pb.project_uuid = ? AND b.uuid = ? AND b.deleted_at IS NULL",
      project.uuid, first);
    if (!board) refuse(404, "That board is not in this project");
    return { ...NONE, subject: `board:${first}`, board_uuid: first };
  }
  if (kind === "card" && first && second === undefined) {
    const card = await one(env.DB,
      `SELECT 1 FROM board_items bi JOIN project_boards pb ON pb.board_uuid = bi.board_uuid JOIN boards b ON b.uuid = bi.board_uuid
       WHERE bi.uuid = ? AND pb.project_uuid = ? AND bi.deleted_at IS NULL AND b.deleted_at IS NULL`, first, project.uuid);
    if (!card) refuse(404, "That card is not on this project's boards");
    return { ...NONE, subject: `card:${first}`, board_item_uuid: first };
  }
  // A member's note, ink or clip on one of the project's papers: what the
  // viewer shows every member once the project is on. Its author's alone
  // to change; the project's to dig into.
  if (kind === "annotation" && first && second === undefined) {
    const annotation = await one<{ paper_sha256: string }>(env.DB,
      `SELECT a.paper_sha256 FROM annotations a
       JOIN project_papers pp ON pp.paper_sha256 = a.paper_sha256 AND pp.project_uuid = ?
       JOIN project_members m ON m.user_uuid = a.user_uuid AND m.project_uuid = pp.project_uuid
       WHERE a.uuid = ? AND a.deleted_at IS NULL`, project.uuid, first);
    if (!annotation) refuse(404, "That annotation is not on one of this project's papers");
    return { ...NONE, subject: `annotation:${first}`, paper_sha256: annotation!.paper_sha256, annotation_uuid: first };
  }
  return refuse(422, "That is not something a dig can be about");
}

function mine(env: Env, project: Project, subject: Subject, me: User) {
  return one<Dig>(env.DB, "SELECT * FROM digs WHERE project_uuid = ? AND subject = ? AND user_uuid = ?", project.uuid, subject.subject, me.uuid);
}

async function subjectRow(env: Env, projectUuid: string, subject: Subject): Promise<Row> {
  return (await one<Row>(env.DB,
    `SELECT d.*, ${SUBJECT_COLUMNS}
     FROM (SELECT ? AS subject, ? AS project_uuid, ? AS paper_sha256, ? AS take_user_uuid, ? AS board_uuid, ? AS board_item_uuid, ? AS annotation_uuid) d
     ${SUBJECT_JOINS}`,
    subject.subject, projectUuid, subject.paper_sha256, subject.take_user_uuid, subject.board_uuid, subject.board_item_uuid, subject.annotation_uuid))!;
}

async function openDig(env: Env, uuid: string, me: User): Promise<{ dig: Dig; project: Project; member: Member }> {
  const dig = await one<Dig>(env.DB, "SELECT * FROM digs WHERE uuid = ?", uuid);
  if (!dig) refuse(404, "Dig not found");
  const project = await liveProject(env, dig!.project_uuid);
  const member = await membership(env, project, me);
  return { dig: dig!, project, member };
}

const PERSON = "u.uuid, u.display_name, u.affiliation, u.avatar_path, u.email, u.email_public";

async function digOut(env: Env, dig: Dig, project: Project, me: User, member: Member) {
  const posts = await all<Row>(env.DB,
    `SELECT dp.*, u.display_name, u.affiliation, u.avatar_path, u.email, u.email_public FROM dig_posts dp JOIN users u ON u.uuid = dp.user_uuid
     WHERE dp.dig_uuid = ? ORDER BY dp.created_at, dp.uuid`, dig.uuid);
  const owner = await one<Row>(env.DB, `SELECT ${PERSON} FROM users u WHERE u.uuid = ?`, dig.user_uuid);
  return {
    uuid: dig.uuid, created_at: dig.created_at, updated_at: dig.updated_at,
    project: { uuid: project.uuid, name: project.name },
    subject: subjectOut(await subjectRow(env, project.uuid, dig)),
    owner: owner ? userPublic(owner) : null, is_mine: dig.user_uuid === me.uuid,
    can_moderate: Boolean(member.is_keeper),
    posts: posts.map((p) => ({
      uuid: p.uuid, user: userPublic({ ...p, uuid: p.user_uuid }), body: p.body,
      created_at: p.created_at, edited_at: p.edited_at, is_mine: p.user_uuid === me.uuid,
    })),
  };
}

function newPost(dig: Dig, me: User, body: string, at: string): Row {
  return { uuid: newUuid(), dig_uuid: dig.uuid, user_uuid: me.uuid, body, created_at: at, edited_at: null };
}

// Every dig on each of the given subjects, folded into what one pin on it
// shows: how much has been written, whether any of it is new to this
// member, who wrote, and the dig the pin opens (their own, or else the
// latest).
export async function pinsOf(env: Env, projectUuid: string, me: User, member: Member, subjects?: string[]) {
  const rows = await all<Row>(env.DB,
    `SELECT d.uuid, d.subject, d.user_uuid,
            (SELECT count(*) FROM dig_posts dp WHERE dp.dig_uuid = d.uuid) AS post_count,
            (SELECT count(*) FROM dig_posts dp WHERE dp.dig_uuid = d.uuid AND dp.created_at > ? AND dp.user_uuid != ?) AS unread,
            (SELECT group_concat(user_uuid) FROM (SELECT DISTINCT dp.user_uuid FROM dig_posts dp WHERE dp.dig_uuid = d.uuid)) AS voices
     FROM digs d WHERE d.project_uuid = ? ${subjects ? `AND d.subject IN (${subjects.map(() => "?").join(",")})` : ""}
     ORDER BY d.updated_at DESC, d.uuid`,
    member.seen_at, me.uuid, projectUuid, ...(subjects ?? []));
  const people = await usersByUuid(env, rows.flatMap((d) => String(d.voices ?? "").split(",").filter(Boolean)));
  const pins: Record<string, { uuid: string; mine: string | null; dig_count: number; post_count: number; unread: number; is_new: boolean; voices: unknown[] }> = {};
  for (const d of rows) {
    const key = String(d.subject);
    const pin = pins[key] ??= { uuid: String(d.uuid), mine: null, dig_count: 0, post_count: 0, unread: 0, is_new: false, voices: [] };
    if (d.user_uuid === me.uuid) pin.uuid = pin.mine = String(d.uuid);
    pin.dig_count += 1;
    pin.post_count += Number(d.post_count);
    pin.unread += Number(d.unread);
    pin.is_new = pin.unread > 0;
    for (const uuid of String(d.voices ?? "").split(",").filter(Boolean)) {
      const person = people.get(uuid) as { uuid?: string } | undefined;
      if (person && !pin.voices.some((v) => (v as { uuid?: string }).uuid === person.uuid)) pin.voices.push(person);
    }
  }
  return pins;
}

async function usersByUuid(env: Env, uuids: string[]) {
  const unique = [...new Set(uuids)];
  if (!unique.length) return new Map<string, unknown>();
  const rows = await all<Row>(env.DB, `SELECT ${PERSON} FROM users u WHERE u.uuid IN (${unique.map(() => "?").join(",")})`, ...unique);
  return new Map<string, unknown>(rows.map((u) => [u.uuid as string, userPublic(u)]));
}

// Every dig on one subject, owners first by who wrote last.
async function digsOn(env: Env, project: Project, me: User, member: Member, subject: string) {
  return (await digsOf(env, project.uuid, me, member)).filter((d) => d.subject.key === subject);
}

export function digRoutes(router: Router) {
  // Where a pin on a subject leads: every dig on it, the member's own
  // among them if they have one, and what it is about, to write the first
  // post under. `discussion_uuid` is for the builds that open one dig.
  const onSubject = async ({ request, env, params, url }: { request: Request; env: Env; params: Record<string, string>; url: URL }) => {
    const me = await currentUser(request, env);
    const project = await liveProject(env, params.uuid);
    const member = await membership(env, project, me);
    const subject = await subjectOf(env, project, {
      subject: url.searchParams.get("subject") ?? undefined,
      paper_sha256: url.searchParams.get("paper") ?? undefined, board_item_uuid: url.searchParams.get("card") ?? undefined,
    });
    const digs = await digsOn(env, project, me, member, subject.subject);
    const own = digs.find((d) => d.is_mine) ?? null;
    return json({
      mine: own?.uuid ?? null, discussion_uuid: own?.uuid ?? digs[0]?.uuid ?? null, digs,
      project: { uuid: project.uuid, name: project.name }, subject: subjectOut(await subjectRow(env, project.uuid, subject)),
    });
  };
  router.on("GET", "/api/projects/:uuid/digs", onSubject);
  router.on("GET", "/api/projects/:uuid/discussion", onSubject);

  // A post under a subject goes into the writer's own dig on it, which the
  // first one opens.
  const write = async ({ request, env, params }: { request: Request; env: Env; params: Record<string, string> }) => {
    const me = await currentUser(request, env);
    const project = await liveProject(env, params.uuid);
    const member = await membership(env, project, me);
    const data = await readJson<Row>(request);
    const subject = await subjectOf(env, project, data);
    const body = postBody(data.body);
    const at = now();
    let dig = await mine(env, project, subject, me);
    const statements: D1PreparedStatement[] = [];
    if (dig) {
      statements.push(update(env.DB, "digs", "uuid", dig.uuid, { updated_at: at }));
    } else {
      dig = { uuid: newUuid(), user_uuid: me.uuid, project_uuid: project.uuid, ...subject, created_at: at, updated_at: at };
      statements.push(insert(env.DB, "digs", dig));
    }
    statements.push(insert(env.DB, "dig_posts", newPost(dig, me, body, at)));
    await batch(env.DB, statements);
    return json(await digOut(env, { ...dig, updated_at: at }, project, me, member));
  };
  router.on("POST", "/api/projects/:uuid/digs", write);
  router.on("POST", "/api/projects/:uuid/discussions", write);

  const read = async ({ request, env, params }: { request: Request; env: Env; params: Record<string, string> }) => {
    const me = await currentUser(request, env);
    const { dig, project, member } = await openDig(env, params.uuid, me);
    return json(await digOut(env, dig, project, me, member));
  };
  router.on("GET", "/api/digs/:uuid", read);
  router.on("GET", "/api/discussions/:uuid", read);

  // Anyone who can see a dig writes in it.
  const reply = async ({ request, env, params }: { request: Request; env: Env; params: Record<string, string> }) => {
    const me = await currentUser(request, env);
    const { dig, project, member } = await openDig(env, params.uuid, me);
    const body = postBody((await readJson<Row>(request)).body);
    const at = now();
    await batch(env.DB, [
      insert(env.DB, "dig_posts", newPost(dig, me, body, at)),
      update(env.DB, "digs", "uuid", dig.uuid, { updated_at: at }),
    ]);
    return json(await digOut(env, { ...dig, updated_at: at }, project, me, member));
  };
  router.on("POST", "/api/digs/:uuid/posts", reply);
  router.on("POST", "/api/discussions/:uuid/posts", reply);

  // Only its writer changes a post.
  const change = async ({ request, env, params }: { request: Request; env: Env; params: Record<string, string> }) => {
    const me = await currentUser(request, env);
    const post = await one<Row>(env.DB, "SELECT * FROM dig_posts WHERE uuid = ?", params.uuid);
    if (!post) refuse(404, "Post not found");
    const { dig, project, member } = await openDig(env, String(post!.dig_uuid), me);
    if (post!.user_uuid !== me.uuid) refuse(403, "Only its writer can change a post");
    const body = postBody((await readJson<Row>(request)).body);
    await batch(env.DB, [update(env.DB, "dig_posts", "uuid", post!.uuid as string, { body, edited_at: now() })]);
    return json(await digOut(env, dig, project, me, member));
  };
  router.on("PUT", "/api/dig-posts/:uuid", change);
  router.on("PUT", "/api/discussion-posts/:uuid", change);

  // Its writer, or a keeper, takes a post back. A dig with nothing left in
  // it is gone.
  const takeBack = async ({ request, env, params }: { request: Request; env: Env; params: Record<string, string> }) => {
    const me = await currentUser(request, env);
    const post = await one<Row>(env.DB, "SELECT * FROM dig_posts WHERE uuid = ?", params.uuid);
    if (!post) refuse(404, "Post not found");
    const { dig, project, member } = await openDig(env, String(post!.dig_uuid), me);
    if (post!.user_uuid !== me.uuid && !member.is_keeper) refuse(403, "Only its writer or a keeper can take a post back");
    const left = await one<{ n: number }>(env.DB, "SELECT count(*) AS n FROM dig_posts WHERE dig_uuid = ? AND uuid != ?", dig.uuid, post!.uuid);
    if (!left!.n) {
      await batch(env.DB, [
        statement(env.DB, "DELETE FROM dig_posts WHERE dig_uuid = ?", dig.uuid),
        statement(env.DB, "DELETE FROM digs WHERE uuid = ?", dig.uuid),
      ]);
      return new Response(null, { status: 204 });
    }
    await batch(env.DB, [statement(env.DB, "DELETE FROM dig_posts WHERE uuid = ?", post!.uuid)]);
    return json(await digOut(env, dig, project, me, member));
  };
  router.on("DELETE", "/api/dig-posts/:uuid", takeBack);
  router.on("DELETE", "/api/discussion-posts/:uuid", takeBack);
}
