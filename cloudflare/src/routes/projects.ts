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
import { membersCopies } from "../papers/list";
import { isShareCode, newShareCode } from "../papers/sharables";
import * as validate from "../validate";
import { userPublic } from "./boards";

export interface Project extends Row {
  uuid: string;
  name: string;
  invite_code: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface Member extends Row {
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

function projectName(value: unknown): string {
  const check = validate.checking();
  const name = tidy(check.string("name", value, { min: 1, max: limits.text.project_name }) ?? "");
  check.done();
  return name || refuse(422, "name is required");
}

async function liveProject(env: Env, uuid: string): Promise<Project> {
  const project = await one<Project>(env.DB, "SELECT * FROM projects WHERE uuid = ? AND deleted_at IS NULL", uuid);
  return project ?? refuse(404, "Project not found");
}

async function membersOf(env: Env, projectUuids: string[]): Promise<(Member & Row)[]> {
  if (!projectUuids.length) return [];
  return all<Member & Row>(env.DB,
    `SELECT m.*, u.display_name, u.affiliation, u.avatar_path, u.email, u.email_public
     FROM project_members m JOIN users u ON u.uuid = m.user_uuid
     WHERE m.project_uuid IN (${projectUuids.map(() => "?").join(",")}) ORDER BY m.joined_at, m.uuid`, ...projectUuids);
}

function memberOut(member: Member & Row) {
  return { user: userPublic({ ...member, uuid: member.user_uuid }), is_keeper: Boolean(member.is_keeper), joined_at: member.joined_at };
}

// What anyone signed in sees of a project: that it exists, and who is in it.
function summaryOut(project: Project, members: (Member & Row)[], me: User) {
  const mine = members.find((m) => m.user_uuid === me.uuid);
  return {
    uuid: project.uuid, name: project.name, created_at: project.created_at,
    members: members.map(memberOut), is_member: Boolean(mine), is_keeper: Boolean(mine?.is_keeper),
  };
}

async function membership(env: Env, project: Project, user: User): Promise<Member> {
  const member = await one<Member>(env.DB, "SELECT * FROM project_members WHERE project_uuid = ? AND user_uuid = ?", project.uuid, user.uuid);
  // A project's contents are for its members; to anyone else it may as
  // well have none.
  return member ?? refuse(403, "Only members can open this project");
}

async function keeping(env: Env, project: Project, user: User): Promise<Member> {
  const member = await membership(env, project, user);
  return member.is_keeper ? member : refuse(403, "Only a keeper can do that");
}

// The papers other members added since this member last looked.
async function newCounts(env: Env, user: User): Promise<Map<string, number>> {
  const rows = await all<{ project_uuid: string; n: number }>(env.DB,
    `SELECT m.project_uuid, count(pp.uuid) AS n FROM project_members m
     JOIN project_papers pp ON pp.project_uuid = m.project_uuid AND pp.added_at > m.seen_at AND pp.added_by != m.user_uuid
     WHERE m.user_uuid = ? GROUP BY m.project_uuid`, user.uuid);
  return new Map(rows.map((r) => [r.project_uuid, r.n]));
}

// The whole project, as a member sees it.
async function projectOut(env: Env, project: Project, me: User, member: Member) {
  const members = await membersOf(env, [project.uuid]);
  const entries = await all<Row>(env.DB,
    `SELECT pp.paper_sha256, pp.added_by, pp.added_at, p.title, p.authors, p.journal, p.year, p.doi,
            u.display_name, u.affiliation, u.avatar_path, u.email, u.email_public
     FROM project_papers pp JOIN papers p ON p.sha256 = pp.paper_sha256 JOIN users u ON u.uuid = pp.added_by
     WHERE pp.project_uuid = ? ORDER BY pp.added_at DESC, pp.uuid`, project.uuid);
  const digests = entries.map((e) => e.paper_sha256 as string);
  const copies = await membersCopies(env.DB, digests, members.map((m) => m.user_uuid));
  const held = new Set(digests.length ? (await all<{ paper_sha256: string }>(env.DB,
    `SELECT paper_sha256 FROM copies WHERE user_uuid = ? AND deleted_at IS NULL AND paper_sha256 IN (${digests.map(() => "?").join(",")})`,
    me.uuid, ...digests)).map((c) => c.paper_sha256) : []);
  return {
    ...summaryOut(project, members, me),
    invite_code: member.is_keeper ? project.invite_code : null,
    papers: entries.map((e) => ({
      sha256: e.paper_sha256, title: e.title, authors: e.authors, journal: e.journal, year: e.year, doi: e.doi,
      added_by: userPublic({ ...e, uuid: e.added_by }), added_at: e.added_at,
      is_new: e.added_by !== me.uuid && (e.added_at as string) > member.seen_at,
      in_my_nook: held.has(e.paper_sha256 as string),
      users: copies.get(e.paper_sha256 as string) ?? [],
    })),
  };
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
    const project: Project = { uuid: newUuid(), name: projectName(data.name), invite_code: null, created_at: at, updated_at: at, deleted_at: null };
    const member: Member = { uuid: newUuid(), project_uuid: project.uuid, user_uuid: me.uuid, is_keeper: 1, joined_at: at, seen_at: at };
    await batch(env.DB, [insert(env.DB, "projects", project), insert(env.DB, "project_members", member)]);
    return json(await projectOut(env, project, me, member));
  });

  // Opening a project is looking at it: what others added until now is
  // no longer new. Anyone else is told only what the listing says.
  router.on("GET", "/api/projects/:uuid", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const project = await liveProject(env, params.uuid);
    const member = await one<Member>(env.DB, "SELECT * FROM project_members WHERE project_uuid = ? AND user_uuid = ?", project.uuid, me.uuid);
    if (!member) return json(summaryOut(project, await membersOf(env, [project.uuid]), me));
    const out = await projectOut(env, project, me, member);
    await batch(env.DB, [statement(env.DB, "UPDATE project_members SET seen_at = ? WHERE uuid = ?", now(), member.uuid)]);
    return json(out);
  });

  router.on("PUT", "/api/projects/:uuid", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const project = await liveProject(env, params.uuid);
    const member = await keeping(env, project, me);
    const data = await readJson<Row>(request);
    project.name = projectName(data.name);
    project.updated_at = now();
    await batch(env.DB, [update(env.DB, "projects", "uuid", project.uuid, { name: project.name, updated_at: project.updated_at })]);
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

  // Whoever added a paper, or a keeper, can take it out again.
  router.on("DELETE", "/api/projects/:uuid/papers/:sha256", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const project = await liveProject(env, params.uuid);
    const member = await membership(env, project, me);
    const entry = await one<{ uuid: string; added_by: string }>(env.DB,
      "SELECT uuid, added_by FROM project_papers WHERE project_uuid = ? AND paper_sha256 = ?", project.uuid, params.sha256.toLowerCase());
    if (!entry) refuse(404, "That paper is not in this project");
    if (entry.added_by !== me.uuid && !member.is_keeper) refuse(403, "Only whoever added it, or a keeper, can take it out");
    await batch(env.DB, [statement(env.DB, "DELETE FROM project_papers WHERE uuid = ?", entry.uuid), touched(env, project)]);
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
