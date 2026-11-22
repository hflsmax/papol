// The Lounge: what the people a user chose are reading, and what
// they make of it, a paper to a row.
//
// Nothing is kept for it. The room is read off what is already there: a
// copy put on a public shelf, its thought and ratings (and when they last
// changed, copy_news), a dig and the posts in it, a board, a project
// joined, a friendship made. So nothing private can make news, and taking
// something private again takes its line out: every line is asked of the
// same shelf and the same field that shows it anywhere else.
//
// Two views. Friends is the reader's friends. Everyone is every user, of
// whom only what anyone signed in may see; a friend's digs and reading
// stay a friend's in either view. The room holds four weeks and ends.

import { currentUser, type User } from "../auth";
import { all, statement, type Row } from "../db";
import { json, type Router } from "../http";
import { shownFields } from "../papers/visibility";
import { userPublic } from "./boards";
import { friendsOf, friendSees, PERSON, requestsFor, userLiteral } from "./friends";
import { excerpt, onPublicShelf } from "./projects";

const DAY = 24 * 60 * 60 * 1000;
const WEEKS = 4;
// How many papers one user adds in a day before they are one line.
const BATCH = 6;
const ROWS = 150;

interface Line {
  user: unknown;
  did: "added" | "thought" | "rated" | "dug" | "posted" | "reading";
  at: string;
  words?: string | null;
  ratings?: { expertise: number | null; reading: number | null; liking: number | null } | null;
  dig?: { uuid: string; page: number | null; on: string | null; owner: unknown; post_count?: number };
}

const PUBLIC_SHELF = "JOIN shelves s ON s.uuid = c.shelf_uuid AND s.is_public = 1 AND s.deleted_at IS NULL";

function ratingsOf(shown: ReturnType<typeof shownFields>) {
  if (shown.rating_expertise == null && shown.rating_reading == null && shown.rating_liking == null) return null;
  return { expertise: shown.rating_expertise, reading: shown.rating_reading, liking: shown.rating_liking };
}

// Whether anything in the room is new to this user: someone waiting for
// an answer, or something a friend did since they last opened it.
async function hasNews(env: Env, me: User): Promise<{ news: boolean; requests: number }> {
  const mine = userLiteral(me.uuid);
  const seen = me.room_seen_at as string | null ?? "9999";
  const row = await statement(env.DB,
    `SELECT
       (SELECT count(*) FROM friendships f JOIN users u ON u.uuid = f.asker_uuid AND u.deleted_at IS NULL WHERE f.asked_uuid = ${mine} AND f.state = 'asked') AS requests,
       EXISTS (SELECT 1 FROM copies c ${PUBLIC_SHELF} WHERE c.deleted_at IS NULL AND c.created_at > ?1 AND c.user_uuid IN ${friendsOf(mine)}) AS kept,
       EXISTS (SELECT 1 FROM digs d WHERE d.created_at > ?1 AND ${friendSees(mine)}) AS dug,
       EXISTS (SELECT 1 FROM dig_posts dp JOIN digs d ON d.uuid = dp.dig_uuid
         WHERE dp.created_at > ?1 AND dp.user_uuid != ${mine} AND d.project_uuid IS NULL AND (d.user_uuid = ${mine} OR ${friendSees(mine)})) AS posted`,
    seen).first<{ requests: number; kept: number; dug: number; posted: number }>();
  return { news: Boolean(row && (row.requests || row.kept || row.dug || row.posted)), requests: row?.requests ?? 0 };
}

