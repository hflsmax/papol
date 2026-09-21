// The one description of what synchronizes, and what each column is.
//
// schema/sync_registry.json is read by three programs: this Worker, the
// desktop replica (which compiles it in), and the tests on both sides.
// Every column of a synchronized table is exactly one of: the row's own
// bookkeeping, client-writable, server-owned (travels, but a replica may
// not change it), or a server column (never leaves the service). `owner`
// says whose a row is, as a path from the row — a column, or a parent and
// then a column — and is what files a change under the user who will be
// sent it.
//
// That the registry matches the schema is checked by a test against the
// migrated database, not at every start: the schema does not change
// between deploys.

import registryFile from "../../../schema/sync_registry.json";

export interface TableRule {
  owner: string | null;
  create_only?: boolean;
  client_writable?: string[];
  server_owned?: string[];
  server_columns?: string[];
}

export const registry = registryFile as { schema_version: number; tables: Record<string, TableRule> };

export const TABLES = Object.keys(registry.tables);

// The order rows are written in, so a parent exists before its child, and
// the order a snapshot lists them in for the same reason at the replica.
export const WRITE_ORDER = [
  "papers", "shelves", "tags", "boards", "board_groups", "board_items",
  "annotations", "copies", "copy_tags",
] as const;

// A paper is named by its file's digest; everything else by a UUID.
export function keyColumn(table: string): "sha256" | "uuid" {
  return table === "papers" ? "sha256" : "uuid";
}

export function rule(table: string): TableRule {
  const found = registry.tables[table];
  if (!found) throw new Error(`${table} is not a synchronized table`);
  return found;
}

export function writable(table: string): Set<string> {
  return new Set(rule(table).client_writable ?? []);
}

export function serverColumns(table: string): Set<string> {
  return new Set(rule(table).server_columns ?? []);
}

// The tables whose rows belong to a user through a board rather than
// directly. Everything else has its own user_uuid.
export function ownedThroughBoard(table: string): boolean {
  return rule(table).owner === "board.user_uuid";
}
