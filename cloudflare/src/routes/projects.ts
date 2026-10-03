// Projects: where work on a question happens, by one person or several.
//
// A project holds papers, not copies, and its members, some of whom keep
// it. Every signed-in user can see that a project exists, what it is
// called and who is in it, keepers marked, so they know whom to ask; only
// members can open it, and joining is by invitation alone. Joining is
// trust: a member sees every member's copy of the project's papers, on
// whatever shelf, with what each copy lets be seen.

import limits from "../../../config/app_limits.json";
import { currentUser, type User } from "../auth";
import { all, batch, insert, newUuid, now, one, statement, update, type Row } from "../db";
import { json, readJson, refuse, type Router } from "../http";
import { annotationOut } from "../papers/detail";
import { membersCopies } from "../papers/list";
import { isShareCode, newShareCode } from "../papers/sharables";
import * as validate from "../validate";
import { boardOut, userPublic } from "./boards";
import { pinsOf } from "./digs";
import { writeSynced } from "../sync/write";

export interface Project extends Row {
  uuid: string;
  name: string;
  description: string | null;
  invite_code: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Member extends Row {
  uuid: string;
  project_uuid: string;
  user_uuid: string;
  is_keeper: number;
  joined_at: string;
  seen_at: string;
}

const DIGEST = /^[0-9a-f]{64}$/;

// One space between words, none around.
function tidy(name: string): string {
  return name.split(/\s+/).filter(Boolean).join(" ");
}

// Tag identity is case-insensitive and indifferent to the whitespace a
// member happened to type; its kept name still preserves their casing.
function tagName(value: unknown): { name: string; normalized: string } {
  const check = validate.checking();
  const name = tidy(check.string("name", value, { min: 1, max: limits.text.tag_name }) ?? "");
  check.done();
  if (!name) refuse(422, "name is required");
  return { name, normalized: name.toLocaleLowerCase("en") };
}

function projectName(value: unknown): string {
  const check = validate.checking();
  const name = tidy(check.string("name", value, { min: 1, max: limits.text.project_name }) ?? "");
  check.done();
  return name || refuse(422, "name is required");
}

// One line, as the name is; empty is none.
function projectDescription(value: unknown): string | null {
  const check = validate.checking();
  const description = check.string("description", value, { max: limits.text.project_description, optional: true });
  check.done();
  return tidy(description ?? "") || null;
}

export async function liveProject(env: Env, uuid: string): Promise<Project> {
  const project = await one<Project>(env.DB, "SELECT * FROM projects WHERE uuid = ? AND deleted_at IS NULL", uuid);
  return project ?? refuse(404, "Project not found");
}

async function membersOf(env: Env, projectUuids: string[]): Promise<(Member & Row)[]> {
  if (!projectUuids.length) return [];
  const { results } = await membersStatement(env, projectUuids).all<Member & Row>();
  return results;
}

function membersStatement(env: Env, projectUuids: string[]) {
  return statement(env.DB,
    `SELECT m.*, u.display_name, u.affiliation, u.avatar_path, u.email, u.email_public,
            presence.last_seen_at AS presence_seen_at
     FROM project_members m JOIN users u ON u.uuid = m.user_uuid
     LEFT JOIN user_presence presence ON presence.user_uuid = m.user_uuid
     WHERE m.project_uuid IN (${projectUuids.map(() => "?").join(",")}) ORDER BY m.joined_at, m.uuid`, ...projectUuids);
}

const ONLINE_WITHIN_MS = 2 * 60 * 1000;

function memberOut(member: Member & Row, showPresence = false, meUuid?: string) {
  const user: Row = userPublic({ ...member, uuid: member.user_uuid });
  if (showPresence) {
    const seen = member.presence_seen_at ? Date.parse(String(member.presence_seen_at)) : 0;
    user.online = member.user_uuid === meUuid || seen > Date.now() - ONLINE_WITHIN_MS;
  }
  return { user, is_keeper: Boolean(member.is_keeper), joined_at: member.joined_at };
}

// What anyone signed in sees of a project: that it exists, and who is in it.
function summaryOut(project: Project, members: (Member & Row)[], me: User) {
  const mine = members.find((m) => m.user_uuid === me.uuid);
  return {
    uuid: project.uuid, name: project.name, created_at: project.created_at,
    members: members.map((member) => memberOut(member, Boolean(mine), me.uuid)), is_member: Boolean(mine), is_keeper: Boolean(mine?.is_keeper),
  };
}

export async function membership(env: Env, project: Project, user: User): Promise<Member> {
  const member = await one<Member>(env.DB, "SELECT * FROM project_members WHERE project_uuid = ? AND user_uuid = ?", project.uuid, user.uuid);
  // A project's contents are for its members; to anyone else it may as
  // well have none.
  return member ?? refuse(403, "Only members can open this project");
}

export async function keeping(env: Env, project: Project, user: User): Promise<Member> {
  const member = await membership(env, project, user);
  return member.is_keeper ? member : refuse(403, "Only a keeper can do that");
}

// A card someone else put on one of the project's boards since this
// member last looked, and that is on the board rather than in its tray.
const NEW_CARD = "bi.created_at > ? AND bi.added_by != <me> AND bi.deleted_at IS NULL AND NOT bi.staged";

// The papers, cards and digs other members added since this member last
// looked.
async function newCounts(env: Env, user: User): Promise<Map<string, number>> {
  const rows = await all<{ project_uuid: string; n: number }>(env.DB,
    `SELECT m.project_uuid, count(pp.uuid) AS n FROM project_members m
     JOIN project_papers pp ON pp.project_uuid = m.project_uuid AND pp.added_by != m.user_uuid
     LEFT JOIN project_member_reads r ON r.member_uuid = m.uuid AND r.item_kind = 'paper' AND r.item_uuid = pp.paper_sha256
     WHERE m.user_uuid = ? AND pp.added_at > coalesce(r.seen_at, m.seen_at) GROUP BY m.project_uuid
     UNION ALL
     SELECT m.project_uuid, count(DISTINCT d.uuid) AS n FROM project_members m
     JOIN digs d ON d.project_uuid = m.project_uuid
     LEFT JOIN project_member_reads r ON r.member_uuid = m.uuid AND r.item_kind = 'dig' AND r.item_uuid = d.uuid
     WHERE m.user_uuid = ? AND d.phase = 'digging' AND ${LIVE_SUBJECT} AND ((d.created_at > coalesce(r.seen_at, m.seen_at) AND d.user_uuid != m.user_uuid)
       OR EXISTS (SELECT 1 FROM dig_posts dp WHERE dp.dig_uuid = d.uuid AND dp.created_at > coalesce(r.seen_at, m.seen_at) AND dp.user_uuid != m.user_uuid))
     GROUP BY m.project_uuid
     UNION ALL
     SELECT m.project_uuid, count(DISTINCT b.uuid) AS n FROM project_members m
     JOIN project_boards pb ON pb.project_uuid = m.project_uuid
     JOIN boards b ON b.uuid = pb.board_uuid AND b.deleted_at IS NULL
     LEFT JOIN project_member_reads r ON r.member_uuid = m.uuid AND r.item_kind = 'board' AND r.item_uuid = b.uuid
     JOIN board_items bi ON bi.board_uuid = b.uuid AND bi.created_at > coalesce(r.seen_at, m.seen_at)
       AND bi.added_by != m.user_uuid AND bi.deleted_at IS NULL AND NOT bi.staged
     WHERE m.user_uuid = ? GROUP BY m.project_uuid
     `, user.uuid, user.uuid, user.uuid);
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.project_uuid, (counts.get(r.project_uuid) ?? 0) + r.n);
  return counts;
}

