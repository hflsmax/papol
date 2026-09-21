// A synchronized row as every replica stores it.
//
// The row's columns minus the ones that never leave the service, booleans
// as booleans, timestamps as the ISO text they already are. This is what
// a push answers with, what the change log keeps, and what a snapshot
// lists — one serialization, so the three can never disagree.

import { columns, type Row } from "../db";
import { keyColumn, serverColumns } from "./registry";

export async function rowSnapshot(db: D1Database, table: string, row: Row): Promise<Row> {
  const skipped = serverColumns(table);
  const snapshot: Row = {};
  for (const column of await columns(db, table)) {
    if (skipped.has(column.name)) continue;
    const value = row[column.name];
    snapshot[column.name] = column.boolean && value !== null && value !== undefined ? Boolean(value) : (value ?? null);
  }
  return snapshot;
}

export function rowKey(table: string, row: Row): string {
  return String(row[keyColumn(table)]);
}
