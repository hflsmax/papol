// Leaving. The row stays as a tombstone with the person scrubbed out of
// it, because what they said in a project's digs points at it, and that
// belongs to the members who were there too. What was private goes; what
// was said to others stays, under "A former user".

import { type User } from "../auth";
import { all, now, one, statement, type Row } from "../db";
import { boardFileKey, UPLOADS } from "../files";
import { handOnProjectBoards, leaveAllProjects } from "../routes/projects";

// What a closed account is called wherever it still shows.
export const FORMER_USER = "A former user";

// No password can produce this: verifyPassword wants a "salt$digest",
// and this has no "$". A tombstone cannot be signed into, ever.
export const UNUSABLE_PASSWORD = "closed-account-no-password";

const KEY = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

// The files the user's cards named, with the digest each is stored under.
// Read before the rows go, since afterwards nothing says what they were.
async function boardFiles(env: Env, boardUuids: string[]): Promise<{ file_path: string; sha256: string | null }[]> {
  if (!boardUuids.length) return [];
  return all<{ file_path: string; sha256: string | null }>(env.DB,
    `SELECT DISTINCT file_path, sha256 FROM board_items WHERE file_path IS NOT NULL AND board_uuid IN (${boardUuids.map(() => "?").join(",")})`, ...boardUuids);
}

// Close the account: one batch that deletes what was private, signs the
// user out of everywhere and scrubs the row;
// then the files nothing points at any more.
export async function closeAccount(env: Env, user: User): Promise<Record<string, number>> {
  const db = env.DB;
  // Before anything of theirs goes: a board a project goes on using is
  // the project's, so it passes to another member rather than going.
  const projectBoards = await handOnProjectBoards(env, user.uuid);
  const boardUuids = (await all<{ uuid: string }>(db, "SELECT uuid FROM boards WHERE user_uuid = ?", user.uuid)).map((b) => b.uuid);
  const inBoards = boardUuids.length ? `board_uuid IN (${boardUuids.map(() => "?").join(",")})` : "0";
  // A dig about a card on a board that goes, or an annotation of theirs,
  // goes too.
  const goneDigs = (await all<{ uuid: string }>(db,
    `SELECT uuid FROM digs WHERE board_item_uuid IN (SELECT uuid FROM board_items WHERE ${inBoards}) OR annotation_uuid IN (SELECT uuid FROM annotations WHERE user_uuid = ?)`,
    ...boardUuids, user.uuid)).map((d) => d.uuid);
  const inDigs = goneDigs.length ? goneDigs.map(() => "?").join(",") : "NULL";
  const files = await boardFiles(env, boardUuids);
  const projects = await leaveAllProjects(env, user.uuid);

  // Private, and theirs alone; then signed out and forgotten by the
  // replicas; then the row itself.
  const counted: [string, D1PreparedStatement][] = [
    ["dig_posts", statement(db, `DELETE FROM dig_posts WHERE dig_uuid IN (${inDigs})`, ...goneDigs)],
    ["digs", statement(db, `DELETE FROM digs WHERE uuid IN (${inDigs})`, ...goneDigs)],
    ["annotations", statement(db, "DELETE FROM annotations WHERE user_uuid = ?", user.uuid)],
    ["activity", statement(db, "DELETE FROM activity WHERE user_uuid = ?", user.uuid)],
    ["copy_tags", statement(db, "DELETE FROM copy_tags WHERE user_uuid = ?", user.uuid)],
    ["papers_in_nook", statement(db, "DELETE FROM copies WHERE user_uuid = ?", user.uuid)],
    ["tags", statement(db, "DELETE FROM tags WHERE user_uuid = ?", user.uuid)],
    ["project_boards", statement(db, `DELETE FROM project_boards WHERE ${inBoards}`, ...boardUuids)],
    ["board_items", statement(db, `DELETE FROM board_items WHERE ${inBoards}`, ...boardUuids)],
    ["board_groups", statement(db, `DELETE FROM board_groups WHERE ${inBoards}`, ...boardUuids)],
    ["boards", statement(db, "DELETE FROM boards WHERE user_uuid = ?", user.uuid)],
    ["shelves", statement(db, "DELETE FROM shelves WHERE user_uuid = ?", user.uuid)],
    ["notifications", statement(db, "DELETE FROM notifications WHERE user_uuid = ?", user.uuid)],
    ["admin_message_deliveries", statement(db, "DELETE FROM admin_message_deliveries WHERE user_uuid = ?", user.uuid)],
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
  const results = await db.batch([...counted.map(([, s]) => s), ...projects, scrub]);

  const removed: Record<string, number> = {};
  counted.forEach(([name], i) => { removed[name] = results[i].meta.changes ?? 0; });
  removed.sync_history = removed.sync_changes + removed.sync_replays + removed.sync_clients;
  removed.project_boards_handed_on = projectBoards;
  // PDFs they uploaded stay: a paper is nobody's.
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