// The whole project, as a member sees it.
// What a board's newest card says, in a line: an excerpt its words, a
// comment its text, anything else the name it came with.
function cardLine(card: Row) {
  const text = card.kind === "excerpt" ? card.excerpt_text : card.kind === "comment" ? card.content
    : card.source_label || card.original_filename || card.content;
  return String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 240) || null;
}

async function projectOut(env: Env, project: Project, me: User, member: Member) {
  // Everything the page shows in one trip, then the two things that
  // depend on what came back.
  const [members, entries, held, boards, placed, latestCards, tagRows, tagLinks, digRows] = (await env.DB.batch<Row>([
    membersStatement(env, [project.uuid]),
    statement(env.DB,
      `SELECT pp.paper_sha256, pp.added_by, pp.added_at, p.title, p.authors, p.journal, p.year, p.doi,
              coalesce(r.seen_at, ?) AS read_at,
              u.display_name, u.affiliation, u.avatar_path, u.email, u.email_public
       FROM project_papers pp JOIN papers p ON p.sha256 = pp.paper_sha256 JOIN users u ON u.uuid = pp.added_by
       LEFT JOIN project_member_reads r ON r.member_uuid = ? AND r.item_kind = 'paper' AND r.item_uuid = pp.paper_sha256
       WHERE pp.project_uuid = ? ORDER BY pp.added_at DESC, pp.uuid`, member.seen_at, member.uuid, project.uuid),
    statement(env.DB,
      `SELECT DISTINCT c.paper_sha256 FROM copies c JOIN project_papers pp ON pp.paper_sha256 = c.paper_sha256 AND pp.project_uuid = ?
       WHERE c.user_uuid = ? AND c.deleted_at IS NULL`, project.uuid, me.uuid),
    statement(env.DB,
      `SELECT b.uuid, b.name, b.description, b.created_at, b.updated_at, u.uuid AS owner_uuid, u.display_name, u.affiliation, u.avatar_path, u.email, u.email_public,
              (SELECT count(*) FROM board_items i WHERE i.board_uuid = b.uuid AND i.deleted_at IS NULL AND NOT i.staged) AS item_count,
              EXISTS (SELECT 1 FROM board_items bi WHERE bi.board_uuid = b.uuid AND bi.created_at > coalesce(r.seen_at, ?)
                AND bi.added_by != ? AND bi.deleted_at IS NULL AND NOT bi.staged) AS is_new,
              (SELECT max(bi.created_at) FROM board_items bi WHERE bi.board_uuid = b.uuid AND bi.deleted_at IS NULL AND NOT bi.staged) AS news_through
       FROM project_boards pb JOIN boards b ON b.uuid = pb.board_uuid LEFT JOIN users u ON u.uuid = b.user_uuid
       LEFT JOIN project_member_reads r ON r.member_uuid = ? AND r.item_kind = 'board' AND r.item_uuid = b.uuid
       WHERE pb.project_uuid = ? AND b.deleted_at IS NULL ORDER BY b.updated_at DESC, b.uuid`, member.seen_at, me.uuid, member.uuid, project.uuid),
    // Which of the project's boards carry a card from each paper: an
    // excerpt's backlink names the paper by the first half of its digest.
    statement(env.DB,
      `SELECT DISTINCT pp.paper_sha256, bi.board_uuid FROM project_papers pp
       JOIN project_boards pb ON pb.project_uuid = pp.project_uuid
       JOIN boards b ON b.uuid = pb.board_uuid AND b.deleted_at IS NULL
       JOIN board_items bi ON bi.board_uuid = pb.board_uuid AND bi.deleted_at IS NULL AND NOT bi.staged AND bi.source_url IS NOT NULL
       WHERE pp.project_uuid = ? AND instr(lower(bi.source_url), substr(pp.paper_sha256, 1, 32)) > 0`, project.uuid),
    // Each board's newest card, and who put it there: what the board holds
    // and what last changed on it, in one line.
    statement(env.DB,
      `SELECT * FROM (
         SELECT bi.board_uuid, bi.kind, bi.content, bi.excerpt_text, bi.source_label, bi.original_filename, bi.created_at,
                u.uuid AS adder_uuid, u.display_name, u.affiliation, u.avatar_path, u.email, u.email_public,
                row_number() OVER (PARTITION BY bi.board_uuid ORDER BY bi.created_at DESC, bi.uuid) AS nth
         FROM board_items bi
         JOIN project_boards pb ON pb.board_uuid = bi.board_uuid AND pb.project_uuid = ?
         JOIN boards b ON b.uuid = bi.board_uuid AND b.deleted_at IS NULL
         LEFT JOIN users u ON u.uuid = bi.added_by
         WHERE bi.deleted_at IS NULL AND NOT bi.staged)
       WHERE nth = 1`, project.uuid),
    statement(env.DB,
      `SELECT uuid, name FROM project_tags WHERE project_uuid = ? ORDER BY normalized_name, uuid`, project.uuid),
    statement(env.DB,
      `SELECT pp.paper_sha256, t.uuid, t.name FROM project_paper_tags l
       JOIN project_papers pp ON pp.uuid = l.project_paper_uuid
       JOIN project_tags t ON t.uuid = l.tag_uuid
       WHERE l.project_uuid = ? ORDER BY t.normalized_name, t.uuid`, project.uuid),
    digsStatement(env, project.uuid, me, member),
  ])).map((r) => r.results) as [(Member & Row)[], Row[], Row[], Row[], Row[], Row[], Row[], Row[], Row[]];
  const digests = entries.map((e) => e.paper_sha256 as string);
  const [copies, digs] = await Promise.all([
    membersCopies(env.DB, digests, members.map((m) => m.user_uuid)),
    digsFrom(env, digRows, me),
  ]);
  const mine = new Set(held.map((c) => c.paper_sha256 as string));
  const latest = new Map(latestCards.map((c) => [c.board_uuid as string, {
    text: cardLine(c), kind: c.kind, added_at: c.created_at,
    added_by: c.adder_uuid ? userPublic({ ...c, uuid: c.adder_uuid }) : null,
  }]));
  const onBoards = new Map<string, string[]>();
  for (const r of placed) onBoards.set(r.paper_sha256 as string, [...(onBoards.get(r.paper_sha256 as string) ?? []), r.board_uuid as string]);
  const tagsOn = new Map<string, { uuid: string; name: string }[]>();
  for (const r of tagLinks) tagsOn.set(r.paper_sha256 as string, [
    ...(tagsOn.get(r.paper_sha256 as string) ?? []),
    { uuid: r.uuid as string, name: r.name as string },
  ]);
  return {
    ...summaryOut(project, members, me),
    description: project.description,
    invite_code: member.is_keeper ? project.invite_code : null,
    tags: tagRows.map((t) => ({ uuid: t.uuid, name: t.name })),
    boards: boards.map((b) => ({
      uuid: b.uuid, name: b.name, description: b.description,
      owner: b.owner_uuid ? userPublic({ ...b, uuid: b.owner_uuid }) : null,
      item_count: b.item_count, updated_at: b.updated_at, is_new: Boolean(b.is_new), news_through: b.news_through,
      created_at: b.created_at,
      latest_card: latest.get(b.uuid as string) ?? null,
    })),
    digs,
    papers: entries.map((e) => ({
      sha256: e.paper_sha256, title: e.title, authors: e.authors, journal: e.journal, year: e.year, doi: e.doi,
      added_by: userPublic({ ...e, uuid: e.added_by }), added_at: e.added_at,
      is_new: e.added_by !== me.uuid && (e.added_at as string) > (e.read_at as string), news_through: e.added_at,
      in_my_nook: mine.has(e.paper_sha256 as string),
      users: copies.get(e.paper_sha256 as string) ?? [],
      board_uuids: onBoards.get(e.paper_sha256 as string) ?? [],
      tags: tagsOn.get(e.paper_sha256 as string) ?? [],
    })),
  };
}

