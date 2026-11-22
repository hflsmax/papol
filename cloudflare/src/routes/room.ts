// The Lounge: what a user's friends keep and what they make of it, a
// paper to a row.
//
// Nothing is kept for it. The room is read off what is already there: a
// copy put on a public shelf, its thought and ratings (and when they last
// changed, copy_news), a dig and the posts in it, a board, a project
// joined, a friendship made. So nothing private can make news, and taking
// something private again takes its line out: every line is asked of the
// same shelf and the same field that shows it anywhere else.
//
// The room is made from the reader's friends and nobody else. What a
// friend reads, and for how long, is never in it. It holds everything, however old, except what a
// friend chose to stop showing after a time (their Preferences); the page shows it a part at a time.

import { currentUser, type User } from "../auth";
import { all, statement, type Row } from "../db";
import { json, type Router } from "../http";
import { shownFields } from "../papers/visibility";
import { userPublic } from "./boards";
import { friendsOf, friendSees, PERSON, userLiteral } from "./friends";
import { excerpt, onPublicShelf } from "./projects";

const DAY = 24 * 60 * 60 * 1000;

interface Line {
  user: unknown;
  did: "added" | "thought" | "rated" | "dug" | "posted";
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

// Whether anything in the room is new to this user: something a friend
// did since they last opened it. Someone asking to be friends is the
// Inbox's to say, not the room's.
async function hasNews(env: Env, me: User): Promise<{ news: boolean }> {
  // Asked of the rows themselves, so the dot is lit exactly when a row
  // in the room wears one. Before the first visit nothing is new.
  if (!me.room_seen_at) return { news: false };
  return { news: (await latest(env, me)).rows.some((row) => row.is_new) };
}

async function latest(env: Env, me: User) {
  const mine = userLiteral(me.uuid);
  const friends = friendsOf(mine);
  const people = friends;
  // Nothing is too old for the room: every time is after the empty one.
  const since = "";
  const seen = me.room_seen_at as string | null ?? "9999";
  const digOn = "d.uuid AS dig_uuid, d.user_uuid AS owner_uuid, d.paper_sha256, d.created_at AS dug_at, d.text, an.page AS on_page, an.kind AS on_kind";

  const [added, changed, dug, posted, boards, joined] = (await env.DB.batch<Row>([
    // A paper put on a public shelf.
    statement(env.DB,
      `SELECT c.*, ${PERSON} FROM copies c ${PUBLIC_SHELF} JOIN users u ON u.uuid = c.user_uuid
       WHERE c.deleted_at IS NULL AND c.created_at > ? AND c.user_uuid IN ${people}`, since),
    // A thought written or ratings given after the copy was added.
    statement(env.DB,
      `SELECT c.*, n.thought_at, n.rated_at, ${PERSON} FROM copy_news n JOIN copies c ON c.uuid = n.copy_uuid ${PUBLIC_SHELF} JOIN users u ON u.uuid = c.user_uuid
       WHERE c.deleted_at IS NULL AND (n.thought_at > ?1 OR n.rated_at > ?1) AND c.user_uuid IN ${people}`, since),
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
  ])).map((r) => r.results);

  const lines = new Map<string, Line[]>();
  // Each person says how far back their friends see what they did
  // (Preferences); left alone, all of it. Past that, a thing they did is
  // not in anyone's room.
  const spans = new Map((await all<Row>(env.DB, `SELECT uuid, lounge_days FROM users WHERE lounge_days IS NOT NULL AND uuid IN ${people}`))
    .map((u) => [String(u.uuid), new Date(Date.now() - Number(u.lounge_days) * DAY).toISOString()]));
  const shows = (user: unknown, at: string) => at > (spans.get(String((user as { uuid: unknown }).uuid)) ?? "");
  const say = (digest: unknown, line: Line) => { if (shows(line.user, line.at)) lines.set(String(digest), [...(lines.get(String(digest)) ?? []), line]); };
  const who = (row: Row) => userPublic(row);
  // What was said within a day of the adding is part of it, and the line
  // takes the later time. What was said after that is its own line, so
  // the adding does not say it a second time under an older date.
  const SOON = DAY;
  const soon = (c: Row, at: unknown) => typeof at === "string" && Date.parse(at) - Date.parse(c.created_at as string) <= SOON;
  const later = new Map(changed.map((c) => [`${c.user_uuid}:${c.paper_sha256}`, c]));
  const merged = new Set<string>();
  for (const c of added) {
    const shown = shownFields(c);
    const key = `${c.user_uuid}:${c.paper_sha256}`;
    const after = later.get(key);
    const thoughtLater = after?.thought_at && !soon(c, after.thought_at);
    const ratedLater = after?.rated_at && !soon(c, after.rated_at);
    let at = c.created_at as string;
    for (const t of [after?.thought_at, after?.rated_at]) if (soon(c, t) && (t as string) > at) at = t as string;
    if (after && !thoughtLater && !ratedLater) merged.add(key);
    say(c.paper_sha256, {
      user: userPublic({ ...c, uuid: c.user_uuid }), did: "added", at,
      words: thoughtLater ? null : shown.thought, ratings: ratedLater ? null : ratingsOf(shown),
    });
  }
  for (const c of changed) {
    if (merged.has(`${c.user_uuid}:${c.paper_sha256}`)) continue;
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

  for (const [digest, said] of lines) {
    if (!paperOf.has(digest)) continue;
    said.sort((a, b) => b.at.localeCompare(a.at));
    rows.push({ kind: "paper", key: digest, at: said[0].at, is_new: said[0].at > seen, paper: paperOf.get(digest), in_my_nook: inNook.has(digest), lines: said });
  }
  for (const b of boards) {
    if (!shows(who(b), b.made_at as string)) continue;
    rows.push({
      kind: "board", key: `board:${b.board_uuid}`, at: b.made_at as string, is_new: (b.made_at as string) > seen,
      board: { uuid: b.board_uuid, name: b.name, description: b.description, item_count: b.item_count, updated_at: b.edited_at }, user: who(b),
    });
  }
  // A project is one row however many of the people in view joined it.
  const projects = new Map<string, Out>();
  for (const j of joined) {
    if (!shows(who(j), j.joined_at as string)) continue;
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
  rows.push(...projects.values());

  rows.sort((a, b) => b.at.localeCompare(a.at) || a.key.localeCompare(b.key));
  return { rows, since };
}

async function ownersOf(env: Env, uuids: string[]): Promise<Map<string, unknown>> {
  if (!uuids.length) return new Map();
  const rows = await all<Row>(env.DB, `SELECT ${PERSON} FROM users u WHERE u.uuid IN (${uuids.map(() => "?").join(",")})`, ...uuids);
  return new Map(rows.map((u) => [u.uuid as string, userPublic(u)]));
}

export function roomRoutes(router: Router) {
  // The room: its rows, newest first.
  // It is made from the user's friends and nobody else: with no friends
  // yet it is empty.
  router.on("GET", "/api/room", async ({ request, env }) => {
    const me = await currentUser(request, env);
    const mine = userLiteral(me.uuid);
    const friendCount = (await statement(env.DB, `SELECT count(*) AS n FROM ${friendsOf(mine)}`).first<{ n: number }>())?.n ?? 0;
    const feed = await latest(env, me);
    return json({ friend_count: friendCount, seen_at: me.room_seen_at ?? null, ...feed });
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