// The papers the people in view keep most, the reader's own left out:
// what to read next, where the room's first order says what happened.
async function mostRead(env: Env, me: User, people: string) {
  const mine = userLiteral(me.uuid);
  const top = await all<{ paper_sha256: string }>(env.DB,
    `SELECT c.paper_sha256 FROM copies c ${PUBLIC_SHELF}
     WHERE c.deleted_at IS NULL AND c.user_uuid IN ${people}
       AND NOT EXISTS (SELECT 1 FROM copies mc WHERE mc.user_uuid = ${mine} AND mc.paper_sha256 = c.paper_sha256 AND mc.deleted_at IS NULL)
     GROUP BY c.paper_sha256 ORDER BY count(*) DESC, max(c.created_at) DESC, c.paper_sha256 LIMIT 40`);
  if (!top.length) return [];
  const digests = top.map((t) => t.paper_sha256);
  const marks = digests.map(() => "?").join(",");
  const [papers, copies] = (await env.DB.batch<Row>([
    statement(env.DB, `SELECT sha256, title, authors, journal, year FROM papers WHERE sha256 IN (${marks})`, ...digests),
    statement(env.DB,
      `SELECT c.*, ${PERSON} FROM copies c ${PUBLIC_SHELF} JOIN users u ON u.uuid = c.user_uuid
       WHERE c.deleted_at IS NULL AND c.user_uuid IN ${people} AND c.paper_sha256 IN (${marks}) ORDER BY c.created_at DESC, c.uuid`, ...digests),
  ])).map((r) => r.results);
  const paperOf = new Map(papers.map((p) => [p.sha256 as string, p]));
  return digests.filter((d) => paperOf.has(d)).map((digest) => {
    const lines = copies.filter((c) => c.paper_sha256 === digest).map((c): Line => {
      const shown = shownFields(c);
      return { user: userPublic({ ...c, uuid: c.user_uuid }), did: "added", at: c.created_at as string, words: shown.thought, ratings: ratingsOf(shown) };
    });
    return { kind: "paper", key: digest, paper: paperOf.get(digest), in_my_nook: false, lines, at: lines[0]?.at ?? null, is_new: false };
  });
}