// A dig as a line in a list: whose it is, its subject, how long it has
// run, and whether others have written since this member looked, the dig
// itself counting as the first thing written.
export async function digsOf(env: Env, projectUuid: string, me: User, member: Member, only?: string) {
  const { results } = await digsStatement(env, projectUuid, me, member, only).all<Row>();
  return digsFrom(env, results, me);
}

function digsStatement(env: Env, projectUuid: string, me: User, member: Member, only?: string) {
  return statement(env.DB,
    `SELECT d.*, ${SUBJECT_COLUMNS},
            (SELECT count(*) FROM dig_posts dp WHERE dp.dig_uuid = d.uuid) AS post_count,
            max(d.created_at, coalesce((SELECT max(dp.created_at) FROM dig_posts dp WHERE dp.dig_uuid = d.uuid), d.created_at)) AS news_through,
            (d.phase = 'digging') * ((d.created_at > coalesce(r.seen_at, ?) AND d.user_uuid != ?) + (SELECT count(*) FROM dig_posts dp WHERE dp.dig_uuid = d.uuid AND dp.created_at > coalesce(r.seen_at, ?) AND dp.user_uuid != ?)) AS unread,
            (SELECT group_concat(user_uuid) FROM (SELECT d.user_uuid AS user_uuid UNION SELECT DISTINCT dp.user_uuid FROM dig_posts dp WHERE dp.dig_uuid = d.uuid)) AS voices
     FROM digs d ${SUBJECT_JOINS}
     LEFT JOIN project_member_reads r ON r.member_uuid = ? AND r.item_kind = 'dig' AND r.item_uuid = d.uuid
     WHERE d.project_uuid = ? AND ${LIVE_SUBJECT} ${only ? "AND d.uuid = ?" : ""} ORDER BY d.updated_at DESC, d.uuid`,
    member.seen_at, me.uuid, member.seen_at, me.uuid, member.uuid, projectUuid, ...(only ? [only] : []));
}

// The last post in each dig and everyone who spoke, read together.
export async function digsFrom(env: Env, rows: Row[], me: User) {
  if (!rows.length) return [];
  const peopleUuids = [...new Set(rows.flatMap((d) => [String(d.user_uuid), ...String(d.voices ?? "").split(",").filter(Boolean)]))];
  const [lasts, users] = (await env.DB.batch<Row>([
    statement(env.DB,
      `SELECT dp.dig_uuid, dp.body, dp.created_at, u.uuid, u.display_name, u.affiliation, u.avatar_path, u.email, u.email_public
       FROM dig_posts dp JOIN users u ON u.uuid = dp.user_uuid
       WHERE dp.dig_uuid IN (${rows.map(() => "?").join(",")})
       AND dp.created_at = (SELECT max(created_at) FROM dig_posts x WHERE x.dig_uuid = dp.dig_uuid)`,
      ...rows.map((r) => r.uuid)),
    statement(env.DB,
      `SELECT uuid, display_name, affiliation, avatar_path, email, email_public FROM users WHERE uuid IN (${peopleUuids.map(() => "?").join(",")})`,
      ...peopleUuids),
  ])).map((r) => r.results);
  const people = new Map(users.map((u) => [u.uuid as string, userPublic(u)]));
  return rows.map((d) => {
    const posted = lasts.find((l) => l.dig_uuid === d.uuid);
    const last = posted ?? { ...(people.get(String(d.user_uuid)) as Row ?? {}), body: d.text, created_at: d.created_at };
    return {
      uuid: d.uuid, project_uuid: d.project_uuid, created_at: d.created_at, updated_at: d.updated_at,
      owner: people.get(String(d.user_uuid)) ?? null, is_mine: d.user_uuid === me.uuid,
      text: d.text, excerpt: excerpt(String(d.text)), phase: d.phase,
      subject: subjectOut(d),
      post_count: d.post_count, unread: Number(d.unread), is_new: Number(d.unread) > 0, news_through: d.news_through,
      voices: String(d.voices ?? "").split(",").filter(Boolean).map((uuid) => people.get(uuid)).filter(Boolean),
      last_post: { user: posted ? userPublic(last) : people.get(String(d.user_uuid)) ?? null, excerpt: excerpt(String(last.body)), created_at: last.created_at },
    };
  });
}

