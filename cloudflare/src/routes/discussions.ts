// Discussions: writing in a project about one thing in it. The thing can
// be anything the project holds: a paper, a member's thought on a paper, a
// board, a card on a board, or an annotation a member left on one of the
// papers. Never the project itself: a dig about the
// whole project would be about nothing in particular. A subject has one
// discussion, so talking about it always leads to the same place; the
// first post opens it and the last one taken back closes it.

import limits from "../../../config/app_limits.json";
import { currentUser, type User } from "../auth";
import { all, batch, insert, newUuid, now, one, statement, update, type Row } from "../db";
import { json, readJson, refuse, type Router } from "../http";
import * as validate from "../validate";
import { userPublic } from "./boards";
import { liveProject, membership, SUBJECT_COLUMNS, SUBJECT_JOINS, subjectOut, type Member, type Project } from "./projects";

const DIGEST = /^[0-9a-f]{64}$/;

interface Discussion extends Row {
  uuid: string;
  project_uuid: string;
  subject: string;
  paper_sha256: string | null;
  take_user_uuid: string | null;
  board_uuid: string | null;
  board_item_uuid: string | null;
  annotation_uuid: string | null;
  started_by: string;
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
  if (!key) return refuse(422, "Say what the discussion is about");
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
  return refuse(422, "That is not something a discussion can be about");
}

async function existing(env: Env, project: Project, subject: Subject) {
  return one<Discussion>(env.DB, "SELECT * FROM discussions WHERE project_uuid = ? AND subject = ?", project.uuid, subject.subject);
}

async function subjectRow(env: Env, projectUuid: string, subject: Subject): Promise<Row> {
  return (await one<Row>(env.DB,
    `SELECT d.*, ${SUBJECT_COLUMNS}
     FROM (SELECT ? AS subject, ? AS project_uuid, ? AS paper_sha256, ? AS take_user_uuid, ? AS board_uuid, ? AS board_item_uuid, ? AS annotation_uuid) d ${SUBJECT_JOINS}`,
    subject.subject, projectUuid, subject.paper_sha256, subject.take_user_uuid, subject.board_uuid, subject.board_item_uuid, subject.annotation_uuid))!;
}

async function openDiscussion(env: Env, uuid: string, me: User): Promise<{ discussion: Discussion; project: Project; member: Member }> {
  const discussion = await one<Discussion>(env.DB, "SELECT * FROM discussions WHERE uuid = ?", uuid);
  if (!discussion) refuse(404, "Discussion not found");
  const project = await liveProject(env, discussion!.project_uuid);
  const member = await membership(env, project, me);
  return { discussion: discussion!, project, member };
}

async function discussionOut(env: Env, discussion: Discussion, project: Project, me: User, member: Member) {
  const posts = await all<Row>(env.DB,
    `SELECT dp.*, u.display_name, u.affiliation, u.avatar_path, u.email, u.email_public
     FROM discussion_posts dp JOIN users u ON u.uuid = dp.user_uuid
     WHERE dp.discussion_uuid = ? ORDER BY dp.created_at, dp.uuid`, discussion.uuid);
  return {
    uuid: discussion.uuid, created_at: discussion.created_at, updated_at: discussion.updated_at,
    project: { uuid: project.uuid, name: project.name },
    subject: subjectOut(await subjectRow(env, project.uuid, discussion)),
    can_moderate: Boolean(member.is_keeper),
    posts: posts.map((p) => ({
      uuid: p.uuid, user: userPublic({ ...p, uuid: p.user_uuid }), body: p.body,
      created_at: p.created_at, edited_at: p.edited_at, is_mine: p.user_uuid === me.uuid,
    })),
  };
}

function newPost(discussion: Discussion, me: User, body: string, at: string): Row {
  return { uuid: newUuid(), discussion_uuid: discussion.uuid, user_uuid: me.uuid, body, created_at: at, edited_at: null };
}

