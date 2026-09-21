// Who is in a seminar's cohort.
//
// A seminar is about one paper, and a paper is its PDF, so a cohort is
// simply the users who keep that file. Shared by the API and the push,
// which both refuse to hide a paper its user is still discussing.

import { one } from "./db";

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