// A post as a line of plain words: its own words before any it quotes,
// links as their labels, and no Markdown marks.
export function excerpt(body: string): string {
  const lines = body.split("\n");
  const own = lines.filter((line) => !/^\s*>/.test(line));
  const words = (own.join(" ").trim() ? own : lines).join(" ")
    .replace(/\[([^\]]*)\]\([^)\s]*\)/g, "$1")
    .replace(/^\s*>\s?/, "")
    .replace(/(\*\*|__|`)/g, "");
  const flat = words.replace(/\s+/g, " ").trim();
  return flat.length > 180 ? `${flat.slice(0, 177).trimEnd()}…` : flat;
}

// Everything subjectOut needs to name a subject.
export const SUBJECT_COLUMNS = `p.title AS paper_title,
  bi.kind AS card_kind, bi.content AS card_content, bi.excerpt_text AS card_excerpt, bi.original_filename AS card_file,
  bi.board_uuid AS card_board, b.name AS board_name,
  an.kind AS annotation_kind, an.page AS annotation_page, an.body AS annotation_body,
  an.user_uuid AS annotation_user, au.display_name AS annotation_by`;
export const SUBJECT_JOINS = `LEFT JOIN papers p ON p.sha256 = d.paper_sha256
  LEFT JOIN board_items bi ON bi.uuid = d.board_item_uuid
  LEFT JOIN boards b ON b.uuid = bi.board_uuid
  LEFT JOIN annotations an ON an.uuid = d.annotation_uuid
  LEFT JOIN users au ON au.uuid = an.user_uuid`;

// A project's dig whose subject is still the project's: its paper still
// in the project, its card still on one of the project's boards, its
// anchor, ink or clip not deleted, on a project paper and by a member
// (an old note placed nowhere is no place in it).
// Any other is kept, unshown, and comes back with its subject.
export const LIVE_SUBJECT = `(CASE
  WHEN d.annotation_uuid IS NOT NULL THEN EXISTS (SELECT 1 FROM annotations la
    JOIN project_papers lpp ON lpp.paper_sha256 = la.paper_sha256 AND lpp.project_uuid = d.project_uuid
    JOIN project_members lm ON lm.user_uuid = la.user_uuid AND lm.project_uuid = d.project_uuid
    WHERE la.uuid = d.annotation_uuid AND la.deleted_at IS NULL AND la.kind != 'note')
  WHEN d.board_item_uuid IS NOT NULL THEN EXISTS (SELECT 1 FROM board_items lbi
    JOIN project_boards lpb ON lpb.board_uuid = lbi.board_uuid AND lpb.project_uuid = d.project_uuid
    JOIN boards lb ON lb.uuid = lbi.board_uuid AND lb.deleted_at IS NULL
    WHERE lbi.uuid = d.board_item_uuid AND lbi.deleted_at IS NULL)
  ELSE EXISTS (SELECT 1 FROM project_papers lpp WHERE lpp.paper_sha256 = d.paper_sha256 AND lpp.project_uuid = d.project_uuid)
END)`;

// What a dig is about, said the way the project page says it.
export function subjectOut(d: Row) {
  const key = String(d.subject);
  const base = { key, kind: key.split(":")[0] };
  if (base.kind === "paper") return { ...base, paper_sha256: d.paper_sha256, label: d.paper_title ?? "A paper" };
  if (base.kind === "annotation") {
    return {
      ...base, annotation_uuid: d.annotation_uuid, paper_sha256: d.paper_sha256, paper_title: d.paper_title,
      annotation_kind: d.annotation_kind ?? null, page: d.annotation_page ?? null, down: annotationDown(d), user_uuid: d.annotation_user ?? null, by: d.annotation_by ?? null,
      label: annotationLabel(d),
    };
  }
  const text = (d.card_excerpt || d.card_content || d.card_file || "") as string;
  return {
    ...base, board_item_uuid: d.board_item_uuid, board_uuid: d.card_board, board_name: d.board_name,
    card_kind: d.card_kind, label: text ? excerpt(text).slice(0, 120) : `A card on ${d.board_name ?? "a board"}`,
  };
}

// How far down its page an annotation sits, as a fraction from the top, so
// the digs inside a paper can run in reading order. An anchor's point and
// ink's points are PDF-space (y up); a clip's frame is measured from the top.
export function annotationDown(d: Row): number | null {
  let body: { anchor?: { y?: number }; points?: { y?: number }[]; frame?: { y?: number; h?: number } };
  try { body = JSON.parse(String(d.annotation_body ?? "{}")); } catch { return null; }
  const ys = (body.points ?? []).map((p) => Number(p.y)).filter(Number.isFinite);
  const down = typeof body.anchor?.y === "number" ? 1 - body.anchor.y
    : ys.length ? 1 - Math.max(...ys)
    : typeof body.frame?.y === "number" ? body.frame.y
    : null;
  return down == null ? null : Math.min(1, Math.max(0, down));
}

// An annotation named in a line, by what it is and where: what was
// written there is the dig itself.
function annotationLabel(d: Row): string {
  const where = d.annotation_page ? ` on page ${d.annotation_page}` : "";
  if (d.annotation_kind === "ink") return `Ink${where}`;
  if (d.annotation_kind === "clip") return `A clip${where}`;
  if (d.annotation_kind === "anchor") return `An anchor${where}`;
  return "An annotation";
}

function touched(env: Env, project: Project): D1PreparedStatement {
  project.updated_at = now();
  return statement(env.DB, "UPDATE projects SET updated_at = ? WHERE uuid = ?", project.updated_at, project.uuid);
}

// A member going, by their own choice or a keeper's. A project is never
// left without a keeper while anyone is in it, and one nobody is in is over.
async function leaving(env: Env, project: Project, member: Member): Promise<D1PreparedStatement[]> {
  const others = (await all<Member>(env.DB, "SELECT * FROM project_members WHERE project_uuid = ? AND user_uuid != ? ORDER BY joined_at, uuid",
    project.uuid, member.user_uuid));
  const out = statement(env.DB, "DELETE FROM project_members WHERE uuid = ?", member.uuid);
  if (!others.length) return [out, statement(env.DB, "UPDATE projects SET deleted_at = ?, invite_code = NULL, updated_at = ? WHERE uuid = ?", now(), now(), project.uuid)];
  if (member.is_keeper && !others.some((m) => m.is_keeper)) refuse(400, "Make another member a keeper first");
  return [out, touched(env, project)];
}

export function projectRoutes(router: Router) {
  // Every project, the viewer's own first. With `?paper=<sha256>`, each
  // of the viewer's projects says whether it holds that paper.
  router.on("GET", "/api/projects", async ({ request, env, url }) => {
    const me = await currentUser(request, env);
    const projects = await all<Project>(env.DB, "SELECT * FROM projects WHERE deleted_at IS NULL ORDER BY lower(name), uuid");
    const members = await membersOf(env, projects.map((p) => p.uuid));
    const counts = await newCounts(env, me);
    const paper = url.searchParams.get("paper")?.toLowerCase();
    const holding = paper && DIGEST.test(paper)
      ? new Set((await all<{ project_uuid: string }>(env.DB, "SELECT project_uuid FROM project_papers WHERE paper_sha256 = ?", paper)).map((r) => r.project_uuid))
      : null;
    const out = projects.map((project) => {
      const summary = summaryOut(project, members.filter((m) => m.project_uuid === project.uuid), me);
      return {
        ...summary,
        new_count: summary.is_member ? counts.get(project.uuid) ?? 0 : 0,
        ...(holding && summary.is_member ? { has_paper: holding.has(project.uuid) } : {}),
      };
    });
    return json([...out.filter((p) => p.is_member), ...out.filter((p) => !p.is_member)]);
  });

  router.on("POST", "/api/projects", async ({ request, env }) => {
    const me = await currentUser(request, env);
    const data = await readJson<Row>(request);
    const at = now();
    const project: Project = { uuid: newUuid(), name: projectName(data.name), description: null, invite_code: null, created_at: at, updated_at: at, deleted_at: null };
    const member: Member = { uuid: newUuid(), project_uuid: project.uuid, user_uuid: me.uuid, is_keeper: 1, joined_at: at, seen_at: at };
    await batch(env.DB, [insert(env.DB, "projects", project), insert(env.DB, "project_members", member)]);
    return json(await projectOut(env, project, me, member));
  });

  // Looking is read-only. Background refreshes and another open window must
  // never consume news; the client explicitly acknowledges displayed items.
  router.on("GET", "/api/projects/:uuid", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const [project, member] = await Promise.all([
      liveProject(env, params.uuid),
      one<Member>(env.DB, "SELECT * FROM project_members WHERE project_uuid = ? AND user_uuid = ?", params.uuid, me.uuid),
    ]);
    if (!member) return json(summaryOut(project, await membersOf(env, [project.uuid]), me));
    return json(await projectOut(env, project, me, member));
  });

  router.on("POST", "/api/projects/:uuid/reads", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const project = await liveProject(env, params.uuid);
    const member = await membership(env, project, me);
    const data = await readJson<Row>(request);
    const kind = String(data.kind ?? "");
    const item = String(data.item ?? "");
    const through = String(data.through ?? "");
    if (!['paper', 'board', 'dig'].includes(kind) || !item || !through || Number.isNaN(Date.parse(through))) {
      refuse(422, "kind, item and through are required");
    }
    const belongs = kind === 'paper'
      ? await one(env.DB, "SELECT added_at AS latest FROM project_papers WHERE project_uuid = ? AND paper_sha256 = ?", project.uuid, item)
      : kind === 'board'
        ? await one(env.DB, `SELECT b.uuid, max(bi.created_at) AS latest FROM project_boards pb JOIN boards b ON b.uuid = pb.board_uuid AND b.deleted_at IS NULL
            LEFT JOIN board_items bi ON bi.board_uuid = b.uuid AND bi.deleted_at IS NULL AND NOT bi.staged WHERE pb.project_uuid = ? AND b.uuid = ?`, project.uuid, item)
        : await one(env.DB, `SELECT d.uuid, max(d.created_at, coalesce((SELECT max(dp.created_at) FROM dig_posts dp WHERE dp.dig_uuid = d.uuid), d.created_at)) AS latest
            FROM digs d WHERE d.project_uuid = ? AND d.uuid = ?`, project.uuid, item);
    if (!belongs || (kind !== 'paper' && !belongs.uuid)) refuse(404, "Project item not found");
    const latest = String(belongs.latest ?? through);
    const seenAt = through > latest ? latest : through;
    await statement(env.DB, `INSERT INTO project_member_reads (member_uuid, item_kind, item_uuid, seen_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(member_uuid, item_kind, item_uuid) DO UPDATE SET seen_at = max(seen_at, excluded.seen_at)`,
    member.uuid, kind, item, seenAt).run();
    return json({ kind, item, seen_at: seenAt });
  });

  router.on("PUT", "/api/projects/:uuid", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const project = await liveProject(env, params.uuid);
    const member = await keeping(env, project, me);
    const data = await readJson<Row>(request);
    // A keeper renames it or says what it is about, one at a time.
    if (data.name !== undefined) project.name = projectName(data.name);
    if (data.description !== undefined) project.description = projectDescription(data.description);
    project.updated_at = now();
    await batch(env.DB, [update(env.DB, "projects", "uuid", project.uuid, { name: project.name, description: project.description, updated_at: project.updated_at })]);
    return json(await projectOut(env, project, me, member));
  });

  router.on("DELETE", "/api/projects/:uuid", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const project = await liveProject(env, params.uuid);
    await keeping(env, project, me);
    await batch(env.DB, [statement(env.DB, "UPDATE projects SET deleted_at = ?, invite_code = NULL, updated_at = ? WHERE uuid = ?", now(), now(), project.uuid)]);
    return json({ message: "Project deleted" });
  });

  // ------------------------------------------------------------ invitations

  // The invitation link: one per project, asked for again it is the same
  // one. Revoking it leaves everyone who joined in place.
  router.on("POST", "/api/projects/:uuid/invite", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const project = await liveProject(env, params.uuid);
    await keeping(env, project, me);
    if (!project.invite_code) {
      project.invite_code = newShareCode();
      await batch(env.DB, [statement(env.DB, "UPDATE projects SET invite_code = ?, updated_at = ? WHERE uuid = ?", project.invite_code, now(), project.uuid)]);
    }
    return json({ invite_code: project.invite_code });
  });

  router.on("DELETE", "/api/projects/:uuid/invite", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const project = await liveProject(env, params.uuid);
    await keeping(env, project, me);
    await batch(env.DB, [statement(env.DB, "UPDATE projects SET invite_code = NULL, updated_at = ? WHERE uuid = ?", now(), project.uuid)]);
    return json({ invite_code: null });
  });

  // What an invitation is to, before accepting it.
  router.on("GET", "/api/project-invites/:code", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const project = isShareCode(params.code)
      ? await one<Project>(env.DB, "SELECT * FROM projects WHERE invite_code = ? AND deleted_at IS NULL", params.code) : null;
    if (!project) refuse(404, "This invitation is no longer open");
    return json(summaryOut(project, await membersOf(env, [project.uuid]), me));
  });

  router.on("POST", "/api/project-invites/:code", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const project = isShareCode(params.code)
      ? await one<Project>(env.DB, "SELECT * FROM projects WHERE invite_code = ? AND deleted_at IS NULL", params.code) : null;
    if (!project) refuse(404, "This invitation is no longer open");
    let member = await one<Member>(env.DB, "SELECT * FROM project_members WHERE project_uuid = ? AND user_uuid = ?", project.uuid, me.uuid);
    if (!member) {
      // Joining late is seeing the whole history, none of it as news.
      const at = now();
      member = { uuid: newUuid(), project_uuid: project.uuid, user_uuid: me.uuid, is_keeper: 0, joined_at: at, seen_at: at };
      await batch(env.DB, [insert(env.DB, "project_members", member), touched(env, project)]);
    }
    return json(await projectOut(env, project, me, member));
  });

  // -------------------------------------------------------------- members

  // People a keeper can add: anyone in Papol not yet in the project whose
  // name has the words asked for in it, or whose address is the one asked
  // for. An address nobody chose to show is matched whole, never in part.
  router.on("GET", "/api/projects/:uuid/people", async ({ request, env, params, url }) => {
    const me = await currentUser(request, env);
    const project = await liveProject(env, params.uuid);
    await keeping(env, project, me);
    const asked = tidy(url.searchParams.get("q") ?? "").toLowerCase();
    if (!asked) return json([]);
    const like = `%${asked.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const people = await all<Row>(env.DB,
      `SELECT u.uuid, u.display_name, u.affiliation, u.avatar_path, u.email, u.email_public FROM users u
       WHERE u.deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM project_members m WHERE m.project_uuid = ? AND m.user_uuid = u.uuid)
         AND (lower(u.display_name) LIKE ? ESCAPE '\\' OR lower(u.email) = ? OR (u.email_public = 1 AND lower(u.email) LIKE ? ESCAPE '\\'))
       ORDER BY lower(u.email) = ? DESC, lower(u.display_name), u.uuid LIMIT 8`,
      project.uuid, like, asked, like, asked);
    return json(people.map(userPublic));
  });

  // A keeper adding someone already in Papol: they are a member at once,
  // as if they had followed the link, and their inbox says who added them.
  router.on("POST", "/api/projects/:uuid/members", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const project = await liveProject(env, params.uuid);
    const mine = await keeping(env, project, me);
    const data = await readJson<Row>(request);
    const check = validate.checking();
    const userUuid = check.string("user_uuid", data.user_uuid, { min: 1, max: 64 });
    check.done();
    const user = await one<User>(env.DB, "SELECT * FROM users WHERE uuid = ? AND deleted_at IS NULL", userUuid);
    if (!user) refuse(404, "User not found");
    const already = await one<Member>(env.DB, "SELECT * FROM project_members WHERE project_uuid = ? AND user_uuid = ?", project.uuid, user.uuid);
    if (!already) {
      const at = now();
      await batch(env.DB, [
        insert(env.DB, "project_members", { uuid: newUuid(), project_uuid: project.uuid, user_uuid: user.uuid, is_keeper: 0, joined_at: at, seen_at: at }),
        insert(env.DB, "notifications", { uuid: newUuid(), user_uuid: user.uuid, content: `${me.display_name} added you to ${project.name}.`, read: 0, created_at: at }),
        touched(env, project),
      ]);
    }
    return json(await projectOut(env, project, me, mine));
  });

  router.on("PUT", "/api/projects/:uuid/members/:user", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const project = await liveProject(env, params.uuid);
    const mine = await keeping(env, project, me);
    const data = await readJson<Row>(request);
    const check = validate.checking();
    const isKeeper = check.boolean("is_keeper", data.is_keeper);
    check.done();
    const member = await one<Member>(env.DB, "SELECT * FROM project_members WHERE project_uuid = ? AND user_uuid = ?", project.uuid, params.user);
    if (!member) refuse(404, "Not a member of this project");
    if (!isKeeper && member.is_keeper) {
      const keepers = await one<{ n: number }>(env.DB, "SELECT count(*) AS n FROM project_members WHERE project_uuid = ? AND is_keeper = 1", project.uuid);
      if (keepers!.n <= 1) refuse(400, "A project needs a keeper");
    }
    await batch(env.DB, [statement(env.DB, "UPDATE project_members SET is_keeper = ? WHERE uuid = ?", isKeeper ? 1 : 0, member.uuid), touched(env, project)]);
    return json(await projectOut(env, project, me, member.uuid === mine.uuid ? { ...mine, is_keeper: isKeeper ? 1 : 0 } : mine));
  });

  // Leaving, or a keeper removing someone. What they added stays.
  router.on("DELETE", "/api/projects/:uuid/members/:user", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const project = await liveProject(env, params.uuid);
    const mine = await membership(env, project, me);
    if (params.user !== me.uuid && !mine.is_keeper) refuse(403, "Only a keeper can do that");
    const member = params.user === me.uuid ? mine
      : await one<Member>(env.DB, "SELECT * FROM project_members WHERE project_uuid = ? AND user_uuid = ?", project.uuid, params.user);
    if (!member) refuse(404, "Not a member of this project");
    await batch(env.DB, await leaving(env, project, member));
    return json({ message: params.user === me.uuid ? "Left the project" : "Member removed" });
  });

  // --------------------------------------------------------------- papers

  // A member adds a paper they hold. Their copy stays where it is.
  // A board for the project: made by a member and edited by all the
  // members. It is the project's, not its maker's: on no shelf and in no
  // replica (boardReplica), so nobody's nook holds it.
  router.on("POST", "/api/projects/:uuid/boards", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const project = await liveProject(env, params.uuid);
    await membership(env, project, me);
    const data = await readJson<Row>(request);
    const check = validate.checking();
    const name = check.string("name", data.name, { min: 1, max: limits.text.board_name });
    check.done();
    const at = now();
    const board: Row = {
      uuid: newUuid(), user_uuid: me.uuid, shelf_uuid: null, name: tidy(name!),
      description: null, created_at: at, updated_at: at, revision: 0, deleted_at: null,
    };
    await batch(env.DB, [
      ...await writeSynced(env.DB, "boards", board, null, true),
      insert(env.DB, "project_boards", { uuid: newUuid(), project_uuid: project.uuid, board_uuid: board.uuid, created_at: at }),
      touched(env, project),
    ]);
    return json(await boardOut(env, board as never, { canEdit: true }));
  });

  // --------------------------------------------------------------- tags

  // A project's tags belong to the project. Any member may extend its
  // vocabulary and use it; keepers curate names and remove tags everywhere.
  router.on("POST", "/api/projects/:uuid/tags", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const project = await liveProject(env, params.uuid);
    await membership(env, project, me);
    const data = await readJson<Row>(request);
    const { name, normalized } = tagName(data.name);
    const existing = await one<{ uuid: string; name: string }>(env.DB,
      "SELECT uuid, name FROM project_tags WHERE project_uuid = ? AND normalized_name = ?", project.uuid, normalized);
    if (existing) return json(existing);
    const at = now();
    const tag = { uuid: newUuid(), project_uuid: project.uuid, name, normalized_name: normalized, created_at: at, updated_at: at };
    await batch(env.DB, [insert(env.DB, "project_tags", tag), touched(env, project)]);
    return json({ uuid: tag.uuid, name: tag.name });
  });

  router.on("PUT", "/api/projects/:uuid/tags/:tag", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const project = await liveProject(env, params.uuid);
    await keeping(env, project, me);
    const tag = await one<Row>(env.DB, "SELECT * FROM project_tags WHERE uuid = ? AND project_uuid = ?", params.tag, project.uuid);
    if (!tag) refuse(404, "Tag not found");
    const data = await readJson<Row>(request);
    const { name, normalized } = tagName(data.name);
    const duplicate = await one(env.DB,
      "SELECT 1 FROM project_tags WHERE project_uuid = ? AND normalized_name = ? AND uuid != ?", project.uuid, normalized, tag.uuid);
    if (duplicate) refuse(409, "That tag already exists");
    const at = now();
    await batch(env.DB, [
      update(env.DB, "project_tags", "uuid", tag.uuid, { name, normalized_name: normalized, updated_at: at }),
      touched(env, project),
    ]);
    return json({ uuid: tag.uuid, name });
  });

  router.on("DELETE", "/api/projects/:uuid/tags/:tag", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const project = await liveProject(env, params.uuid);
    await keeping(env, project, me);
    const tag = await one<Row>(env.DB, "SELECT * FROM project_tags WHERE uuid = ? AND project_uuid = ?", params.tag, project.uuid);
    if (!tag) refuse(404, "Tag not found");
    await batch(env.DB, [
      statement(env.DB, "DELETE FROM project_paper_tags WHERE tag_uuid = ?", tag.uuid),
      statement(env.DB, "DELETE FROM project_tags WHERE uuid = ?", tag.uuid),
      touched(env, project),
    ]);
    return new Response(null, { status: 204 });
  });

  const tagPaper = async (env: Env, project: Project, digest: string, tagUuid: string) => {
    const entry = await one<{ uuid: string }>(env.DB,
      "SELECT uuid FROM project_papers WHERE project_uuid = ? AND paper_sha256 = ?", project.uuid, digest);
    if (!entry) refuse(404, "That paper is not in this project");
    const tag = await one<{ uuid: string; name: string }>(env.DB,
      "SELECT uuid, name FROM project_tags WHERE uuid = ? AND project_uuid = ?", tagUuid, project.uuid);
    if (!tag) refuse(404, "Tag not found");
    return { entry, tag };
  };

  router.on("POST", "/api/projects/:uuid/papers/:sha256/tags/:tag", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const project = await liveProject(env, params.uuid);
    await membership(env, project, me);
    const { entry, tag } = await tagPaper(env, project, params.sha256.toLowerCase(), params.tag);
    const existing = await one(env.DB,
      "SELECT 1 FROM project_paper_tags WHERE project_paper_uuid = ? AND tag_uuid = ?", entry.uuid, tag.uuid);
    if (!existing) await batch(env.DB, [
      insert(env.DB, "project_paper_tags", {
        uuid: newUuid(), project_uuid: project.uuid, project_paper_uuid: entry.uuid, tag_uuid: tag.uuid, created_at: now(),
      }),
      touched(env, project),
    ]);
    return json(tag);
  });

  router.on("DELETE", "/api/projects/:uuid/papers/:sha256/tags/:tag", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const project = await liveProject(env, params.uuid);
    await membership(env, project, me);
    const { entry, tag } = await tagPaper(env, project, params.sha256.toLowerCase(), params.tag);
    await batch(env.DB, [
      statement(env.DB, "DELETE FROM project_paper_tags WHERE project_paper_uuid = ? AND tag_uuid = ?", entry.uuid, tag.uuid),
      touched(env, project),
    ]);
    return new Response(null, { status: 204 });
  });

  router.on("POST", "/api/projects/:uuid/papers", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const project = await liveProject(env, params.uuid);
    const member = await membership(env, project, me);
    const data = await readJson<Row>(request);
    const check = validate.checking();
    const digest = check.string("paper_sha256", data.paper_sha256, { pattern: DIGEST });
    check.done();
    if (!(await one(env.DB, "SELECT 1 FROM copies WHERE user_uuid = ? AND paper_sha256 = ? AND deleted_at IS NULL", me.uuid, digest))) {
      refuse(400, "Add the paper to your nook first");
    }
    if (!(await one(env.DB, "SELECT 1 FROM project_papers WHERE project_uuid = ? AND paper_sha256 = ?", project.uuid, digest))) {
      await batch(env.DB, [
        insert(env.DB, "project_papers", { uuid: newUuid(), project_uuid: project.uuid, paper_sha256: digest, added_by: me.uuid, added_at: now() }),
        touched(env, project),
      ]);
    }
    return json(await projectOut(env, project, me, member));
  });

  // A paper with the project on: every member's anchors, ink and clips on
  // it, each saying whose, and the digs already open on them. Read only;
  // an annotation is written through its author's own routes. Joining is
  // trust, as the copies are: what a member left on a project's paper is
  // what the project reads.
  router.on("GET", "/api/projects/:uuid/papers/:sha256/annotations", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const project = await liveProject(env, params.uuid);
    const member = await membership(env, project, me);
    const digest = params.sha256.toLowerCase();
    if (!(await one(env.DB, "SELECT 1 FROM project_papers WHERE project_uuid = ? AND paper_sha256 = ?", project.uuid, digest))) {
      refuse(404, "That paper is not in this project");
    }
    const members = await membersOf(env, [project.uuid]);
    const rows = await all<Row>(env.DB,
      `SELECT a.* FROM annotations a JOIN project_members m ON m.user_uuid = a.user_uuid AND m.project_uuid = ?
       WHERE a.paper_sha256 = ? AND a.deleted_at IS NULL ORDER BY a.created_at, a.uuid`, project.uuid, digest);
    const people = new Map(members.map((m) => [m.user_uuid, userPublic({ ...m, uuid: m.user_uuid })]));
    const paperKey = `paper:${digest}`;
    const pins = await pinsOf(env, project.uuid, me, member, [paperKey, ...rows.map((a) => `annotation:${a.uuid}`)]);
    const { [paperKey]: paperPin, ...annotationPins } = pins;
    // Another member's anchor shows only as the place of a dig; one nobody
    // has dug there says nothing to the project.
    const shown = rows.filter((a) => a.kind !== "anchor" || a.user_uuid === me.uuid || `annotation:${a.uuid}` in annotationPins);
    return json({
      project: { uuid: project.uuid, name: project.name, members: members.map((projectMember) => memberOut(projectMember)) },
      me: me.uuid,
      annotations: shown.map((a) => ({ ...annotationOut(a), user: people.get(String(a.user_uuid)) ?? null })),
      digs: Object.fromEntries(Object.entries(annotationPins).map(([key, pin]) => [key.slice("annotation:".length), pin])),
      // The digs on the paper itself, which head the viewer's margin.
      paper_digs: paperPin ?? null,
    });
  });

  // Whoever added a paper, or a keeper, can take it out again.
  router.on("DELETE", "/api/projects/:uuid/papers/:sha256", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const project = await liveProject(env, params.uuid);
    const member = await membership(env, project, me);
    const entry = await one<{ uuid: string; added_by: string }>(env.DB,
      "SELECT uuid, added_by FROM project_papers WHERE project_uuid = ? AND paper_sha256 = ?", project.uuid, params.sha256.toLowerCase());
    if (!entry) refuse(404, "That paper is not in this project");
    if (entry.added_by !== me.uuid && !member.is_keeper) refuse(403, "Only whoever added it, or a keeper, can take it out");
    await batch(env.DB, [
      statement(env.DB, "DELETE FROM project_paper_tags WHERE project_paper_uuid = ?", entry.uuid),
      statement(env.DB, "DELETE FROM project_papers WHERE uuid = ?", entry.uuid),
      touched(env, project),
    ]);
    return json(await projectOut(env, project, me, member));
  });
}

