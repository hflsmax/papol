// Leaving. The row stays as a tombstone with the person scrubbed out of
// it, because a seminar they started and the messages they left in it
// point at it, and those belong to the users who were there too. What
// was private goes; what was said to others stays, under "A former user".

import { type User } from "../auth";
import { cohortUserUuids } from "../cohorts";
import { all, now, one, statement, type Row } from "../db";
import { boardFileKey, UPLOADS } from "../files";
import { notify, saveRoom, type Room } from "../routes/rooms";

// What a closed account is called wherever it still shows.
export const FORMER_USER = "A former user";

// No password can produce this: verifyPassword wants a "salt$digest",
// and this has no "$". A tombstone cannot be signed into, ever.
export const UNUSABLE_PASSWORD = "closed-account-no-password";

// Give away the seminars this user was hosting. A seminar without a host
// is stuck: hosting can only be claimed while a seminar is still open,
// so a planning or scheduled one whose host vanished could never be
// picked up again. The successor is chosen the way a departing host is
// made to choose one — a cohort member who displays the paper — and,
// among those, whoever joined earliest. If nobody can, the seminar goes
// back to open, the state it was in before anyone led it. A finished
// seminar is left alone: who ran it is part of the record.
async function handOnSeminars(env: Env, userUuid: string): Promise<{ statements: D1PreparedStatement[]; handed: number; reopened: number }> {
  const statements: D1PreparedStatement[] = [];
  let handed = 0, reopened = 0;
  for (const room of await all<Room & { title: string }>(env.DB,
      "SELECT r.*, p.title FROM rooms r JOIN papers p ON p.sha256 = r.paper_sha256 WHERE r.leader_uuid = ? AND r.status != 'finished'", userUuid)) {
    const cohort = (await all<{ user_uuid: string }>(env.DB,
      "SELECT user_uuid FROM room_participants WHERE room_uuid = ? AND user_uuid != ? ORDER BY created_at, uuid", room.uuid, userUuid)).map((p) => p.user_uuid);
    const allowed = await cohortUserUuids(env.DB, room.paper_sha256, true);
    const successor = cohort.find((uuid) => allowed.has(uuid));
    if (successor) {
      room.leader_uuid = successor;
      handed++;
      statements.push(saveRoom(env, room), ...notify(env, [successor], room, `The leader of the seminar on “${room.title}” has closed their account, so it is yours to lead now.`));
    } else {
      room.leader_uuid = null;
      room.status = "open";
      reopened++;
      statements.push(saveRoom(env, room), ...notify(env, cohort, room, `The leader of the seminar on “${room.title}” has closed their account. It is open again for someone to lead.`));
    }
  }
  return { statements, handed, reopened };
}

const KEY = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

// The files the user's cards named, with the digest each is stored under.
// Read before the rows go, since afterwards nothing says what they were.
async function boardFiles(env: Env, boardUuids: string[]): Promise<{ file_path: string; sha256: string | null }[]> {
  if (!boardUuids.length) return [];
  return all<{ file_path: string; sha256: string | null }>(env.DB,
    `SELECT DISTINCT file_path, sha256 FROM board_items WHERE file_path IS NOT NULL AND board_uuid IN (${boardUuids.map(() => "?").join(",")})`, ...boardUuids);
}

