// People to ask: whom Papol suggests a user befriend, in the Lounge and
// in the weekly email (jobs/suggestions.ts).
//
// A suggestion is read off what both users can already see of each other
// and nothing else: a project they are both in, and papers they both keep
// on public shelves. Friends of friends are not a reason, because nobody
// is shown who another user's friends are (routes/friends.ts), and a
// suggestion made from them would say it. Nothing a user reads, and
// nothing on a private shelf, makes one.
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
import { PERSON } from "./friends";
import { onPublicShelf } from "./projects";

// How many people the Lounge is handed at once.
const SHOWN = 6;
// How many of the things two users share a suggestion names; the counts
// say the rest.
const NAMED = 2;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUBLIC_SHELF = "JOIN shelves s ON s.uuid = c.shelf_uuid AND s.is_public = 1 AND s.deleted_at IS NULL";

export interface Suggestion {
  user: ReturnType<typeof userPublic>;
  // The projects both are in and the papers both keep in the open: how
  // many, and the first few by name.
  project_count: number;
  projects: { uuid: string; name: string }[];
  paper_count: number;
  papers: { sha256: string; title: string }[];
}

// The people suggested to a user, the likeliest first: a shared project
// counts for more than a shared paper. `unmailed` leaves out whomever the
// weekly email already named to them.
export async function suggestionsFor(env: Env, userUuid: string, { limit = SHOWN, unmailed = false } = {}): Promise<Suggestion[]> {
  const people = await all<Row>(env.DB,
    `WITH mine AS (
       SELECT DISTINCT c.paper_sha256 FROM copies c ${PUBLIC_SHELF} WHERE c.user_uuid = ?1 AND c.deleted_at IS NULL
     ), paper_hits AS (
       SELECT c.user_uuid, count(DISTINCT c.paper_sha256) AS n FROM copies c ${PUBLIC_SHELF}
       JOIN mine ON mine.paper_sha256 = c.paper_sha256
       JOIN papers p ON p.sha256 = c.paper_sha256 AND p.deleted_at IS NULL
       WHERE c.deleted_at IS NULL AND c.user_uuid != ?1 GROUP BY c.user_uuid
     ), project_hits AS (
       SELECT o.user_uuid, count(DISTINCT o.project_uuid) AS n FROM project_members m
       JOIN projects pr ON pr.uuid = m.project_uuid AND pr.deleted_at IS NULL
       JOIN project_members o ON o.project_uuid = m.project_uuid AND o.user_uuid != ?1
       WHERE m.user_uuid = ?1 GROUP BY o.user_uuid
     )
     SELECT ${PERSON}, coalesce(ph.n, 0) AS paper_count, coalesce(jh.n, 0) AS project_count
     FROM users u LEFT JOIN paper_hits ph ON ph.user_uuid = u.uuid LEFT JOIN project_hits jh ON jh.user_uuid = u.uuid
     WHERE u.deleted_at IS NULL AND u.findable = 1 AND u.uuid != ?1 AND (ph.n > 0 OR jh.n > 0)
       AND NOT EXISTS (SELECT 1 FROM friendships f
         WHERE (f.asker_uuid = ?1 AND f.asked_uuid = u.uuid) OR (f.asker_uuid = u.uuid AND f.asked_uuid = ?1))
       AND NOT EXISTS (SELECT 1 FROM friend_suggestions fs
         WHERE fs.user_uuid = ?1 AND fs.suggested_uuid = u.uuid AND (fs.hidden_at IS NOT NULL${unmailed ? " OR fs.mailed_at IS NOT NULL" : ""}))
     ORDER BY 3 * coalesce(jh.n, 0) + coalesce(ph.n, 0) DESC, lower(u.display_name), u.uuid LIMIT ?2`,
    userUuid, limit);
  if (!people.length) return [];

  // What each shares with the user, by name: two statements a person, in
  // one round trip.
  const shared = (await env.DB.batch<Row>(people.flatMap((them) => [
    statement(env.DB,
      `SELECT pr.uuid, pr.name FROM projects pr
       JOIN project_members a ON a.project_uuid = pr.uuid AND a.user_uuid = ?1
       JOIN project_members b ON b.project_uuid = pr.uuid AND b.user_uuid = ?2
       WHERE pr.deleted_at IS NULL ORDER BY lower(pr.name), pr.uuid LIMIT ${NAMED}`, userUuid, them.uuid),
    statement(env.DB,
      `SELECT p.sha256, p.title FROM papers p
       WHERE p.deleted_at IS NULL AND ${onPublicShelf("?1", "p.sha256")} AND ${onPublicShelf("?2", "p.sha256")}
       ORDER BY p.created_at DESC, p.sha256 LIMIT ${NAMED}`, userUuid, them.uuid),
  ]))).map((r) => r.results);

  return people.map((them, i) => ({
    user: userPublic(them),
    project_count: Number(them.project_count),
    projects: shared[2 * i].map((p) => ({ uuid: String(p.uuid), name: String(p.name) })),
    paper_count: Number(them.paper_count),
    papers: shared[2 * i + 1].map((p) => ({ sha256: String(p.sha256), title: String(p.title) })),
  }));
}

