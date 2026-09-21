// Who is in a seminar's cohort.
//
// A seminar is about one paper, and a paper is its PDF, so a cohort is
// simply the users who keep that file. Shared by the API and the push,
// which both refuse to hide a paper its user is still discussing.

import { all, one } from "./db";

// Everyone who keeps this paper. `publicOnly` narrows it to those
// displaying it, which is who may call or host a seminar; everyone else
// is still told one was called.
export async function cohortUserUuids(db: D1Database, paperSha256: string, publicOnly = true): Promise<Set<string>> {
  const rows = await all<{ user_uuid: string }>(
    db,
    `SELECT c.user_uuid FROM copies c LEFT JOIN shelves s ON s.uuid = c.shelf_uuid
     WHERE c.paper_sha256 = ? AND c.deleted_at IS NULL ${publicOnly ? "AND s.is_public = 1" : ""}`,
    paperSha256,
  );
  return new Set(rows.map((r) => r.user_uuid));
}

// True if the user is in the cohort of a still-active seminar (anything
// but finished) on this paper.
export async function inActiveCohort(db: D1Database, userUuid: string, paperSha256: string): Promise<boolean> {
  return Boolean(await one(
    db,
    `SELECT 1 FROM room_participants p JOIN rooms r ON r.uuid = p.room_uuid
     WHERE r.paper_sha256 = ? AND r.status != 'finished' AND p.user_uuid = ? LIMIT 1`,
    paperSha256, userUuid,
  ));
}