// The projects a user is in, as their nook lists them to anyone.
export async function projectsOfUser(env: Env, userUuid: string, me: User) {
  const projects = await all<Project>(env.DB,
    `SELECT p.* FROM projects p JOIN project_members m ON m.project_uuid = p.uuid
     WHERE m.user_uuid = ? AND p.deleted_at IS NULL ORDER BY lower(p.name), p.uuid`, userUuid);
  const members = await membersOf(env, projects.map((p) => p.uuid));
  return projects.map((p) => summaryOut(p, members.filter((m) => m.project_uuid === p.uuid), me));
}

// A closing account's boards in projects that go on are handed to the
// member who keeps the project longest (or, with no keeper, was there
// first). The board stays the project's, in no replica.
export async function handOnProjectBoards(env: Env, userUuid: string): Promise<number> {
  const boards = await all<Row>(env.DB,
    `SELECT b.*, pb.project_uuid FROM boards b JOIN project_boards pb ON pb.board_uuid = b.uuid
     JOIN projects p ON p.uuid = pb.project_uuid AND p.deleted_at IS NULL WHERE b.user_uuid = ?`, userUuid);
  let handed = 0;
  for (const board of boards) {
    const heir = await one<{ user_uuid: string }>(env.DB,
      "SELECT user_uuid FROM project_members WHERE project_uuid = ? AND user_uuid != ? ORDER BY is_keeper DESC, joined_at, uuid LIMIT 1",
      board.project_uuid, userUuid);
    if (!heir) continue;
    const { project_uuid: _, ...row } = board;
    row.user_uuid = heir.user_uuid;
    await batch(env.DB, await writeSynced(env.DB, "boards", row, null, false));
    handed++;
  }
  return handed;
}

// A closing account leaves each project as a member leaving would, except
// that a project must not be stuck without a keeper: the earliest to have
// joined of those left is given it.
export async function leaveAllProjects(env: Env, userUuid: string): Promise<D1PreparedStatement[]> {
  const statements: D1PreparedStatement[] = [];
  for (const member of await all<Member>(env.DB, "SELECT * FROM project_members WHERE user_uuid = ?", userUuid)) {
    const others = await all<Member>(env.DB, "SELECT * FROM project_members WHERE project_uuid = ? AND user_uuid != ? ORDER BY joined_at, uuid",
      member.project_uuid, userUuid);
    if (!others.length) {
      statements.push(statement(env.DB, "UPDATE projects SET deleted_at = ?, invite_code = NULL, updated_at = ? WHERE uuid = ?", now(), now(), member.project_uuid));
    } else if (member.is_keeper && !others.some((m) => m.is_keeper)) {
      statements.push(statement(env.DB, "UPDATE project_members SET is_keeper = 1 WHERE uuid = ?", others[0].uuid));
    }
  }
  statements.push(statement(env.DB, "DELETE FROM project_members WHERE user_uuid = ?", userUuid));
  return statements;
}