export function discussionRoutes(router: Router) {
  // Where "Discuss" on a subject leads: its discussion if it has one, and
  // otherwise what it would be about, to write the first post under.
  router.on("GET", "/api/projects/:uuid/discussion", async ({ request, env, params, url }) => {
    const me = await currentUser(request, env);
    const project = await liveProject(env, params.uuid);
    await membership(env, project, me);
    const subject = await subjectOf(env, project, {
      subject: url.searchParams.get("subject") ?? undefined,
      paper_sha256: url.searchParams.get("paper") ?? undefined, board_item_uuid: url.searchParams.get("card") ?? undefined,
    });
    const found = await existing(env, project, subject);
    return json({ discussion_uuid: found?.uuid ?? null, project: { uuid: project.uuid, name: project.name }, subject: subjectOut(await subjectRow(env, project.uuid, subject)) });
  });

  // The first post opens a discussion; on a subject that has one already,
  // it is simply the next post there.
  router.on("POST", "/api/projects/:uuid/discussions", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const project = await liveProject(env, params.uuid);
    const member = await membership(env, project, me);
    const data = await readJson<Row>(request);
    const subject = await subjectOf(env, project, data);
    const body = postBody(data.body);
    const at = now();
    let discussion = await existing(env, project, subject);
    const statements: D1PreparedStatement[] = [];
    if (discussion) {
      statements.push(update(env.DB, "discussions", "uuid", discussion.uuid, { updated_at: at }));
    } else {
      discussion = { uuid: newUuid(), project_uuid: project.uuid, ...subject, started_by: me.uuid, created_at: at, updated_at: at };
      statements.push(insert(env.DB, "discussions", discussion));
    }
    statements.push(insert(env.DB, "discussion_posts", newPost(discussion, me, body, at)));
    await batch(env.DB, statements);
    return json(await discussionOut(env, { ...discussion, updated_at: at }, project, me, member));
  });

  router.on("GET", "/api/discussions/:uuid", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const { discussion, project, member } = await openDiscussion(env, params.uuid, me);
    return json(await discussionOut(env, discussion, project, me, member));
  });

  router.on("POST", "/api/discussions/:uuid/posts", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const { discussion, project, member } = await openDiscussion(env, params.uuid, me);
    const body = postBody((await readJson<Row>(request)).body);
    const at = now();
    await batch(env.DB, [
      insert(env.DB, "discussion_posts", newPost(discussion, me, body, at)),
      update(env.DB, "discussions", "uuid", discussion.uuid, { updated_at: at }),
    ]);
    return json(await discussionOut(env, { ...discussion, updated_at: at }, project, me, member));
  });

  // Only its writer changes a post.
  router.on("PUT", "/api/discussion-posts/:uuid", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const post = await one<Row>(env.DB, "SELECT * FROM discussion_posts WHERE uuid = ?", params.uuid);
    if (!post) refuse(404, "Post not found");
    const { discussion, project, member } = await openDiscussion(env, String(post!.discussion_uuid), me);
    if (post!.user_uuid !== me.uuid) refuse(403, "Only its writer can change a post");
    const body = postBody((await readJson<Row>(request)).body);
    await batch(env.DB, [update(env.DB, "discussion_posts", "uuid", post!.uuid as string, { body, edited_at: now() })]);
    return json(await discussionOut(env, discussion, project, me, member));
  });

  // Its writer, or a keeper, takes a post back. A discussion with nothing
  // left in it is gone.
  router.on("DELETE", "/api/discussion-posts/:uuid", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const post = await one<Row>(env.DB, "SELECT * FROM discussion_posts WHERE uuid = ?", params.uuid);
    if (!post) refuse(404, "Post not found");
    const { discussion, project, member } = await openDiscussion(env, String(post!.discussion_uuid), me);
    if (post!.user_uuid !== me.uuid && !member.is_keeper) refuse(403, "Only its writer or a keeper can take a post back");
    const left = await one<{ n: number }>(env.DB, "SELECT count(*) AS n FROM discussion_posts WHERE discussion_uuid = ? AND uuid != ?", discussion.uuid, post!.uuid);
    if (!left!.n) {
      await batch(env.DB, [
        statement(env.DB, "DELETE FROM discussion_posts WHERE discussion_uuid = ?", discussion.uuid),
        statement(env.DB, "DELETE FROM discussions WHERE uuid = ?", discussion.uuid),
      ]);
      return new Response(null, { status: 204 });
    }
    await batch(env.DB, [statement(env.DB, "DELETE FROM discussion_posts WHERE uuid = ?", post!.uuid)]);
    return json(await discussionOut(env, discussion, project, me, member));
  });
}
