// A paper: what holds for everyone, and what one viewer keeps of it.
//
// A paper is one thing; what each user keeps of it is a copy. Nobody
// owns the paper, so nothing here asks whose it is. A paper's name in a
// URL is the first half of its digest — the same size as the UUID every
// other row goes by — written by shared/paperName.js and read here.

import { type User } from "../auth";
import { all, batch, newUuid, now, one, type Row } from "../db";
import { refuse } from "../http";
import { userPublic } from "../routes/boards";
import { uploadUrl } from "../files";
import { writeSynced } from "../sync/write";
import { displayedCopies } from "./list";
import { NEW_COPY_VISIBILITY, visibilityOut } from "./visibility";
import { liveReadingLink } from "./sharables";

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

// The user's copy of a paper kept in their nook. A copy that is not kept
// is one they only read or wrote on (holdPaper): it is theirs, and
// nothing that asks about the nook counts it.
export async function copyOf(db: D1Database, paperSha256: string, user: User): Promise<Copy | null> {
  return one<Copy>(db, "SELECT * FROM copies WHERE paper_sha256 = ? AND user_uuid = ? AND deleted_at IS NULL AND kept", paperSha256, user.uuid);
}

// Whether the user took the paper out of their nook: their copy is
// there, removed.
export async function tookOut(db: D1Database, paperSha256: string, user: User): Promise<boolean> {
  return Boolean(await one(db, "SELECT 1 FROM copies WHERE paper_sha256 = ? AND user_uuid = ? AND deleted_at IS NOT NULL", paperSha256, user.uuid));
}

// Whether keeping this copy is the paper's first time in the nook: it
// was held, not kept, until now. Then the copy is added now, whenever it
// began. Its date is what the nook lists it by and what a friend's Lounge
// reads as news, and when its user first read the paper is nobody's to
// see (US-9.14).
export function joinsNook(copy: Row): boolean {
  return !copy.kept && !copy.deleted_at;
}

// Hold a paper for a user who read it or wrote on it without having it
// in their nook: a copy that is not kept, on no shelf. It is what their
// Passing list is read from (routes/nook.ts), and it is the same copy
// their nook would keep: adding the paper later keeps this row and gives
// it a shelf. A paper they already keep, or took out, is left as it is.
export async function holdPaper(db: D1Database, user: User, paperSha256: string): Promise<void> {
  if (await one(db, "SELECT 1 FROM copies WHERE paper_sha256 = ? AND user_uuid = ?", paperSha256, user.uuid)) return;
  const at = now();
  const copy: Copy = { uuid: newUuid(), paper_sha256: paperSha256, user_uuid: user.uuid, shelf_uuid: null, summary: null, thought: null,
    is_author: 0, rating_expertise: null, rating_reading: null, rating_liking: null, ...NEW_COPY_VISIBILITY, pinned: 0, kept: 0,
    created_at: at, updated_at: at, revision: 0, deleted_at: null };
  try {
    await batch(db, await writeSynced(db, "copies", copy, user.uuid, true));
  } catch (error) {
    // Two requests can find no copy at once (a span and an anchor from
    // the same page). One copy per user and paper is the schema's rule,
    // so the second insert is refused; the copy it wanted is there.
    if (!(await one(db, "SELECT 1 FROM copies WHERE paper_sha256 = ? AND user_uuid = ?", paperSha256, user.uuid))) throw error;
  }
}

export async function requireCopy(db: D1Database, paperSha256: string, user: User): Promise<Copy> {
  return (await copyOf(db, paperSha256, user)) ?? refuse(403, "Add this paper to your nook first");
}

// Where a paper lands when nothing says otherwise: the shelf marked
// default, or the first one.
export async function defaultShelf(db: D1Database, user: User): Promise<Row | null> {
  return one<Row>(db, "SELECT * FROM shelves WHERE user_uuid = ? AND deleted_at IS NULL ORDER BY is_default DESC, position LIMIT 1", user.uuid);
}

