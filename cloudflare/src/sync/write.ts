// Writing a synchronized row: versioned, stored, and logged for the
// replicas — the one way a row of a registered table changes, whether a
// route or the push is changing it.

import { columns, insert, now, one, statement, update, type Row } from "../db";
import { logChange } from "./log";
import { keyColumn } from "./registry";
import { rowSnapshot } from "./rows";

// The statements that make this row the next version of itself: its write
// and, for a row a replica holds, its change-log entry under that
// replica's user. `replica` is null for a row no replica holds (a
// project's board and what is on it, boardReplica). The row is versioned
// in place, so what the caller answers with is what was written.
export async function writeSynced(
  db: D1Database, table: string, row: Row, replica: string | null, isNew: boolean,
): Promise<D1PreparedStatement[]> {
  row.revision = Number(row.revision ?? 0) + 1;
  row.updated_at = now();
  const names = (await columns(db, table)).map((c) => c.name);
  const full: Row = {};
  for (const name of names) full[name] = row[name] ?? null;
  const key = keyColumn(table);
  const write = isNew ? insert(db, table, full) : update(db, table, key, row[key], omit(full, key));
  const news = table === "copies" && !isNew ? await copyNews(db, full) : [];
  if (replica === null) return [write, ...news];
  return [write, ...news, logChange(db, replica, table, String(row[key]), await rowSnapshot(db, table, row))];
}

const RATINGS = ["rating_expertise", "rating_reading", "rating_liking"] as const;

// When a copy's thought or ratings change, the Lounge is told when
// (copy_news): a copy keeps one time for every change to it, and moving
// it to another shelf is not news. Here because every write of a copy,
// a route's or a replica's, comes through this function.
async function copyNews(db: D1Database, copy: Row): Promise<D1PreparedStatement[]> {
  const before = await one<Row>(db, "SELECT thought, rating_expertise, rating_reading, rating_liking FROM copies WHERE uuid = ?", copy.uuid);
  if (!before) return [];
  const thought = (copy.thought ?? null) !== (before.thought ?? null) && Boolean(copy.thought);
  const rated = RATINGS.some((r) => (copy[r] ?? null) !== (before[r] ?? null) && copy[r] != null);
  if (!thought && !rated) return [];
  const at = copy.updated_at;
  return [statement(db,
    `INSERT INTO copy_news (copy_uuid, thought_at, rated_at) VALUES (?, ?, ?)
     ON CONFLICT (copy_uuid) DO UPDATE SET thought_at = coalesce(excluded.thought_at, thought_at), rated_at = coalesce(excluded.rated_at, rated_at)`,
    copy.uuid, thought ? at : null, rated ? at : null)];
}

// Whose replica holds a board, and so its groups and cards: its maker's,
// as part of their nook. A project's board is the project's, read and
// written through the service by every member, and no replica holds it.
export async function boardReplica(db: D1Database, board: { uuid: unknown; user_uuid: unknown }): Promise<string | null> {
  const inProject = await one(db, "SELECT 1 FROM project_boards WHERE board_uuid = ?", board.uuid);
  return inProject ? null : String(board.user_uuid);
}

// A paper is a dependency, not a synchronized row: versioned and written,
// never logged. Replicas learn of papers from the snapshot.
export async function writePaper(db: D1Database, row: Row, isNew: boolean): Promise<D1PreparedStatement> {
  row.revision = Number(row.revision ?? 0) + 1;
  row.updated_at = now();
  const names = (await columns(db, "papers")).map((c) => c.name);
  const full: Row = {};
  for (const name of names) full[name] = row[name] ?? null;
  return isNew ? insert(db, "papers", full) : update(db, "papers", "sha256", row.sha256, omit(full, "sha256"));
}

function omit(row: Row, key: string): Row {
  const { [key]: _, ...rest } = row;
  return rest;
}