async function latest(env: Env, me: User, people: string, everyone: boolean) {
  const mine = userLiteral(me.uuid);
  const friends = friendsOf(mine);
  const since = new Date(Date.now() - WEEKS * 7 * DAY).toISOString();
  const week = new Date(Date.now() - 7 * DAY).toISOString();
  const seen = me.room_seen_at as string | null ?? "9999";
  const digOn = "d.uuid AS dig_uuid, d.user_uuid AS owner_uuid, d.paper_sha256, d.created_at AS dug_at, d.text, an.page AS on_page, an.kind AS on_kind";

  const [added, changed, dug, posted, reading, boards, joined, befriended] = (await env.DB.batch<Row>([
    // A paper put on a public shelf.
    statement(env.DB,
      `SELECT c.*, ${PERSON} FROM copies c ${PUBLIC_SHELF} JOIN users u ON u.uuid = c.user_uuid
       WHERE c.deleted_at IS NULL AND c.created_at > ? AND c.user_uuid IN ${people}`, since),
    // A thought written or ratings given on a copy kept from before.
    statement(env.DB,
      `SELECT c.*, n.thought_at, n.rated_at, ${PERSON} FROM copy_news n JOIN copies c ON c.uuid = n.copy_uuid ${PUBLIC_SHELF} JOIN users u ON u.uuid = c.user_uuid
       WHERE c.deleted_at IS NULL AND c.created_at <= ?1 AND (n.thought_at > ?1 OR n.rated_at > ?1) AND c.user_uuid IN ${people}`, since),
    // A friend's dig.
    statement(env.DB,
      `SELECT ${digOn}, (SELECT count(*) FROM dig_posts dp WHERE dp.dig_uuid = d.uuid) AS post_count, ${PERSON}
       FROM digs d LEFT JOIN annotations an ON an.uuid = d.annotation_uuid JOIN users u ON u.uuid = d.user_uuid
       WHERE d.created_at > ? AND ${friendSees(mine)}`, since),
    // A post in a dig the reader can see, a friend's or their own.
    statement(env.DB,
      `SELECT ${digOn}, dp.body, dp.created_at AS posted_at, ${PERSON}
       FROM dig_posts dp JOIN digs d ON d.uuid = dp.dig_uuid LEFT JOIN annotations an ON an.uuid = d.annotation_uuid JOIN users u ON u.uuid = dp.user_uuid
       WHERE dp.created_at > ? AND dp.user_uuid != ${mine} AND d.project_uuid IS NULL AND d.paper_sha256 IS NOT NULL AND (d.user_uuid = ${mine} OR ${friendSees(mine)})
       ORDER BY dp.created_at`, since),
    // What a friend who lets it be seen read this week, on a public shelf.
    // Only that they did: the day, never the hours.
    statement(env.DB,
      `SELECT a.subject AS paper_sha256, max(a.ended_at) AS last_at, ${PERSON} FROM activity a JOIN users u ON u.uuid = a.user_uuid AND u.shares_reading = 1 AND u.deleted_at IS NULL
       WHERE a.kind = 'reading' AND a.ended_at > ? AND a.user_uuid IN ${friends} AND ${onPublicShelf("a.user_uuid", "a.subject")}
       GROUP BY a.user_uuid, a.subject`, week),
    // A board put on a public shelf.
    statement(env.DB,
      `SELECT b.uuid AS board_uuid, b.name, b.description, b.created_at AS made_at, b.updated_at AS edited_at,
              (SELECT count(*) FROM board_items i WHERE i.board_uuid = b.uuid AND i.deleted_at IS NULL AND NOT i.staged) AS item_count, ${PERSON}
       FROM boards b JOIN shelves s ON s.uuid = b.shelf_uuid AND s.is_public = 1 AND s.deleted_at IS NULL JOIN users u ON u.uuid = b.user_uuid
       WHERE b.deleted_at IS NULL AND b.created_at > ? AND b.user_uuid IN ${people} AND b.uuid NOT IN (SELECT board_uuid FROM project_boards)`, since),
    // A project started or joined.
    statement(env.DB,
      `SELECT pr.uuid AS project_uuid, pr.name, pr.description, pr.created_at AS started_at, m.joined_at, m.is_keeper,
              EXISTS (SELECT 1 FROM project_members x WHERE x.project_uuid = pr.uuid AND x.user_uuid = ${mine}) AS is_member,
              EXISTS (SELECT 1 FROM project_asks x WHERE x.project_uuid = pr.uuid AND x.user_uuid = ${mine}) AS asked,
              (SELECT count(*) FROM project_members x WHERE x.project_uuid = pr.uuid) AS member_count, ${PERSON}
       FROM project_members m JOIN projects pr ON pr.uuid = m.project_uuid AND pr.deleted_at IS NULL JOIN users u ON u.uuid = m.user_uuid
       WHERE m.joined_at > ? AND m.user_uuid IN ${people} ORDER BY m.joined_at`, since),
    // A friend made.
    statement(env.DB,
      `SELECT f.answered_at, ${PERSON} FROM friendships f
       JOIN users u ON u.uuid = CASE WHEN f.asker_uuid = ${mine} THEN f.asked_uuid ELSE f.asker_uuid END AND u.deleted_at IS NULL
       WHERE f.state = 'friends' AND f.answered_at > ? AND (f.asker_uuid = ${mine} OR f.asked_uuid = ${mine})`, since),
  ])).map((r) => r.results);

  const lines = new Map<string, Line[]>();
  const say = (digest: unknown, line: Line) => lines.set(String(digest), [...(lines.get(String(digest)) ?? []), line]);
  const who = (row: Row) => userPublic(row);
  for (const c of added) {
    const shown = shownFields(c);
    say(c.paper_sha256, { user: userPublic({ ...c, uuid: c.user_uuid }), did: "added", at: c.created_at as string, words: shown.thought, ratings: ratingsOf(shown) });
  }
  for (const c of changed) {
    const shown = shownFields(c);
    const user = userPublic({ ...c, uuid: c.user_uuid });
    if (c.thought_at && (c.thought_at as string) > since && shown.thought) say(c.paper_sha256, { user, did: "thought", at: c.thought_at as string, words: shown.thought });
    const ratings = ratingsOf(shown);
    if (c.rated_at && (c.rated_at as string) > since && ratings) say(c.paper_sha256, { user, did: "rated", at: c.rated_at as string, ratings });
  }
  const owners = new Map<string, unknown>();
  for (const d of dug) {
    owners.set(String(d.owner_uuid), who(d));
    say(d.paper_sha256, {
      user: who(d), did: "dug", at: d.dug_at as string, words: excerpt(String(d.text)),
      dig: { uuid: String(d.dig_uuid), page: d.on_page as number | null, on: d.on_kind as string | null, owner: who(d), post_count: Number(d.post_count) },
    });
  }
  // The latest post of each writer in each dig.
  const lastPost = new Map<string, Row>();
  for (const p of posted) lastPost.set(`${p.dig_uuid}:${p.uuid}`, p);
  const ownerRows = await ownersOf(env, [...new Set([...lastPost.values()].map((p) => String(p.owner_uuid)))].filter((uuid) => !owners.has(uuid)));
  for (const [uuid, owner] of ownerRows) owners.set(uuid, owner);
  for (const p of lastPost.values()) {
    say(p.paper_sha256, {
      user: who(p), did: "posted", at: p.posted_at as string, words: excerpt(String(p.body)),
      dig: { uuid: String(p.dig_uuid), page: p.on_page as number | null, on: p.on_kind as string | null, owner: owners.get(String(p.owner_uuid)) ?? null },
    });
  }
  for (const r of reading) say(r.paper_sha256, { user: who(r), did: "reading", at: `${String(r.last_at).slice(0, 10)}T00:00:00.000Z` });

  const digests = [...lines.keys()];
  const marks = digests.map(() => "?").join(",");
  const [papers, kept] = digests.length ? (await env.DB.batch<Row>([
    statement(env.DB, `SELECT sha256, title, authors, journal, year FROM papers WHERE deleted_at IS NULL AND sha256 IN (${marks})`, ...digests),
    statement(env.DB, `SELECT paper_sha256 FROM copies WHERE user_uuid = ? AND deleted_at IS NULL AND paper_sha256 IN (${marks})`, me.uuid, ...digests),
  ])).map((r) => r.results) : [[], []];
  const paperOf = new Map(papers.map((p) => [p.sha256 as string, p]));
  const inNook = new Set(kept.map((k) => k.paper_sha256 as string));

  type Out = { kind: string; key: string; at: string; is_new: boolean } & Row;
  const rows: Out[] = [];

  // A user who brings in a folder is one line, not a row per paper: the
  // papers they added in a day that nobody has said anything else about.
  const lone = new Map<string, { user: unknown; papers: string[]; at: string }>();
  for (const [digest, said] of lines) {
    if (said.length !== 1 || said[0].did !== "added" || said[0].words || said[0].ratings) continue;
    const key = `${(said[0].user as { uuid: string }).uuid}:${said[0].at.slice(0, 10)}`;
    const batch = lone.get(key) ?? { user: said[0].user, papers: [], at: said[0].at };
    batch.papers.push(digest);
    if (said[0].at > batch.at) batch.at = said[0].at;
    lone.set(key, batch);
  }
  const folded = new Set<string>();
  for (const [key, batch] of lone) {
    if (batch.papers.length < BATCH) continue;
    for (const digest of batch.papers) folded.add(digest);
    rows.push({
      kind: "batch", key: `batch:${key}`, at: batch.at, is_new: batch.at > seen, user: batch.user,
      papers: batch.papers.filter((d) => paperOf.has(d)).map((d) => ({ ...paperOf.get(d), in_my_nook: inNook.has(d) })),
    });
  }
  for (const [digest, said] of lines) {
    if (folded.has(digest) || !paperOf.has(digest)) continue;
    said.sort((a, b) => b.at.localeCompare(a.at));
    rows.push({ kind: "paper", key: digest, at: said[0].at, is_new: said[0].at > seen, paper: paperOf.get(digest), in_my_nook: inNook.has(digest), lines: said });
  }
  for (const b of boards) {
    rows.push({
      kind: "board", key: `board:${b.board_uuid}`, at: b.made_at as string, is_new: (b.made_at as string) > seen,
      board: { uuid: b.board_uuid, name: b.name, description: b.description, item_count: b.item_count, updated_at: b.edited_at }, user: who(b),
    });
  }
  // A project is one row however many of the people in view joined it.
  const projects = new Map<string, Out>();
  for (const j of joined) {
    const row = projects.get(String(j.project_uuid)) ?? {
      kind: "project", key: `project:${j.project_uuid}`, at: j.joined_at as string, is_new: false,
      project: { uuid: j.project_uuid, name: j.name, description: j.description, member_count: j.member_count, is_member: Boolean(j.is_member), asked: Boolean(j.asked) },
      lines: [] as { user: unknown; did: string; at: string }[],
    };
    // Whoever was there when it began started it; the rest joined.
    (row.lines as { user: unknown; did: string; at: string }[]).push({ user: who(j), did: j.joined_at === j.started_at ? "started" : "joined", at: j.joined_at as string });
    if ((j.joined_at as string) > row.at) row.at = j.joined_at as string;
    row.is_new = row.at > seen;
    projects.set(String(j.project_uuid), row);
  }
  // In Everyone, a project the reader is in is not news to them.
  rows.push(...[...projects.values()].filter((p) => !everyone || !(p.project as { is_member: boolean }).is_member));
  for (const f of befriended) rows.push({ kind: "friend", key: `friend:${f.uuid}`, at: f.answered_at as string, is_new: (f.answered_at as string) > seen, user: who(f) });

  rows.sort((a, b) => b.at.localeCompare(a.at) || a.key.localeCompare(b.key));
  return { rows: rows.slice(0, ROWS), since };
}

