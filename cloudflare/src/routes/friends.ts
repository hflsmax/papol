// Friends: someone a user chose, who chose them back. Always mutual and
// asked for. It is the third audience for what a user does, between
// everyone signed in and the members of a project: beyond what a public
// shelf already shows, a friend reads and posts in the user's digs on the
// papers they keep on a public shelf (friendSees). Nobody, friend or not,
// sees what a user reads or for how long. A private shelf hides a copy
// from friends as from everyone.
//
// A request is answered Accept or Not now. Not now is quiet: the asker is
// never told and cannot ask again, though the asked can change their mind.
// Two users who each ask the other are friends. Ending a friendship tells
// nobody.

import { currentUser, type User } from "../auth";
import { all, batch, insert, newUuid, now, one, statement, type Row } from "../db";
import { json, readJson, refuse, type Router } from "../http";
import { queueEmail, siteUrl } from "../jobs/notifications";
import { wake } from "../jobs/queue";
import * as validate from "../validate";
import { userPublic } from "./boards";
import { liveProject, onPublicShelf } from "./projects";

interface Friendship extends Row {
  uuid: string;
  asker_uuid: string;
  asked_uuid: string;
  state: "asked" | "declined" | "dropped" | "friends";
  created_at: string;
  answered_at: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PERSON = "u.uuid, u.display_name, u.affiliation, u.avatar_path, u.email, u.email_public";

// A user's uuid as an SQL literal, for the conditions below, which name
// the reader many times over. Only a uuid passes.
export function userLiteral(uuid: string): string {
  if (!UUID.test(uuid)) throw new Error("Not a user uuid");
  return `'${uuid}'`;
}

// The uuids of a user's friends, as a subquery. `user` is an SQL
// expression: a column, or a uuid made a literal by userLiteral.
export function friendsOf(user: string): string {
  return `(SELECT CASE WHEN lf.asker_uuid = ${user} THEN lf.asked_uuid ELSE lf.asker_uuid END FROM friendships lf
    WHERE lf.state = 'friends' AND (lf.asker_uuid = ${user} OR lf.asked_uuid = ${user}))`;
}

// Whether a friend of its writer sees dig `d`: one on a paper, or on a
// mark on it, that its writer keeps on a public shelf. `reader` is an SQL
// expression for the reader's uuid. The rule a project follows
// (inProject), with friendship where the project stood.
export function friendSees(reader: string): string {
  return `(d.project_uuid IS NULL AND d.board_item_uuid IS NULL AND d.paper_sha256 IS NOT NULL
    AND d.user_uuid IN ${friendsOf(reader)}
    AND ${onPublicShelf("d.user_uuid", "d.paper_sha256")}
    AND (d.annotation_uuid IS NULL OR EXISTS (SELECT 1 FROM annotations la
      WHERE la.uuid = d.annotation_uuid AND la.paper_sha256 = d.paper_sha256 AND la.deleted_at IS NULL AND la.kind != 'note')))`;
}

async function between(env: Env, a: string, b: string): Promise<Friendship | null> {
  return one<Friendship>(env.DB,
    "SELECT * FROM friendships WHERE (asker_uuid = ? AND asked_uuid = ?) OR (asker_uuid = ? AND asked_uuid = ?)", a, b, b, a);
}

export async function areFriends(env: Env, a: string, b: string): Promise<boolean> {
  return (await between(env, a, b))?.state === "friends";
}

// One line in someone's inbox that is more than its words: what it is,
// who it is from and where it leads.
export function notice(env: Env, userUuid: string, content: string, kind: string, actor: User, link: string, at = now()): D1PreparedStatement {
  return insert(env.DB, "notifications", { uuid: newUuid(), user_uuid: userUuid, content, read: 0, created_at: at, kind, actor_uuid: actor.uuid, link });
}

async function liveUser(env: Env, uuid: string): Promise<User> {
  const user = UUID.test(uuid) ? await one<User>(env.DB, "SELECT * FROM users WHERE uuid = ? AND deleted_at IS NULL", uuid.toLowerCase()) : null;
  return user ?? refuse(404, "User not found");
}

// Two users become friends, whatever stood between them before.
function befriend(env: Env, existing: Friendship | null, asker: string, asked: string, at: string): D1PreparedStatement[] {
  return existing
    ? [statement(env.DB, "UPDATE friendships SET state = 'friends', answered_at = ? WHERE uuid = ?", at, existing.uuid)]
    : [insert(env.DB, "friendships", { uuid: newUuid(), asker_uuid: asker, asked_uuid: asked, state: "friends", created_at: at, answered_at: at })];
}

// A request's own line in the asked one's inbox, taken out once it no
// longer waits for them there.
function requestGone(env: Env, asker: string, asked: string): D1PreparedStatement {
  return statement(env.DB, "DELETE FROM notifications WHERE user_uuid = ? AND actor_uuid = ? AND kind = 'friend_request'", asked, asker);
}

// The papers two users both keep on public shelves: how someone asked
// can tell who is asking, from nothing either of them hid.
async function commonPapers(env: Env, a: string, b: string): Promise<{ sha256: string; title: string }[]> {
  return all<{ sha256: string; title: string }>(env.DB,
    `SELECT p.sha256, p.title FROM papers p
     WHERE ${onPublicShelf("?", "p.sha256")} AND ${onPublicShelf("?", "p.sha256")} ORDER BY p.created_at DESC, p.sha256 LIMIT 20`, a, b);
}

// Those who asked this user and still wait for an answer.
export async function requestsFor(env: Env, me: User) {
  const rows = await all<Row>(env.DB,
    `SELECT f.created_at AS asked_at, ${PERSON} FROM friendships f JOIN users u ON u.uuid = f.asker_uuid AND u.deleted_at IS NULL
     WHERE f.asked_uuid = ? AND f.state = 'asked' ORDER BY f.created_at DESC, f.uuid`, me.uuid);
  return Promise.all(rows.map(async (r) => ({ user: userPublic(r), asked_at: r.asked_at, common: await commonPapers(env, me.uuid, String(r.uuid)) })));
}

// Everything a user's own pages need to know of their friends: who they
// are, who waits for an answer, and whom they asked. Theirs alone: nobody else is shown the list or
// its length.
async function friendsOut(env: Env, me: User) {
  const [friends, sent, requests] = await Promise.all([
    all<Row>(env.DB,
      `SELECT f.answered_at AS since, ${PERSON} FROM friendships f
       JOIN users u ON u.uuid = CASE WHEN f.asker_uuid = ? THEN f.asked_uuid ELSE f.asker_uuid END AND u.deleted_at IS NULL
       WHERE f.state = 'friends' AND (f.asker_uuid = ? OR f.asked_uuid = ?) ORDER BY lower(u.display_name), u.uuid`, me.uuid, me.uuid, me.uuid),
    // A declined request reads Requested to its asker for good.
    all<{ asked_uuid: string }>(env.DB, "SELECT asked_uuid FROM friendships WHERE asker_uuid = ? AND state IN ('asked', 'declined')", me.uuid),
    requestsFor(env, me),
  ]);
  return {
    friends: friends.map((f) => ({ user: userPublic(f), since: f.since })),
    requests,
    sent: sent.map((s) => s.asked_uuid),
  };
}

export function friendRoutes(router: Router) {
  router.on("GET", "/api/friends", async ({ request, env }) => {
    return json(await friendsOut(env, await currentUser(request, env)));
  });

  // People to ask: anyone in Papol who lets themselves be found (on
  // unless they turned it off) whose name has the words asked for in it, or whose address is the one asked for, as a project's keeper finds
  // someone to add. An address nobody chose to show is matched whole.
  router.on("GET", "/api/friends/people", async ({ request, env, url }) => {
    const me = await currentUser(request, env);
    const asked = (url.searchParams.get("q") ?? "").trim().replace(/\s+/g, " ").toLowerCase();
    if (asked.length < 2) return json([]);
    const like = `%${asked.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const people = await all<Row>(env.DB,
      `SELECT ${PERSON} FROM users u
       WHERE u.deleted_at IS NULL AND u.findable = 1 AND u.uuid != ?
         AND (lower(u.display_name) LIKE ? ESCAPE '\\' OR lower(u.email) = ? OR (u.email_public = 1 AND lower(u.email) LIKE ? ESCAPE '\\'))
       ORDER BY lower(u.email) = ? DESC, lower(u.display_name), u.uuid LIMIT 8`,
      me.uuid, like, asked, like, asked);
    return json(people.map(userPublic));
  });

  // Asking someone to be friends. Asking someone who already asked is
  // accepting them, and an admin's asking is accepted as it is made.
  router.on("POST", "/api/friends/:uuid", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const them = await liveUser(env, params.uuid);
    if (them.uuid === me.uuid) refuse(400, "You cannot be your own friend");
    const existing = await between(env, me.uuid, them.uuid);
    const at = now();
    if (existing && existing.asker_uuid === me.uuid) {
      // Asked already. A request that was declined and taken back stands
      // declined again, and says nothing new to them.
      if (existing.state === "dropped") await statement(env.DB, "UPDATE friendships SET state = 'declined' WHERE uuid = ?", existing.uuid).run();
    } else if (existing && existing.state !== "friends" && existing.state !== "dropped") {
      await batch(env.DB, [
        ...befriend(env, existing, them.uuid, me.uuid, at),
        requestGone(env, them.uuid, me.uuid),
        notice(env, them.uuid, `${me.display_name} accepted your friend request.`, "friend_accepted", me, `/u/${me.uuid}`, at),
      ]);
    } else if (me.is_admin && (!existing || existing.state === "dropped")) {
      // An admin's request needs no answer: they are friends at once, and
      // the one asked is told so, and can end it from the admin's nook.
      await batch(env.DB, [
        ...(existing ? [statement(env.DB, "DELETE FROM friendships WHERE uuid = ?", existing.uuid)] : []),
        ...befriend(env, null, me.uuid, them.uuid, at),
        notice(env, them.uuid, `${me.display_name} added you as a friend.`, "friend_added", me, `/u/${me.uuid}`, at),
      ]);
    } else if (!existing || existing.state === "dropped") {
      const site = (await siteUrl(env)).replace(/\/$/, "");
      const mail = queueEmail(env.DB, "friend_request", them, `${me.display_name} asks to be friends on Papol`,
        [`${me.display_name}${me.affiliation ? ` (${me.affiliation})` : ""} asks to be friends on Papol.`, "",
          `Respond in your inbox: ${site}/inbox`, "", "— Papol"].join("\n"));
      await batch(env.DB, [
        ...(existing ? [statement(env.DB, "DELETE FROM friendships WHERE uuid = ?", existing.uuid)] : []),
        insert(env.DB, "friendships", { uuid: newUuid(), asker_uuid: me.uuid, asked_uuid: them.uuid, state: "asked", created_at: at, answered_at: null }),
        notice(env, them.uuid, `${me.display_name} asks to be friends.`, "friend_request", me, `/u/${me.uuid}`, at),
        ...(mail ? [mail.statement] : []),
      ]);
      if (mail) await wake(env, mail.wake);
    }
    return json(await friendsOut(env, me));
  });

  router.on("POST", "/api/friends/:uuid/accept", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const them = await liveUser(env, params.uuid);
    const existing = await between(env, me.uuid, them.uuid);
    if (!existing || existing.asked_uuid !== me.uuid || existing.state === "dropped") refuse(404, "They have not asked to be friends");
    if (existing!.state !== "friends") {
      const at = now();
      await batch(env.DB, [
        ...befriend(env, existing, them.uuid, me.uuid, at),
        requestGone(env, them.uuid, me.uuid),
        notice(env, them.uuid, `${me.display_name} accepted your friend request.`, "friend_accepted", me, `/u/${me.uuid}`, at),
      ]);
    }
    return json(await friendsOut(env, me));
  });

  // Not now. Nothing is said to the asker, then or ever.
  router.on("POST", "/api/friends/:uuid/decline", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const them = await liveUser(env, params.uuid);
    const existing = await between(env, me.uuid, them.uuid);
    if (!existing || existing.asked_uuid !== me.uuid || existing.state !== "asked") refuse(404, "They have not asked to be friends");
    await batch(env.DB, [
      statement(env.DB, "UPDATE friendships SET state = 'declined', answered_at = ? WHERE uuid = ?", now(), existing!.uuid),
      requestGone(env, them.uuid, me.uuid),
    ]);
    return json(await friendsOut(env, me));
  });

  // Ending a friendship, or taking a request back. Nobody is told.
  router.on("DELETE", "/api/friends/:uuid", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    if (!UUID.test(params.uuid)) refuse(404, "User not found");
    const existing = await between(env, me.uuid, params.uuid.toLowerCase());
    if (existing?.state === "friends") {
      await statement(env.DB, "DELETE FROM friendships WHERE uuid = ?", existing.uuid).run();
    } else if (existing && existing.asker_uuid === me.uuid && existing.state === "asked") {
      await batch(env.DB, [statement(env.DB, "DELETE FROM friendships WHERE uuid = ?", existing.uuid), requestGone(env, me.uuid, existing.asked_uuid)]);
    } else if (existing && existing.asker_uuid === me.uuid && existing.state === "declined") {
      await statement(env.DB, "UPDATE friendships SET state = 'dropped' WHERE uuid = ?", existing.uuid).run();
    }
    return json(await friendsOut(env, me));
  });

  // Asking a project's keeper to be let in. Once per project: asking
  // again tells the keeper nothing new.
  router.on("POST", "/api/projects/:uuid/ask", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const project = await liveProject(env, params.uuid);
    if (await one(env.DB, "SELECT 1 FROM project_members WHERE project_uuid = ? AND user_uuid = ?", project.uuid, me.uuid)) refuse(400, "You are in this project already");
    if (!(await one(env.DB, "SELECT 1 FROM project_asks WHERE project_uuid = ? AND user_uuid = ?", project.uuid, me.uuid))) {
      const at = now();
      const keepers = await all<{ user_uuid: string }>(env.DB, "SELECT user_uuid FROM project_members WHERE project_uuid = ? AND is_keeper = 1", project.uuid);
      await batch(env.DB, [
        insert(env.DB, "project_asks", { uuid: newUuid(), project_uuid: project.uuid, user_uuid: me.uuid, created_at: at }),
        ...keepers.map((k) => notice(env, k.user_uuid, `${me.display_name} asks to join ${project.name}.`, "project_ask", me, `/project/${project.uuid}`, at)),
      ]);
    }
    return json({ asked: true });
  });
}