// Take a paper into the user's nook: a copy of the one canonical paper
// on their default shelf. One copy per user: a paper added back after
// being removed, or only read until now, keeps that copy rather than
// storing a second. One
// road, however the paper was found — the Lounge, a nook, a link — so where it
// lands does not depend on how it was found. The one exception names its
// shelf: the paper a new user starts with (routes/auth.ts).
export async function keepPaper(db: D1Database, user: User, paperSha256: string, onShelf: Row | null = null): Promise<Copy> {
  if (await copyOf(db, paperSha256, user)) refuse(400, "This paper is already in your nook");
  const shelf = onShelf ?? await defaultShelf(db, user);
  const removed = await one<Copy>(db, "SELECT * FROM copies WHERE paper_sha256 = ? AND user_uuid = ?", paperSha256, user.uuid);
  const at = now();
  const copy: Copy = removed
    ? { ...removed, deleted_at: null, kept: 1, shelf_uuid: shelf?.uuid as string ?? null, ...(joinsNook(removed) ? { created_at: at } : {}) }
    : { uuid: newUuid(), paper_sha256: paperSha256, user_uuid: user.uuid, shelf_uuid: shelf?.uuid as string ?? null, summary: null, thought: null,
        is_author: 0, rating_expertise: null, rating_reading: null, rating_liking: null, ...NEW_COPY_VISIBILITY, pinned: 0, kept: 1,
        created_at: at, updated_at: at, revision: 0, deleted_at: null };
  await batch(db, await writeSynced(db, "copies", copy, user.uuid, !removed));
  return copy;
}

// One row shape covers anchors, ink and clips: they are three ways of
// marking one page, and what differs is geometry, which lives in `body`.
export function annotationOut(row: Row) {
  return {
    uuid: row.uuid, kind: row.kind, page: row.page ?? null, group_uuid: row.group_uuid ?? null,
    body: JSON.parse((row.body as string) || "{}"), created_at: row.created_at,
  };
}

// The canonical paper, merged with the viewer's own copy — summary,
// ratings, display, anchors — when they have one. `file_url` is
// where the PDF is fetched from, beside the `file_path` that names it:
// the bucket's own address when it has one, so the viewer reads the
// bytes from there and never through the Worker.
export async function paperDetail(env: Env, paper: Paper, viewer: User) {
  const db = env.DB;
  const copy = await copyOf(db, paper.sha256, viewer);
  const detail: Row = {
    doi: paper.doi, title: paper.title, authors: paper.authors, journal: paper.journal, year: paper.year,
    file_path: paper.file_path, file_url: uploadUrl(env, paper.file_path), sha256: paper.sha256, created_at: paper.created_at,
    summary: null, thought: null, is_public: null, is_author: null,
    rating_expertise: null, rating_reading: null, rating_liking: null,
    thought_public: null, ratings_public: null, summary_public: null, tags_public: null,
    // Whether the viewer pinned their copy to the top of their nook.
    pinned: null,
    // Whether the viewer's digs on this paper are shown to their friends
    // and their projects (writingShown): on a public shelf, or on no
    // shelf of theirs at all; not once they took the paper out.
    digs_shown: !copy && !(await tookOut(db, paper.sha256, viewer)),
    anchors: [], also_read_by: [], tags: [], shelf_uuid: null, copy_uuid: null, sharable_uuid: null,
  };
  if (copy) {
    const shelf = copy.shelf_uuid ? await one<{ is_public: number }>(db, "SELECT is_public FROM shelves WHERE uuid = ?", copy.shelf_uuid) : null;
    Object.assign(detail, {
      shelf_uuid: copy.shelf_uuid, copy_uuid: copy.uuid, summary: copy.summary, thought: copy.thought,
      is_public: Boolean(shelf?.is_public), digs_shown: Boolean(shelf?.is_public), is_author: Boolean(copy.is_author),
      rating_expertise: copy.rating_expertise, rating_reading: copy.rating_reading, rating_liking: copy.rating_liking,
      ...visibilityOut(copy), pinned: Boolean(copy.pinned),
      tags: await all(db, `SELECT t.uuid, t.name FROM copy_tags l JOIN tags t ON t.uuid = l.tag_uuid
        WHERE l.copy_uuid = ? AND l.deleted_at IS NULL AND t.deleted_at IS NULL ORDER BY lower(t.name)`, copy.uuid),
      anchors: (await all<Row>(db, `SELECT * FROM annotations WHERE paper_sha256 = ? AND user_uuid = ? AND kind = 'anchor' AND deleted_at IS NULL
        ORDER BY created_at, uuid`, paper.sha256, viewer.uuid)).map(annotationOut),
    });
    // The link this user already has out on this paper, so their share
    // menu opens showing it rather than offering to make a second one.
    // Only ever a link carrying their annotations: the paper's own link is
    // nobody's, and telling them one exists would make it sound like
    // something of theirs is out.
    detail.sharable_uuid = (await liveReadingLink(db, viewer.uuid, paper.sha256))?.uuid ?? null;
  }
  detail.also_read_by = (await displayedCopies(db, [paper.sha256])).get(paper.sha256) ?? [];
  return detail;
}