async function ownersOf(env: Env, uuids: string[]): Promise<Map<string, unknown>> {
  if (!uuids.length) return new Map();
  const rows = await all<Row>(env.DB, `SELECT ${PERSON} FROM users u WHERE u.uuid IN (${uuids.map(() => "?").join(",")})`, ...uuids);
  return new Map(rows.map((u) => [u.uuid as string, userPublic(u)]));
}

export function roomRoutes(router: Router) {
  // The room: those waiting for an answer and a few people worth knowing,
  // then the rows. `view` is friends or everyone; with no friends yet it
  // is everyone, whatever was asked. `order` is latest or most.
  router.on("GET", "/api/room", async ({ request, env, url }) => {
    const me = await currentUser(request, env);
    const mine = userLiteral(me.uuid);
    const friendCount = (await statement(env.DB, `SELECT count(*) AS n FROM ${friendsOf(mine)}`).first<{ n: number }>())?.n ?? 0;
    const view = url.searchParams.get("view") === "everyone" || !friendCount ? "everyone" : "friends";
    const order = url.searchParams.get("order") === "most" ? "most" : "latest";
    const people = view === "friends" ? friendsOf(mine) : `(SELECT lu.uuid FROM users lu WHERE lu.deleted_at IS NULL AND lu.uuid != ${mine})`;
    const [requests, feed] = await Promise.all([
      requestsFor(env, me),
      order === "most" ? mostRead(env, me, people).then((rows) => ({ rows, since: null })) : latest(env, me, people, view === "everyone"),
    ]);
    return json({ view, order, friend_count: friendCount, seen_at: me.room_seen_at ?? null, requests, ...feed });
  });

  // The room was opened: what is in it now is no longer new.
  router.on("POST", "/api/room/seen", async ({ request, env }) => {
    const me = await currentUser(request, env);
    await statement(env.DB, "UPDATE users SET room_seen_at = ? WHERE uuid = ?", new Date().toISOString(), me.uuid).run();
    return new Response(null, { status: 204 });
  });

  // Whether the bar's link to the room wears the dot.
  router.on("GET", "/api/room/news", async ({ request, env }) => {
    return json(await hasNews(env, await currentUser(request, env)));
  });
}
