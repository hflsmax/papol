// One row of the Library or a nook: the paper everyone shares, the
// personal fields of one user's copy when it is their nook, and every
// copy on display. Built for a whole list at once, in a handful of
// queries, rather than a query per paper.

import { all, type Row } from "../db";
import { userPublic } from "../routes/boards";
import { shownFields } from "./visibility";

export interface UserEntry {
  user: ReturnType<typeof userPublic>;
  is_author: boolean;
  thought: string | null;
  rating_expertise: number | null;
  rating_reading: number | null;
  rating_liking: number | null;
  summary: string | null;
  tags: { uuid: string; name: string }[];
}

// The status of each paper's latest seminar, by the paper's digest.
export async function roomStatusMap(db: D1Database): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const room of await all<{ paper_sha256: string; status: string }>(db, "SELECT paper_sha256, status FROM rooms ORDER BY created_at, uuid")) {
    map.set(room.paper_sha256, room.status);
  }
  return map;
}

// Every displayed copy of these papers, with its user: the readers shown
// against a paper, which is each user's own business to be among. Of each
// copy, only what its user lets be seen.
export async function displayedCopies(db: D1Database, digests: string[]): Promise<Map<string, UserEntry[]>> {
  const shown = new Map<string, UserEntry[]>();
  if (!digests.length) return shown;
  const rows = await all<Row>(
    db,
    `SELECT c.uuid, c.paper_sha256, c.is_author, c.thought, c.rating_expertise, c.rating_reading, c.rating_liking, c.summary,
            c.thought_public, c.ratings_public, c.summary_public, c.tags_public,
            u.uuid AS user_uuid, u.display_name, u.affiliation, u.avatar_path, u.email, u.email_public
     FROM copies c JOIN shelves s ON s.uuid = c.shelf_uuid JOIN users u ON u.uuid = c.user_uuid
     WHERE c.deleted_at IS NULL AND s.is_public = 1 AND c.paper_sha256 IN (${digests.map(() => "?").join(",")})
     ORDER BY c.created_at, c.uuid`,
    ...digests,
  );
  const tags = await tagsOf(db, rows.filter((row) => row.tags_public).map((row) => row.uuid as string));
  for (const row of rows) {
    const entries = shown.get(row.paper_sha256 as string) ?? [];
    entries.push({
      user: userPublic({ uuid: row.user_uuid, display_name: row.display_name, affiliation: row.affiliation, avatar_path: row.avatar_path, email: row.email, email_public: row.email_public }),
      is_author: Boolean(row.is_author), ...shownFields(row), tags: tags.get(row.uuid as string) ?? [],
    });
    shown.set(row.paper_sha256 as string, entries);
  }
  return shown;
}

// The tags on each of these copies, by name.
async function tagsOf(db: D1Database, copyUuids: string[]): Promise<Map<string, { uuid: string; name: string }[]>> {
  const tags = new Map<string, { uuid: string; name: string }[]>();
  if (!copyUuids.length) return tags;
  const rows = await all<{ copy_uuid: string; uuid: string; name: string }>(
    db,
    `SELECT l.copy_uuid, t.uuid, t.name FROM copy_tags l JOIN tags t ON t.uuid = l.tag_uuid
     WHERE l.deleted_at IS NULL AND t.deleted_at IS NULL AND l.copy_uuid IN (${copyUuids.map(() => "?").join(",")})`,
    ...copyUuids,
  );
  for (const row of rows) tags.set(row.copy_uuid, [...(tags.get(row.copy_uuid) ?? []), { uuid: row.uuid, name: row.name }]);
  for (const list of tags.values()) list.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return tags;
}

export interface Listed {
  paper: Row;
  // The nook's own copy of it, when a nook is being listed.
  copy?: Row & { is_public: boolean };
}

// The rows, in the order given. `hidePrivate` is every list but the
// user's own nook: there a copy shows only what its user lets be seen.
export async function paperListEntries(db: D1Database, listed: Listed[], hidePrivate: boolean): Promise<Row[]> {
  const digests = [...new Set(listed.map((l) => l.paper.sha256 as string))];
  const [shown, rooms, tags] = await Promise.all([
    displayedCopies(db, digests),
    roomStatusMap(db),
    tagsOf(db, listed.map((l) => l.copy).filter((c) => c && (!hidePrivate || c.tags_public)).map((c) => c!.uuid as string)),
  ]);
  return listed.map(({ paper, copy }) => {
    const personal = copy && hidePrivate ? shownFields(copy) : copy;
    return {
      doi: paper.doi, title: paper.title, authors: paper.authors, journal: paper.journal, year: paper.year,
      file_path: paper.file_path, sha256: paper.sha256,
      created_at: copy ? copy.created_at : paper.created_at,
      summary: personal?.summary ?? null,
      thought: personal?.thought ?? null,
      is_public: copy ? copy.is_public : null,
      is_author: copy ? Boolean(copy.is_author) : null,
      rating_expertise: personal?.rating_expertise ?? null,
      rating_reading: personal?.rating_reading ?? null,
      rating_liking: personal?.rating_liking ?? null,
      room_status: rooms.get(paper.sha256 as string) ?? null,
      users: shown.get(paper.sha256 as string) ?? [],
      tags: copy ? tags.get(copy.uuid as string) ?? [] : [],
      shelf_uuid: copy?.shelf_uuid ?? null,
      copy_uuid: copy?.uuid ?? null,
    };
  });
}
