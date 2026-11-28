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
// A dig on a paper, or on a mark on one, is its writer's own, never a
// project's: the people they share a project with see it there, and post
// in it, while the writer's writing on the paper is shown (writingShown:
// on a public shelf, or not in their nook at all) and the project
// holds it (inProject). Otherwise it is theirs alone, with no posts and
// no phase to move. Nobody needs a paper in their nook to dig it. A dig on a card belongs to its project.
// What someone writes at a place on a page, or about a paper, is always a
// dig.

import limits from "../../../config/app_limits.json";
import { currentUser, type User } from "../auth";
import { all, batch, insert, newUuid, now, one, statement, update, type Row } from "../db";
import { json, readJson, refuse, type Router } from "../http";
import * as validate from "../validate";
import { userPublic } from "./boards";
import { copyOf, holdPaper, paperOr404 } from "../papers/detail";
import { queueEmail, siteUrl, type Queued } from "../jobs/notifications";
import { wake } from "../jobs/queue";
import { friendSees, notice, userLiteral } from "./friends";
import { digsFrom, digsOf, excerpt, inProject, liveProject, membership, projectLiteral, SUBJECT_COLUMNS, SUBJECT_JOINS, subjectOut, writingShown, type Member, type Project } from "./projects";

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
async function subjectOf(env: Env, project: Project, key: unknown, me: User): Promise<Subject> {
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
  // A mark on one of the project's papers that the member can see there:
  // one of their own, or another member's ink, which is shared while its
  // author's writing on the paper is shown (writingShown). Anchors and clips are never
  // shared, so only their author digs them. A mark is its author's alone to
  // change; what is written at it is a dig.
  if (kind === "annotation" && first && second === undefined) {
    const annotation = await one<{ paper_sha256: string }>(env.DB,
      `SELECT a.paper_sha256 FROM annotations a
       JOIN project_papers pp ON pp.paper_sha256 = a.paper_sha256 AND pp.project_uuid = ?
       JOIN project_members m ON m.user_uuid = a.user_uuid AND m.project_uuid = pp.project_uuid
       WHERE a.uuid = ? AND a.deleted_at IS NULL AND a.kind != 'note'
         AND (a.user_uuid = ? OR (a.kind = 'ink' AND ${writingShown("a.user_uuid", "a.paper_sha256")}))`, project.uuid, first, me.uuid);
    if (!annotation) refuse(404, "That annotation is not on one of this project's papers");
    return { ...NONE, subject: `annotation:${first}`, paper_sha256: annotation!.paper_sha256, annotation_uuid: first };
  }
  return refuse(422, "That is not something a dig can be about");
}

