// A paper: what holds for everyone, and what one viewer keeps of it.
//
// A paper is one thing; what each user keeps of it is a copy. Nobody
// owns the paper, so nothing here asks whose it is. A paper's name in a
// URL is the first half of its digest — the same size as the UUID every
// other row goes by — written by shared/paperName.js and read here.

import { type User } from "../auth";
import { all, one, type Row } from "../db";
import { refuse } from "../http";
import { userPublic } from "../routes/boards";
import { displayedCopies } from "./list";

export const PAPER_NAME_LENGTH = 32;
const NAME = /^[0-9a-f]{32}$/;

export interface Paper extends Row {
  sha256: string;
  doi: string | null;
  title: string;
  authors: string | null;
  journal: string | null;
  year: number | null;
  file_path: string;
  created_at: string;
  revision: number;
  deleted_at: string | null;
}

export interface Copy extends Row {
  uuid: string;
  paper_sha256: string;
  user_uuid: string;
  shelf_uuid: string | null;
  deleted_at: string | null;
}

// The paper a name refers to, or null. One shape of name and no other.
// The stored identity is untouched by this — every row, foreign key and
// blob is still the full digest — and two papers cannot quietly share a
// name: 128 bits is enough that a clash would be a bug, so the ambiguous
// case is refused out loud instead of settled by picking one.
export async function paperByName(db: D1Database, name: string): Promise<Paper | null> {
  const wanted = (name ?? "").trim().toLowerCase();
  if (!NAME.test(wanted)) return null;
  // A prefix range straight off the primary key: no character of a digest
  // can be a wildcard.
  const matches = await all<Paper>(db, "SELECT * FROM papers WHERE sha256 >= ? AND sha256 < ? LIMIT 2", wanted, `${wanted}g`);
  if (matches.length > 1) refuse(409, "That name means more than one paper");
  return matches[0] ?? null;
}

// The paper a route was asked about. A deleted one is not a paper.
export async function paperOr404(db: D1Database, name: string): Promise<Paper> {
  const paper = await paperByName(db, name);
  if (!paper || paper.deleted_at) refuse(404, "Paper not found");
  return paper;
}

export async function copyOf(db: D1Database, paperSha256: string, user: User): Promise<Copy | null> {
  return one<Copy>(db, "SELECT * FROM copies WHERE paper_sha256 = ? AND user_uuid = ? AND deleted_at IS NULL", paperSha256, user.uuid);
}

export async function requireCopy(db: D1Database, paperSha256: string, user: User): Promise<Copy> {
  return (await copyOf(db, paperSha256, user)) ?? refuse(403, "Add this paper to your nook first");
}

// One row shape covers notes, ink and clips: they are three ways of
// marking one page, and what differs is geometry, which lives in `body`.
export function annotationOut(row: Row) {
  return {
    uuid: row.uuid, kind: row.kind, page: row.page ?? null, group_uuid: row.group_uuid ?? null,
    content: row.content ?? "", name: row.name ?? null, body: JSON.parse((row.body as string) || "{}"), created_at: row.created_at,
  };
}

// A seminar as a paper page or a nook lists it: its state, who called
// it, who hosts it, who is in the cohort.
export async function roomSummary(db: D1Database, room: Row) {
  const creator = await one<Row>(db, "SELECT * FROM users WHERE uuid = ?", room.created_by);
  const leader = room.leader_uuid ? await one<Row>(db, "SELECT * FROM users WHERE uuid = ?", room.leader_uuid) : null;
  const participants = await all<Row>(db,
    "SELECT u.* FROM room_participants p JOIN users u ON u.uuid = p.user_uuid WHERE p.room_uuid = ? ORDER BY p.created_at, p.uuid", room.uuid);
  return {
    uuid: room.uuid, status: room.status, scheduled_time: room.scheduled_time ?? null, platform: room.platform ?? null,
    style: room.style ?? null, style_desc: room.style_desc ?? null, created_at: room.created_at,
    creator: creator ? userPublic(creator) : null, leader: leader ? userPublic(leader) : null,
    participants: participants.map(userPublic),
  };
}

async function roomSummaries(db: D1Database, paperSha256: string) {
  const rooms = await all<Row>(db, "SELECT * FROM rooms WHERE paper_sha256 = ? ORDER BY created_at DESC, uuid DESC", paperSha256);
  return Promise.all(rooms.map((room) => roomSummary(db, room)));
}

// The canonical paper, merged with the viewer's own copy — summary,
// ratings, display, private notes — when they have one.
export async function paperDetail(db: D1Database, paper: Paper, viewer: User) {
  const copy = await copyOf(db, paper.sha256, viewer);
  const detail: Row = {
    doi: paper.doi, title: paper.title, authors: paper.authors, journal: paper.journal, year: paper.year,
    file_path: paper.file_path, sha256: paper.sha256, created_at: paper.created_at,
    summary: null, thought: null, is_public: null, is_author: null,
    rating_expertise: null, rating_reading: null, rating_liking: null,
    notes: [], also_read_by: [], rooms: [], tags: [], shelf_uuid: null, copy_uuid: null, sharable_uuid: null,
  };
  if (copy) {
    const shelf = copy.shelf_uuid ? await one<{ is_public: number }>(db, "SELECT is_public FROM shelves WHERE uuid = ?", copy.shelf_uuid) : null;
    Object.assign(detail, {
      shelf_uuid: copy.shelf_uuid, copy_uuid: copy.uuid, summary: copy.summary, thought: copy.thought,
      is_public: Boolean(shelf?.is_public), is_author: Boolean(copy.is_author),
      rating_expertise: copy.rating_expertise, rating_reading: copy.rating_reading, rating_liking: copy.rating_liking,
      tags: await all(db, `SELECT t.uuid, t.name FROM copy_tags l JOIN tags t ON t.uuid = l.tag_uuid
        WHERE l.copy_uuid = ? AND l.deleted_at IS NULL AND t.deleted_at IS NULL ORDER BY lower(t.name)`, copy.uuid),
      notes: (await all<Row>(db, `SELECT * FROM annotations WHERE paper_sha256 = ? AND user_uuid = ? AND kind = 'note' AND deleted_at IS NULL
        ORDER BY created_at, uuid`, paper.sha256, viewer.uuid)).map(annotationOut),
    });
    // The link this user already has out on this paper, so their share
    // menu opens showing it rather than offering to make a second one.
    // Only ever a link carrying their annotations: the paper's own link is
    // nobody's, and telling them one exists would make it sound like
    // something of theirs is out.
    const shared = await one<{ uuid: string }>(db,
      "SELECT uuid FROM sharables WHERE user_uuid = ? AND kind = 'rich' AND paper_sha256 = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1",
      viewer.uuid, paper.sha256);
    detail.sharable_uuid = shared?.uuid ?? null;
  }
  detail.also_read_by = (await displayedCopies(db, [paper.sha256])).get(paper.sha256) ?? [];
  detail.rooms = await roomSummaries(db, paper.sha256);
  return detail;
}
