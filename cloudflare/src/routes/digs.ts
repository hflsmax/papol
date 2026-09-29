// Digs: one person's writing about one thing a project holds: a paper, a
// card on one of its boards, or an annotation a member left on one of its
// papers (an anchor, ink or a clip). Never the project itself, a board as
// a whole, another dig, or a post in one.
//
// A dig carries its owner's own text: digging is writing it. A thing
// holds one dig per person. Anyone who can see a dig can post in it; that
// is the other act. The dig stays until its owner removes it, whatever
// is taken back from it. Only its writer changes or removes what they
// wrote; being a keeper grants nothing over others' words.
//
// A thought is its member's dig on the paper, and a board as a whole is
// not dug.
//
// Outside any project a dig is its owner's alone: about a paper in their
// nook or one of their own anchors, ink or clips, seen by nobody else,
// with no posts and no phase to move. What someone writes at a place on
// a page, or about a paper, is always a dig.

import limits from "../../../config/app_limits.json";
import { currentUser, type User } from "../auth";
import { all, batch, insert, newUuid, now, one, statement, update, type Row } from "../db";
import { json, readJson, refuse, type Router } from "../http";
import * as validate from "../validate";
import { userPublic } from "./boards";
import { copyOf, paperOr404 } from "../papers/detail";
import { digsFrom, digsOf, excerpt, liveProject, membership, LIVE_SUBJECT, SUBJECT_COLUMNS, SUBJECT_JOINS, subjectOut, type Member, type Project } from "./projects";

const DIGEST = /^[0-9a-f]{64}$/;

// Where a dig stands: still being dug, stashed out of the way, or gold
// worth keeping. Anyone in the project moves it; nothing else does.
export const PHASES = ["digging", "stashed", "gold"] as const;
type Phase = typeof PHASES[number];

interface Dig extends Row {
  uuid: string;
  user_uuid: string;
  project_uuid: string | null;
  subject: string;
  paper_sha256: string | null;
  board_item_uuid: string | null;
  annotation_uuid: string | null;
  text: string;
  phase: Phase;
  edited_at: string | null;
  created_at: string;
  updated_at: string;
}

function postBody(value: unknown, field = "body"): string {
  const check = validate.checking();
  const body = check.string(field, value, { min: 1, max: limits.text.dig_post });
  check.done();
  return body!.trim() || refuse(422, `${field} is required`);
}

export interface Subject {
  subject: string;
  paper_sha256: string | null;
  board_item_uuid: string | null;
  annotation_uuid: string | null;
}

const NONE = { paper_sha256: null, board_item_uuid: null, annotation_uuid: null };

async function paperIn(env: Env, project: Project, value: string): Promise<string> {
  const digest = value.toLowerCase();
  if (!DIGEST.test(digest) || !(await one(env.DB, "SELECT 1 FROM project_papers WHERE project_uuid = ? AND paper_sha256 = ?", project.uuid, digest))) {
    refuse(404, "That paper is not in this project");
  }
  return digest;
}