// Close the account: one batch that deletes what was private, signs the
// user out of everywhere, hands on their seminars and scrubs the row;
// then the files nothing points at any more.
export async function closeAccount(env: Env, user: User): Promise<Record<string, number>> {
  const db = env.DB;
  const boardUuids = (await all<{ uuid: string }>(db, "SELECT uuid FROM boards WHERE user_uuid = ?", user.uuid)).map((b) => b.uuid);
  const inBoards = boardUuids.length ? `board_uuid IN (${boardUuids.map(() => "?").join(",")})` : "0";
  const files = await boardFiles(env, boardUuids);
  const seminars = await handOnSeminars(env, user.uuid);

  // Private, and theirs alone; then out of the cohorts, since someone who
  // has closed their account is not going to turn up; then signed out and
  // forgotten by the replicas; then the row itself.
  const counted: [string, D1PreparedStatement][] = [
    ["annotations", statement(db, "DELETE FROM annotations WHERE user_uuid = ?", user.uuid)],
    ["copy_tags", statement(db, "DELETE FROM copy_tags WHERE user_uuid = ?", user.uuid)],
    ["papers_in_nook", statement(db, "DELETE FROM copies WHERE user_uuid = ?", user.uuid)],
    ["tags", statement(db, "DELETE FROM tags WHERE user_uuid = ?", user.uuid)],
    ["board_items", statement(db, `DELETE FROM board_items WHERE ${inBoards}`, ...boardUuids)],
    ["board_groups", statement(db, `DELETE FROM board_groups WHERE ${inBoards}`, ...boardUuids)],
    ["boards", statement(db, "DELETE FROM boards WHERE user_uuid = ?", user.uuid)],
    ["shelves", statement(db, "DELETE FROM shelves WHERE user_uuid = ?", user.uuid)],
    ["notifications", statement(db, "DELETE FROM notifications WHERE user_uuid = ?", user.uuid)],
    ["admin_message_deliveries", statement(db, "DELETE FROM admin_message_deliveries WHERE user_uuid = ?", user.uuid)],
    ["availabilities", statement(db, "DELETE FROM room_availabilities WHERE user_uuid = ?", user.uuid)],
    ["seminars_left", statement(db, "DELETE FROM room_participants WHERE user_uuid = ?", user.uuid)],
    ["sessions", statement(db, "DELETE FROM auth_tokens WHERE user_uuid = ?", user.uuid)],
    ["sync_changes", statement(db, "DELETE FROM _server_change_log WHERE user_uuid = ?", user.uuid)],
    ["sync_replays", statement(db, "DELETE FROM applied_mutations WHERE user_uuid = ?", user.uuid)],
    ["sync_clients", statement(db, "DELETE FROM _server_clients WHERE user_uuid = ?", user.uuid)],
  ];
  const avatar = user.avatar_path;
  // The email has to stay unique and must not be an address anyone could
  // reach or re-register into; .invalid is reserved for exactly this.
  const scrub = statement(db,
    "UPDATE users SET email = ?, display_name = ?, affiliation = NULL, avatar_path = NULL, email_public = 0, is_admin = 0, password_hash = ?, deleted_at = ? WHERE uuid = ?",
    `deleted-${user.uuid}@papol.invalid`, FORMER_USER, UNUSABLE_PASSWORD, now(), user.uuid);
  const results = await db.batch([...counted.map(([, s]) => s), ...seminars.statements, scrub]);

  const removed: Record<string, number> = {};
  counted.forEach(([name], i) => { removed[name] = results[i].meta.changes ?? 0; });
  removed.sync_history = removed.sync_changes + removed.sync_replays + removed.sync_clients;
  removed.seminars_handed_on = seminars.handed;
  removed.seminars_reopened = seminars.reopened;
  // What they said to other users stays where they said it. PDFs they
  // uploaded stay too: a paper is nobody's.
  removed.messages_kept = (await all<Row>(db, "SELECT 1 FROM room_messages WHERE user_uuid = ?", user.uuid)).length;
  removed.pdfs_kept = (await all<Row>(db, "SELECT 1 FROM papers WHERE uploaded_by = ?", user.uuid)).length;

  // Only once the row is certainly scrubbed, so a failed write never
  // leaves an account pointing at a picture that is not there. A board
  // file is named by its bytes, so another user's card — or a card of
  // theirs that was let go and may yet be restored — can name the same
  // object: it goes only when no card at all names its digest any more.
  if (avatar && KEY.test(avatar)) await env.FILES.delete(`${UPLOADS}${avatar}`);
  removed.board_files = 0;
  for (const file of files) {
    if (!KEY.test(file.file_path)) continue;
    if (file.sha256 && await one(db, "SELECT 1 FROM board_items WHERE sha256 = ? LIMIT 1", file.sha256)) continue;
    await env.FILES.delete(boardFileKey(file.file_path));
    removed.board_files++;
  }
  return removed;
}
