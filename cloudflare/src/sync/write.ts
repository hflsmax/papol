// Writing a synchronized row: versioned, stored, and logged for the
// replicas — the one way a row of a registered table changes, whether a
// route or the push is changing it.

import { columns, insert, now, update, type Row } from "../db";
import { logChange } from "./log";
import { keyColumn } from "./registry";
import { rowSnapshot } from "./rows";

// The statements that make this row the next version of itself: its write
// and its change-log entry. The row is versioned in place, so what the
// caller answers with is what was written.
export async function writeSynced(
  db: D1Database, table: string, row: Row, ownerUuid: string, isNew: boolean,
): Promise<D1PreparedStatement[]> {
  row.revision = Number(row.revision ?? 0) + 1;
  row.updated_at = now();
  const names = (await columns(db, table)).map((c) => c.name);
  const full: Row = {};
  for (const name of names) full[name] = row[name] ?? null;
  const key = keyColumn(table);
  const write = isNew ? insert(db, table, full) : update(db, table, key, row[key], omit(full, key));
  return [write, logChange(db, ownerUuid, table, String(row[key]), await rowSnapshot(db, table, row))];
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