// Which subject a request names by its key, checked to be in the project.
async function subjectOf(env: Env, project: Project, key: unknown): Promise<Subject> {
  if (typeof key !== "string" || !key) return refuse(422, "Say what the dig is about");
  const [kind, first, second] = key.split(":");
  if (kind === "paper" && first && second === undefined) {
    const digest = await paperIn(env, project, first);
    return { ...NONE, subject: `paper:${digest}`, paper_sha256: digest };
  }
  if (kind === "card" && first && second === undefined) {
    const card = await one(env.DB,
      `SELECT 1 FROM board_items bi JOIN project_boards pb ON pb.board_uuid = bi.board_uuid JOIN boards b ON b.uuid = bi.board_uuid
       WHERE bi.uuid = ? AND pb.project_uuid = ? AND bi.deleted_at IS NULL AND b.deleted_at IS NULL`, first, project.uuid);
    if (!card) refuse(404, "That card is not on this project's boards");
    return { ...NONE, subject: `card:${first}`, board_item_uuid: first };
  }
  // A member's anchor, ink or clip on one of the project's papers: what the
  // viewer shows every member once the project is on. Its author's alone
  // to change; the project's to dig into. An anchor is a place: what is
  // written there is a dig.
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

// Which subject a dig of one's own names: a paper in their nook, or one
// of their own anchors, ink or clips on a paper.
async function ownSubjectOf(env: Env, me: User, key: unknown): Promise<Subject> {
  if (typeof key !== "string" || !key) return refuse(422, "Say what the dig is about");
  const [kind, first, second] = key.split(":");
  if (kind === "paper" && first && second === undefined) {
    const digest = first.toLowerCase();
    if (!DIGEST.test(digest) || !(await copyOf(env.DB, digest, me))) refuse(404, "That paper is not in your nook");
    return { ...NONE, subject: `paper:${digest}`, paper_sha256: digest };
  }
  if (kind === "annotation" && first && second === undefined) {
    const annotation = await one<{ paper_sha256: string }>(env.DB,
      "SELECT paper_sha256 FROM annotations WHERE uuid = ? AND user_uuid = ? AND deleted_at IS NULL", first, me.uuid);
    if (!annotation) refuse(404, "That annotation is not yours");
    return { ...NONE, subject: `annotation:${first}`, paper_sha256: annotation!.paper_sha256, annotation_uuid: first };
  }
  return refuse(422, "That is not something a dig can be about");
}

// A dig of one's own, read the way a project's are: nothing in it is new.
const OWN: Member = { seen_at: "9999" } as Member;

async function ownDigsOn(env: Env, me: User, subject: string) {
  const { results } = await statement(env.DB,
    `SELECT d.*, ${SUBJECT_COLUMNS}, 0 AS post_count, 0 AS unread, d.user_uuid AS voices
     FROM digs d ${SUBJECT_JOINS} WHERE d.project_uuid IS NULL AND d.user_uuid = ? AND d.subject = ?`, me.uuid, subject).all<Row>();
  return digsFrom(env, results, me);
}

function mine(env: Env, project: Project, subject: Subject, me: User) {
  return one<Dig>(env.DB, "SELECT * FROM digs WHERE project_uuid = ? AND subject = ? AND user_uuid = ?", project.uuid, subject.subject, me.uuid);
}

async function subjectRow(env: Env, projectUuid: string | null, subject: Subject): Promise<Row> {
  return (await one<Row>(env.DB,
    `SELECT d.*, ${SUBJECT_COLUMNS}
     FROM (SELECT ? AS subject, ? AS project_uuid, ? AS paper_sha256, ? AS board_item_uuid, ? AS annotation_uuid) d
     ${SUBJECT_JOINS}`,
    subject.subject, projectUuid, subject.paper_sha256, subject.board_item_uuid, subject.annotation_uuid))!;
}

// A dig and where it is read: its project, or nowhere but its owner's.
async function openDig(env: Env, uuid: string, me: User): Promise<{ dig: Dig; project: Project | null; member: Member }> {
  const dig = await one<Dig>(env.DB, "SELECT * FROM digs WHERE uuid = ?", uuid);
  if (!dig || (dig.project_uuid === null && dig.user_uuid !== me.uuid)) refuse(404, "Dig not found");
  if (dig!.project_uuid === null) return { dig: dig!, project: null, member: OWN };
  const project = await liveProject(env, dig!.project_uuid);
  const member = await membership(env, project, me);
  return { dig: dig!, project, member };
}

const PERSON = "u.uuid, u.display_name, u.affiliation, u.avatar_path, u.email, u.email_public";

// A dig as its card reads it: its owner's text, then every post in order.
async function digOut(env: Env, dig: Dig, project: Project | null, me: User, member: Member) {
  const posts = await all<Row>(env.DB,
    `SELECT dp.*, u.display_name, u.affiliation, u.avatar_path, u.email, u.email_public FROM dig_posts dp JOIN users u ON u.uuid = dp.user_uuid
     WHERE dp.dig_uuid = ? ORDER BY dp.created_at, dp.uuid`, dig.uuid);
  const owner = await one<Row>(env.DB, `SELECT ${PERSON} FROM users u WHERE u.uuid = ?`, dig.user_uuid);
  const ownerOut = owner ? userPublic(owner) : null;
  const postOut = (p: Row) => ({
    uuid: p.uuid, user: userPublic({ ...p, uuid: p.user_uuid }), body: p.body,
    created_at: p.created_at, edited_at: p.edited_at, is_mine: p.user_uuid === me.uuid,
  });
  return {
    uuid: dig.uuid, created_at: dig.created_at, updated_at: dig.updated_at,
    project: project && { uuid: project.uuid, name: project.name },
    subject: subjectOut(await subjectRow(env, dig.project_uuid, dig)),
    owner: ownerOut, is_mine: dig.user_uuid === me.uuid,
    text: dig.text, phase: dig.phase, edited_at: dig.edited_at,
    posts: posts.map(postOut),
  };
}

function newPost(dig: Dig, me: User, body: string, at: string): Row {
  return { uuid: newUuid(), dig_uuid: dig.uuid, user_uuid: me.uuid, body, created_at: at, edited_at: null };
}

// Every dig on each of the given subjects, folded into what one pin on it
// shows: how many digs and posts, whether any of it is new to this
// member, who wrote, and the dig the pin opens (their own, or else the
// latest). A stashed dig is out of the way: no pin shows it. With no
// project, the reader's own digs outside any.
export async function pinsOf(env: Env, projectUuid: string | null, me: User, member: Member, subjects?: string[]) {
  const rows = await all<Row>(env.DB,
    `SELECT d.uuid, d.subject, d.user_uuid, d.text, d.phase, d.created_at,
            (SELECT count(*) FROM dig_posts dp WHERE dp.dig_uuid = d.uuid) AS post_count,
            (d.phase = 'digging') * ((d.created_at > ? AND d.user_uuid != ?) + (SELECT count(*) FROM dig_posts dp WHERE dp.dig_uuid = d.uuid AND dp.created_at > ? AND dp.user_uuid != ?)) AS unread,
            (SELECT group_concat(user_uuid) FROM (SELECT d.user_uuid AS user_uuid UNION SELECT DISTINCT dp.user_uuid FROM dig_posts dp WHERE dp.dig_uuid = d.uuid)) AS voices
     FROM digs d WHERE ${projectUuid ? `d.project_uuid = ? AND d.phase != 'stashed' AND ${LIVE_SUBJECT}` : "d.project_uuid IS NULL AND d.user_uuid = ?"} ${subjects ? `AND d.subject IN (${subjects.map(() => "?").join(",")})` : ""}
     ORDER BY d.updated_at DESC, d.uuid`,
    member.seen_at, me.uuid, member.seen_at, me.uuid, projectUuid ?? me.uuid, ...(subjects ?? []));
  const people = await usersByUuid(env, rows.flatMap((d) => [String(d.user_uuid), ...String(d.voices ?? "").split(",").filter(Boolean)]));
  // The dig a pin opens on, the reader's own else the latest, in a line:
  // whose it is, where it stands and how it begins.
  const lead = (d: Row) => ({ owner: people.get(String(d.user_uuid)) ?? null, phase: d.phase, excerpt: excerpt(String(d.text)) });
  // Each dig on the thing, oldest first: whose it is and whether it holds
  // news, for the viewer's margin to show one face per dig.
  type Each = { uuid: string; owner: unknown; created_at: string; is_new: boolean };
  const pins: Record<string, { uuid: string; mine: string | null; dig_count: number; post_count: number; unread: number; is_new: boolean; voices: unknown[]; lead: unknown; digs: Each[] }> = {};
  for (const d of rows) {
    const key = String(d.subject);
    const pin = pins[key] ??= { uuid: String(d.uuid), mine: null, dig_count: 0, post_count: 0, unread: 0, is_new: false, voices: [], lead: lead(d), digs: [] };
    pin.digs.push({ uuid: String(d.uuid), owner: people.get(String(d.user_uuid)) ?? null, created_at: String(d.created_at), is_new: Number(d.unread) > 0 });
    if (d.user_uuid === me.uuid) { pin.uuid = pin.mine = String(d.uuid); pin.lead = lead(d); }
    pin.dig_count += 1;
    pin.post_count += Number(d.post_count);
    pin.unread += Number(d.unread);
    pin.is_new = pin.unread > 0;
    for (const uuid of String(d.voices ?? "").split(",").filter(Boolean)) {
      const person = people.get(uuid) as { uuid?: string } | undefined;
      if (person && !pin.voices.some((v) => (v as { uuid?: string }).uuid === person.uuid)) pin.voices.push(person);
    }
  }
  for (const pin of Object.values(pins)) pin.digs.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.uuid.localeCompare(b.uuid));
  return pins;
}

