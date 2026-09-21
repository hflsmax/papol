// What a replica pulls, and what synchronization may stop remembering.
//
// `_server_change_log` is the incremental half of a pull: one entry per
// committed version of a synchronized row, filed under the user who will
// be sent it, in the order it was written. Its `sequence` is the pull
// cursor and only has to grow — AUTOINCREMENT, so a log emptied from the
// end never hands out a number a replica is already past.
//
// The authoritative half is the snapshot, which every reconciliation
// fetches first. The log is an optimization over that, so an entry every
// one of an account's replicas has acknowledged is one nobody will use
// again, and is let go of. `applied_mutations` likewise: the reply to a
// push is kept under the caller's own mutation UUID for as long as a
// client could still be retrying it, and no longer.

import limits from "../../../config/app_limits.json";
import { now, statement, type Row } from "../db";

const REPLAY_WINDOW_MS = limits.retention_days.replay_cache * 24 * 60 * 60 * 1000;

export function logChange(db: D1Database, userUuid: string, table: string, rowUuid: string, snapshot: Row): D1PreparedStatement {
  return statement(
    db,
    `INSERT INTO _server_change_log (user_uuid, table_name, row_uuid, revision, operation, row_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    userUuid, table, rowUuid, snapshot.revision, snapshot.deleted_at ? "delete" : "upsert",
    JSON.stringify(snapshot), now(),
  );
}

// Drop this account's change log up to what every replica has taken.
// Conservative on purpose: the lowest cursor any registered replica has
// acknowledged is the last point all of them are known to be past, and an
// account with no replica registered is left alone rather than emptied.
export function forgetAcknowledged(db: D1Database, userUuid: string): D1PreparedStatement {
  return statement(
    db,
    `DELETE FROM _server_change_log WHERE user_uuid = ?1 AND sequence <= (
       SELECT coalesce(min(acknowledged_cursor), 0) FROM _server_clients WHERE user_uuid = ?1
     )`,
    userUuid,
  );
}

// Drop replies to mutations no client can still be retrying.
export function forgetOldReplays(db: D1Database, userUuid: string): D1PreparedStatement {
  return statement(
    db,
    "DELETE FROM applied_mutations WHERE user_uuid = ? AND created_at < ?",
    userUuid, new Date(Date.now() - REPLAY_WINDOW_MS).toISOString(),
  );
}
