// People to ask: whom Papol suggests a user befriend, in the Lounge and
// in the weekly email (jobs/suggestions.ts).
//
// Two things make a suggestion and nothing else: a project both users
// are in, and friends they have in common (a friend of a friend). Of the
// friends in common only how many is said, never who: nobody is shown
// another user's friends (routes/friends.ts), and a count gives away the
// least of them that a suggestion can.
//
// Nobody is suggested who turned being found off, who is a friend
// already, between whom and the user any request stands or once stood
// (asked, declined or taken back), or whom the user said Not interested
// to. A suggestion is not kept; friend_suggestions keeps only that no,
// and whom the weekly email already named.

import { currentUser } from "../auth";
import { all, now, one, statement, type Row } from "../db";
import { json, refuse, type Router } from "../http";
import { userPublic } from "./boards";
import { friendsOf, PERSON } from "./friends";

// How many people the Lounge is handed at once.
const SHOWN = 6;
// How many of the projects two users share a suggestion names; the count
// says the rest.
const NAMED = 2;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Suggestion {
  user: ReturnType<typeof userPublic>;
  // The projects both are in: how many, and the first few by name.
  project_count: number;
  projects: { uuid: string; name: string }[];
  // How many friends both have. Who they are is not said.
  mutual_count: number;
}

// The people suggested to a user, the likeliest first: a shared project
// counts for more than a friend in common. `unmailed` leaves out whomever
// the weekly email already named to them.
export async function suggestionsFor(env: Env, userUuid: string, { limit = SHOWN, unmailed = false } = {}): Promise<Suggestion[]> {
  const people = await all<Row>(env.DB,
    `WITH mine(uuid) AS ${friendsOf("?1")}, friend_hits AS (
       SELECT CASE WHEN f.asker_uuid = mine.uuid THEN f.asked_uuid ELSE f.asker_uuid END AS user_uuid, count(DISTINCT mine.uuid) AS n
       FROM mine JOIN friendships f ON f.state = 'friends' AND (f.asker_uuid = mine.uuid OR f.asked_uuid = mine.uuid)
       JOIN users via ON via.uuid = mine.uuid AND via.deleted_at IS NULL
       GROUP BY 1
     ), project_hits AS (
       SELECT o.user_uuid, count(DISTINCT o.project_uuid) AS n FROM project_members m
       JOIN projects pr ON pr.uuid = m.project_uuid AND pr.deleted_at IS NULL
       JOIN project_members o ON o.project_uuid = m.project_uuid AND o.user_uuid != ?1
       WHERE m.user_uuid = ?1 GROUP BY o.user_uuid
     )
     SELECT ${PERSON}, coalesce(fh.n, 0) AS mutual_count, coalesce(jh.n, 0) AS project_count
     FROM users u LEFT JOIN friend_hits fh ON fh.user_uuid = u.uuid LEFT JOIN project_hits jh ON jh.user_uuid = u.uuid
     WHERE u.deleted_at IS NULL AND u.findable = 1 AND u.uuid != ?1 AND (fh.n > 0 OR jh.n > 0)
       AND NOT EXISTS (SELECT 1 FROM friendships f
         WHERE (f.asker_uuid = ?1 AND f.asked_uuid = u.uuid) OR (f.asker_uuid = u.uuid AND f.asked_uuid = ?1))
       AND NOT EXISTS (SELECT 1 FROM friend_suggestions fs
         WHERE fs.user_uuid = ?1 AND fs.suggested_uuid = u.uuid AND (fs.hidden_at IS NOT NULL${unmailed ? " OR fs.mailed_at IS NOT NULL" : ""}))
     ORDER BY 3 * coalesce(jh.n, 0) + coalesce(fh.n, 0) DESC, lower(u.display_name), u.uuid LIMIT ?2`,
    userUuid, limit);
  if (!people.length) return [];

  // The projects each shares with the user, by name, in one round trip.
  const shared = (await env.DB.batch<Row>(people.map((them) => statement(env.DB,
    `SELECT pr.uuid, pr.name FROM projects pr
     JOIN project_members a ON a.project_uuid = pr.uuid AND a.user_uuid = ?1
     JOIN project_members b ON b.project_uuid = pr.uuid AND b.user_uuid = ?2
     WHERE pr.deleted_at IS NULL ORDER BY lower(pr.name), pr.uuid LIMIT ${NAMED}`, userUuid, them.uuid)))).map((r) => r.results);

  return people.map((them, i) => ({
    user: userPublic(them),
    project_count: Number(them.project_count),
    projects: shared[i].map((p) => ({ uuid: String(p.uuid), name: String(p.name) })),
    mutual_count: Number(them.mutual_count),
  }));
}

export function suggestionRoutes(router: Router) {
  router.on("GET", "/api/friends/suggestions", async ({ request, env }) => {
    const me = await currentUser(request, env);
    return json(await suggestionsFor(env, me.uuid));
  });

  // Not interested: they are not suggested to this user again, here or by
  // email. Nobody is told, and they can still be found and asked.
  router.on("DELETE", "/api/friends/suggestions/:uuid", async ({ request, env, params }) => {
    const me = await currentUser(request, env);
    const them = UUID.test(params.uuid) ? params.uuid.toLowerCase() : refuse(404, "User not found");
    if (them === me.uuid || !(await one(env.DB, "SELECT 1 FROM users WHERE uuid = ? AND deleted_at IS NULL", them))) refuse(404, "User not found");
    await statement(env.DB,
      `INSERT INTO friend_suggestions (user_uuid, suggested_uuid, hidden_at) VALUES (?1, ?2, ?3)
       ON CONFLICT (user_uuid, suggested_uuid) DO UPDATE SET hidden_at = coalesce(hidden_at, ?3)`, me.uuid, them, now()).run();
    return json(await suggestionsFor(env, me.uuid));
  });
}