async function usersByUuid(env: Env, uuids: string[]) {
  const unique = [...new Set(uuids)];
  if (!unique.length) return new Map<string, unknown>();
  const rows = await all<Row>(env.DB, `SELECT ${PERSON} FROM users u WHERE u.uuid IN (${unique.map(() => "?").join(",")})`, ...unique);
  return new Map<string, unknown>(rows.map((u) => [u.uuid as string, userPublic(u)]));
}

// Every dig on one subject, by who wrote last.
async function digsOn(env: Env, project: Project, me: User, member: Member, subject: string) {
  return (await digsOf(env, project.uuid, me, member)).filter((d) => d.subject.key === subject);
}

async function postIn(env: Env, uuid: string, me: User) {
  const post = await one<Row>(env.DB, "SELECT * FROM dig_posts WHERE uuid = ?", uuid);
  if (!post) refuse(404, "Post not found");
  return { post: post!, ...(await openDig(env, String(post!.dig_uuid), me)) };
}

export function digRoutes(router: Router) {
  // Where a pin on a subject leads: every dig on it, the member's own
  // among them if they have one, and what it is about.
  router.on("GET", "/api/projects/:uuid/digs", async ({ request, env, params, url }) => {
    const me = await currentUser(request, env);
    const project = await liveProject(env, params.uuid);
    const member = await membership(env, project, me);
    const subject = await subjectOf(env, project, url.searchParams.get("subject"));
    const digs = await digsOn(env, project, me, member, subject.subject);
    return json({
      mine: digs.find((d) => d.is_mine)?.uuid ?? null, digs,
      project: { uuid: project.uuid, name: project.name }, subject: subjectOut(await subjectRow(env, project.uuid, subject)),
    });
  });

  // Digging a subject: the member's own dig on it, with its text.
  router.on("POST", "/api/projects/:uuid/digs", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const project = await liveProject(env, params.uuid);
    const member = await membership(env, project, me);
    const data = await readJson<Row>(request);
    const subject = await subjectOf(env, project, data.subject);
    if (await mine(env, project, subject, me)) refuse(409, "You have dug this already");
    const text = postBody(data.text, "text");
    const at = now();
    const made: Dig = { uuid: newUuid(), user_uuid: me.uuid, project_uuid: project.uuid, ...subject, text, phase: "digging", edited_at: null, created_at: at, updated_at: at };
    await batch(env.DB, [insert(env.DB, "digs", made)]);
    return json(await digOut(env, made, project, me, member));
  });

  // A dig of one's own: where its pin leads, and writing it.
  router.on("GET", "/api/digs", async ({ request, env, url }) => {
    const me = await currentUser(request, env);
    const subject = await ownSubjectOf(env, me, url.searchParams.get("subject"));
    const digs = await ownDigsOn(env, me, subject.subject);
    return json({ mine: digs[0]?.uuid ?? null, digs, project: null, subject: subjectOut(await subjectRow(env, null, subject)) });
  });

  router.on("POST", "/api/digs", async ({ request, env }) => {
    const me = await currentUser(request, env);
    const data = await readJson<Row>(request);
    const subject = await ownSubjectOf(env, me, data.subject);
    if (await one(env.DB, "SELECT 1 FROM digs WHERE project_uuid IS NULL AND subject = ? AND user_uuid = ?", subject.subject, me.uuid)) refuse(409, "You have dug this already");
    const text = postBody(data.text, "text");
    const at = now();
    const made: Dig = { uuid: newUuid(), user_uuid: me.uuid, project_uuid: null, ...subject, text, phase: "digging", edited_at: null, created_at: at, updated_at: at };
    await batch(env.DB, [insert(env.DB, "digs", made)]);
    return json(await digOut(env, made, null, me, OWN));
  });

  // The reader's own digs on a paper and on their marks on it, as the pins
  // with a project on read them.
  router.on("GET", "/api/papers/:name/digs", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const paper = await paperOr404(env.DB, params.name);
    const pins = await pinsOf(env, null, me, OWN);
    const paperKey = `paper:${paper.sha256}`;
    const marks = new Set((await all<{ uuid: string }>(env.DB,
      "SELECT uuid FROM annotations WHERE paper_sha256 = ? AND user_uuid = ? AND deleted_at IS NULL", paper.sha256, me.uuid)).map((a) => a.uuid));
    const digs: Record<string, unknown> = {};
    for (const [key, pin] of Object.entries(pins)) {
      const uuid = key.slice("annotation:".length);
      if (key.startsWith("annotation:") && marks.has(uuid)) digs[uuid] = pin;
    }
    return json({ digs, paper_digs: pins[paperKey] ?? null });
  });

  router.on("GET", "/api/digs/:uuid", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const { dig, project, member } = await openDig(env, params.uuid, me);
    return json(await digOut(env, dig, project, me, member));
  });

  // Its owner rewords a dig.
  router.on("PUT", "/api/digs/:uuid", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const { dig, project, member } = await openDig(env, params.uuid, me);
    if (dig.user_uuid !== me.uuid) refuse(403, "Only its owner can change a dig");
    const text = postBody((await readJson<Row>(request)).text, "text");
    const at = now();
    await batch(env.DB, [update(env.DB, "digs", "uuid", dig.uuid, { text, edited_at: at })]);
    return json(await digOut(env, { ...dig, text, edited_at: at }, project, me, member));
  });

  // Anyone in the project moves a dig from one phase to another.
  router.on("PUT", "/api/digs/:uuid/phase", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const { dig, project, member } = await openDig(env, params.uuid, me);
    if (!project) refuse(403, "A dig of your own has no phase to move");
    const phase = (await readJson<Row>(request)).phase;
    if (!PHASES.includes(phase as Phase)) refuse(422, "That is not a phase");
    await batch(env.DB, [update(env.DB, "digs", "uuid", dig.uuid, { phase })]);
    return json(await digOut(env, { ...dig, phase: phase as Phase }, project, me, member));
  });

  // Only its owner removes a dig and everything posted in it.
  router.on("DELETE", "/api/digs/:uuid", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const { dig } = await openDig(env, params.uuid, me);
    if (dig.user_uuid !== me.uuid) refuse(403, "Only its owner can remove a dig");
    await batch(env.DB, [
      statement(env.DB, "DELETE FROM dig_posts WHERE dig_uuid = ?", dig.uuid),
      statement(env.DB, "DELETE FROM digs WHERE uuid = ?", dig.uuid),
    ]);
    return new Response(null, { status: 204 });
  });

  // Anyone who can see a dig posts in it.
  router.on("POST", "/api/digs/:uuid/posts", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const { dig, project, member } = await openDig(env, params.uuid, me);
    if (!project) refuse(403, "Nobody posts in a dig of your own");
    const body = postBody((await readJson<Row>(request)).body);
    const at = now();
    await batch(env.DB, [
      insert(env.DB, "dig_posts", newPost(dig, me, body, at)),
      update(env.DB, "digs", "uuid", dig.uuid, { updated_at: at }),
    ]);
    return json(await digOut(env, { ...dig, updated_at: at }, project, me, member));
  });

  // Only its writer changes a post.
  router.on("PUT", "/api/dig-posts/:uuid", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const { post, dig, project, member } = await postIn(env, params.uuid, me);
    if (post.user_uuid !== me.uuid) refuse(403, "Only its writer can change a post");
    const body = postBody((await readJson<Row>(request)).body);
    await batch(env.DB, [update(env.DB, "dig_posts", "uuid", post.uuid as string, { body, edited_at: now() })]);
    return json(await digOut(env, dig, project, me, member));
  });

  // Only its writer takes a post back. The dig stays.
  router.on("DELETE", "/api/dig-posts/:uuid", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const { post, dig, project, member } = await postIn(env, params.uuid, me);
    if (post.user_uuid !== me.uuid) refuse(403, "Only its writer can take a post back");
    await batch(env.DB, [statement(env.DB, "DELETE FROM dig_posts WHERE uuid = ?", post.uuid)]);
    return json(await digOut(env, dig, project, me, member));
  });
}