// Which subject a dig of one's own names: a paper Papol holds, in their
// nook or not, or one of their own anchors, ink or clips on a paper.
async function ownSubjectOf(env: Env, me: User, key: unknown): Promise<Subject> {
  if (typeof key !== "string" || !key) return refuse(422, "Say what the dig is about");
  const [kind, first, second] = key.split(":");
  if (kind === "paper" && first && second === undefined) {
    const digest = first.toLowerCase();
    if (!DIGEST.test(digest) || !(await one(env.DB, "SELECT 1 FROM papers WHERE sha256 = ? AND deleted_at IS NULL", digest))) refuse(404, "Paper not found");
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

// Where a line about a dig leads: the paper's jacket, at that dig
// (PaperJacket.jsx scrolls to it).
const digLink = (dig: Dig) => `/paper/${String(dig.paper_sha256).slice(0, 32)}#dig-${dig.uuid}`;

// A dig of one's own on a paper is news to the friends who keep that
// paper on a shelf of their nook, while they can read it (friendSees):
// a line in each one's inbox, and an email as often as they chose for
// friends' digs (emails.ts). A paper only read or written on, under
// Passing, is not kept and its reader is not told.
async function tellKeepers(env: Env, dig: Dig, me: User, at: string): Promise<void> {
  if (!dig.paper_sha256) return;
  const keepers = await all<User>(env.DB,
    `SELECT u.* FROM users u WHERE u.deleted_at IS NULL AND u.uuid != ?
       AND EXISTS (SELECT 1 FROM copies c WHERE c.user_uuid = u.uuid AND c.paper_sha256 = ? AND c.deleted_at IS NULL AND c.kept)
       AND EXISTS (SELECT 1 FROM digs d WHERE d.uuid = ? AND ${friendSees("u.uuid")})`, me.uuid, dig.paper_sha256, dig.uuid);
  if (!keepers.length) return;
  const paper = await one<{ title: string }>(env.DB, "SELECT title FROM papers WHERE sha256 = ?", dig.paper_sha256);
  const link = digLink(dig);
  const site = (await siteUrl(env)).replace(/\/$/, "");
  const line = `${me.display_name} dug ${paper?.title ?? "a paper"}, a paper in your nook.`;
  const mails: Queued[] = [];
  const told = keepers.map((them) => {
    const inInbox = newUuid();
    const mail = queueEmail(env.DB, "friend_dig", them, `${me.display_name} dug a paper in your nook`,
      [line, "", excerpt(dig.text), "", `Read it: ${site}${link}`, "", "— Papol"].join("\n"), inInbox);
    if (mail) mails.push(mail);
    return notice(env, them.uuid, line, "friend_dig", me, link, at, inInbox);
  });
  await batch(env.DB, [...told, ...mails.map((mail) => mail.statement)]);
  await wake(env, mails.flatMap((mail) => mail.wake));
}

async function ownDigsOn(env: Env, me: User, subject: string) {
  const { results } = await statement(env.DB,
    `SELECT d.*, ${SUBJECT_COLUMNS}, 0 AS post_count, 0 AS unread, d.user_uuid AS voices
     FROM digs d ${SUBJECT_JOINS} WHERE d.project_uuid IS NULL AND d.user_uuid = ? AND d.subject = ?`, me.uuid, subject).all<Row>();
  return digsFrom(env, results, me);
}

// The member's own dig on a subject: on a card, the one written in the
// project; on a paper or a mark, their own, wherever it is read.
function mine(env: Env, project: Project, subject: Subject, me: User) {
  return subject.board_item_uuid
    ? one<Dig>(env.DB, "SELECT * FROM digs WHERE project_uuid = ? AND subject = ? AND user_uuid = ?", project.uuid, subject.subject, me.uuid)
    : one<Dig>(env.DB, "SELECT * FROM digs WHERE project_uuid IS NULL AND subject = ? AND user_uuid = ?", subject.subject, me.uuid);
}

async function subjectRow(env: Env, projectUuid: string | null, subject: Subject): Promise<Row> {
  return (await one<Row>(env.DB,
    `SELECT d.*, ${SUBJECT_COLUMNS}
     FROM (SELECT ? AS subject, ? AS project_uuid, ? AS paper_sha256, ? AS board_item_uuid, ? AS annotation_uuid) d
     ${SUBJECT_JOINS}`,
    subject.subject, projectUuid, subject.paper_sha256, subject.board_item_uuid, subject.annotation_uuid))!;
}

// A dig and where it is read. A dig on a card is read in its project. A
// dig on a paper or a mark is its writer's, read in a project of the
// reader's that sees it (inProject), by a friend of its writer while the
// writing on the paper is shown (friendSees), or, by its writer, outside
// any. `open` says a dig outside a project can be posted
// in: by a friend who sees it, and by its writer once somebody has.
async function openDig(env: Env, uuid: string, me: User): Promise<{ dig: Dig; project: Project | null; member: Member; open: boolean }> {
  const dig = await one<Dig>(env.DB, "SELECT * FROM digs WHERE uuid = ?", uuid);
  if (!dig) return refuse(404, "Dig not found");
  if (dig.project_uuid === null) {
    const seen = await one<{ project_uuid: string }>(env.DB,
      `SELECT m.project_uuid FROM project_members m JOIN projects pr ON pr.uuid = m.project_uuid AND pr.deleted_at IS NULL, digs d
       WHERE d.uuid = ? AND m.user_uuid = ? AND ${inProject("m.project_uuid")} ORDER BY m.joined_at, m.uuid LIMIT 1`, dig.uuid, me.uuid);
    if (seen) {
      const project = await liveProject(env, seen.project_uuid);
      return { dig, project, member: await membership(env, project, me), open: true };
    }
    if (dig.user_uuid === me.uuid) {
      return { dig, project: null, member: OWN, open: Boolean(await one(env.DB, "SELECT 1 FROM dig_posts WHERE dig_uuid = ? LIMIT 1", dig.uuid)) };
    }
    if (!(await one(env.DB, `SELECT 1 FROM digs d WHERE d.uuid = ? AND ${friendSees(userLiteral(me.uuid))}`, dig.uuid))) refuse(404, "Dig not found");
    return { dig, project: null, member: OWN, open: true };
  }
  const project = await liveProject(env, dig!.project_uuid);
  const member = await membership(env, project, me);
  return { dig: dig!, project, member, open: true };
}

const PERSON = "u.uuid, u.display_name, u.affiliation, u.avatar_path, u.email, u.email_public";

// A dig as its card reads it: its owner's text, then every post in order.
async function digOut(env: Env, dig: Dig, project: Project | null, me: User, member: Member, open = Boolean(project)) {
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
    // Whether the reader may post here: always in a project; outside one,
    // a friend may, and its writer once somebody has.
    can_post: open || posts.length > 0,
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
     FROM digs d WHERE ${projectUuid ? `${inProject(projectLiteral(projectUuid))} AND d.phase != 'stashed'` : "d.project_uuid IS NULL AND d.user_uuid = ?"} ${subjects ? `AND d.subject IN (${subjects.map(() => "?").join(",")})` : ""}
     ORDER BY d.updated_at DESC, d.uuid`,
    member.seen_at, me.uuid, member.seen_at, me.uuid, ...(projectUuid ? [] : [me.uuid]), ...(subjects ?? []));
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
    const subject = await subjectOf(env, project, url.searchParams.get("subject"), me);
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
    const subject = await subjectOf(env, project, data.subject, me);
    if (await mine(env, project, subject, me)) refuse(409, "You have dug this already");
    const text = postBody(data.text, "text");
    const at = now();
    // A dig on a card is the project's. One on a paper or a mark is the
    // writer's own, which the project sees while their writing on the
    // paper is shown. A paper not in their nook is held for them, not
    // kept, which shows it; one they took out stays out, and shows it too.
    if (subject.paper_sha256 && !(await copyOf(env.DB, subject.paper_sha256, me))) await holdPaper(env.DB, me, subject.paper_sha256);
    const made: Dig = { uuid: newUuid(), user_uuid: me.uuid, project_uuid: subject.board_item_uuid ? project.uuid : null, ...subject, text, phase: "digging", edited_at: null, created_at: at, updated_at: at };
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
    if (subject.paper_sha256) await holdPaper(env.DB, me, subject.paper_sha256);
    const made: Dig = { uuid: newUuid(), user_uuid: me.uuid, project_uuid: null, ...subject, text, phase: "digging", edited_at: null, created_at: at, updated_at: at };
    await batch(env.DB, [insert(env.DB, "digs", made)]);
    await tellKeepers(env, made, me, at);
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

  // What the reader's friends dug on a paper and on their marks on it,
  // each while its writer's writing on the paper is shown: the paper's
  // own first, then by place.
  router.on("GET", "/api/papers/:name/friend-digs", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const paper = await paperOr404(env.DB, params.name);
    const { results } = await statement(env.DB,
      `SELECT d.*, ${SUBJECT_COLUMNS},
              (SELECT count(*) FROM dig_posts dp WHERE dp.dig_uuid = d.uuid) AS post_count, 0 AS unread,
              (SELECT group_concat(user_uuid) FROM (SELECT d.user_uuid AS user_uuid UNION SELECT DISTINCT dp.user_uuid FROM dig_posts dp WHERE dp.dig_uuid = d.uuid)) AS voices
       FROM digs d ${SUBJECT_JOINS} WHERE d.paper_sha256 = ? AND ${friendSees(userLiteral(me.uuid))}
       ORDER BY d.annotation_uuid IS NOT NULL, an.page, d.created_at, d.uuid`, paper.sha256).all<Row>();
    return json({ digs: await digsFrom(env, results, me) });
  });

  router.on("GET", "/api/digs/:uuid", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const { dig, project, member, open } = await openDig(env, params.uuid, me);
    return json(await digOut(env, dig, project, me, member, open));
  });

  // Its owner rewords a dig.
  router.on("PUT", "/api/digs/:uuid", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const { dig, project, member, open } = await openDig(env, params.uuid, me);
    if (dig.user_uuid !== me.uuid) refuse(403, "Only its owner can change a dig");
    const text = postBody((await readJson<Row>(request)).text, "text");
    const at = now();
    await batch(env.DB, [update(env.DB, "digs", "uuid", dig.uuid, { text, edited_at: at })]);
    return json(await digOut(env, { ...dig, text, edited_at: at }, project, me, member, open));
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

  // Anyone who can see a dig posts in it. Outside a project that is a
  // friend of its writer, and its writer once somebody has; what is
  // posted there reaches the others in it through their inboxes, since no
  // project is there to show it as news.
  router.on("POST", "/api/digs/:uuid/posts", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const { dig, project, member, open } = await openDig(env, params.uuid, me);
    if (!open) refuse(403, "Nobody posts in a dig of your own");
    const body = postBody((await readJson<Row>(request)).body);
    const at = now();
    const told: D1PreparedStatement[] = [];
    const mails: Queued[] = [];
    if (!project && dig.paper_sha256) {
      const paper = await one<{ title: string }>(env.DB, "SELECT title FROM papers WHERE sha256 = ?", dig.paper_sha256);
      const owner = await one<{ display_name: string }>(env.DB, "SELECT display_name FROM users WHERE uuid = ?", dig.user_uuid);
      const others = await all<{ user_uuid: string }>(env.DB, "SELECT DISTINCT user_uuid FROM dig_posts WHERE dig_uuid = ?", dig.uuid);
      const link = digLink(dig);
      const site = (await siteUrl(env)).replace(/\/$/, "");
      for (const uuid of new Set([dig.user_uuid, ...others.map((o) => o.user_uuid)])) {
        if (uuid === me.uuid) continue;
        // Someone who can no longer read the dig is not told of it: a friend
        // no longer one, or anyone once the paper went to a private shelf.
        if (uuid !== dig.user_uuid && !(await one(env.DB, `SELECT 1 FROM digs d WHERE d.uuid = ? AND ${friendSees(userLiteral(uuid))}`, dig.uuid))) continue;
        const whose = uuid === dig.user_uuid ? "your dig" : dig.user_uuid === me.uuid ? "a dig you posted in" : `${owner?.display_name ?? "a friend"}'s dig`;
        const line = `${me.display_name} replied in ${whose} on ${paper?.title ?? "a paper"}.`;
        const inInbox = newUuid();
        told.push(notice(env, uuid, line, "dig_post", me, link, at, inInbox));
        // And by email, as often as they chose for replies (emails.ts).
        const them = await one<User>(env.DB, "SELECT * FROM users WHERE uuid = ? AND deleted_at IS NULL", uuid);
        const mail = them && queueEmail(env.DB, "dig_reply", them, `${me.display_name} replied in ${whose} on Papol`,
          [line, "", excerpt(body), "", `Read it: ${site}${link}`, "", "— Papol"].join("\n"), inInbox);
        if (mail) mails.push(mail);
      }
    }
    await batch(env.DB, [
      insert(env.DB, "dig_posts", newPost(dig, me, body, at)),
      update(env.DB, "digs", "uuid", dig.uuid, { updated_at: at }),
      ...told,
      ...mails.map((mail) => mail.statement),
    ]);
    await wake(env, mails.flatMap((mail) => mail.wake));
    return json(await digOut(env, { ...dig, updated_at: at }, project, me, member, true));
  });

  // Only its writer changes a post.
  router.on("PUT", "/api/dig-posts/:uuid", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const { post, dig, project, member, open } = await postIn(env, params.uuid, me);
    if (post.user_uuid !== me.uuid) refuse(403, "Only its writer can change a post");
    const body = postBody((await readJson<Row>(request)).body);
    await batch(env.DB, [update(env.DB, "dig_posts", "uuid", post.uuid as string, { body, edited_at: now() })]);
    return json(await digOut(env, dig, project, me, member, open));
  });

  // Only its writer takes a post back. The dig stays.
  router.on("DELETE", "/api/dig-posts/:uuid", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const { post, dig, project, member, open } = await postIn(env, params.uuid, me);
    if (post.user_uuid !== me.uuid) refuse(403, "Only its writer can take a post back");
    await batch(env.DB, [statement(env.DB, "DELETE FROM dig_posts WHERE uuid = ?", post.uuid)]);
    return json(await digOut(env, dig, project, me, member, open));
  });
}