// The page a link in the weekly email opens: small, whole, and Papol's
// own words in Papol's own type, with nothing to load. Every word in it
// is written here; nothing a user typed is put in.
function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<meta name="robots" content="noindex"><title>${title} · Papol</title><style>`
    + `:root{color-scheme:light dark}body{margin:0;padding:4rem 1.25rem;font:400 16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:Canvas;color:CanvasText}`
    + `main{max-width:30rem;margin:0 auto}h1{margin:0 0 .75rem;font-size:1.375rem;line-height:1.3}p{margin:0 0 1rem}`
    + `button{font:inherit;padding:.5rem 1rem;border:1px solid currentColor;border-radius:6px;background:CanvasText;color:Canvas;cursor:pointer}`
    + `a{color:inherit}.quiet{opacity:.7;font-size:.875rem}</style></head><body><main><h1>${title}</h1>${body}</main></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

const TOKEN = /^[0-9a-f]{64}$/;

async function holderOf(env: Env, token: string): Promise<{ uuid: string; suggestion_email: number } | null> {
  if (!TOKEN.test(token)) return null;
  return one<{ uuid: string; suggestion_email: number }>(env.DB,
    "SELECT uuid, suggestion_email FROM users WHERE unsubscribe_token = ? AND deleted_at IS NULL", token);
}

const GONE = () => page("This link no longer works",
  `<p>It may have been copied in part, or the account it belonged to is closed.</p>`
  + `<p>The weekly email is turned on and off under <strong>Preferences</strong> on <a href="/profile">your page</a>.</p>`, 404);

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

  // The link at the foot of the weekly email. Opening it only asks: mail
  // apps and scanners open every link in an email before its reader does,
  // and a link that acted on being opened would be pressed by them.
  router.on("GET", "/api/email/unsubscribe/:token", async ({ env, params }) => {
    const holder = await holderOf(env, params.token);
    if (!holder) return GONE();
    if (!holder.suggestion_email) {
      return page("These emails are already off",
        `<p>Papol will not send you the weekly email of friend suggestions.</p>`
        + `<p class="quiet">To have it again, turn it on under Preferences on <a href="/profile">your page</a>.</p>`);
    }
    return page("Stop the weekly friend suggestions?",
      `<p>Papol sends them once a week, when there is someone new to suggest. Other email, such as a friend request or a password reset, is not changed.</p>`
      + `<form method="post"><button type="submit">Stop these emails</button></form>`);
  });

  // The press on that page, and a mail app's own one-click unsubscribe
  // (RFC 8058), which posts to the same address without showing the page.
  router.on("POST", "/api/email/unsubscribe/:token", async ({ env, params }) => {
    const holder = await holderOf(env, params.token);
    if (!holder) return GONE();
    await statement(env.DB, "UPDATE users SET suggestion_email = 0 WHERE uuid = ?", holder.uuid).run();
    return page("You will get no more of these",
      `<p>Papol will not send you the weekly email of friend suggestions. The Lounge still shows them.</p>`
      + `<p class="quiet">To have the email again, turn it on under Preferences on <a href="/profile">your page</a>.</p>`);
  });
}
