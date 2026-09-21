// The little that stands between the routes and D1.
//
// No ORM, no query builder: a route knows its tables, writes its SQL, and
// reads rows as plain objects. Timestamps are ISO-8601 UTC text, which is
// what SQLite stores, what the wire carries, and what every replica keeps;
// there is one format and nothing converts.

export type Row = Record<string, unknown>;

export function now(): string {
  return new Date().toISOString();
}

export function newUuid(): string {
  return crypto.randomUUID();
}

export async function one<T = Row>(db: D1Database, sql: string, ...binds: unknown[]): Promise<T | null> {
  return db.prepare(sql).bind(...binds).first<T>();
}

export async function all<T = Row>(db: D1Database, sql: string, ...binds: unknown[]): Promise<T[]> {
  const { results } = await db.prepare(sql).bind(...binds).all<T>();
  return results;
}

export function statement(db: D1Database, sql: string, ...binds: unknown[]): D1PreparedStatement {
  return db.prepare(sql).bind(...binds);
}

// A list of statements, run atomically: all of them or none. This is D1's
// transaction, and the shape every write in Papol takes — read first,
// decide in code, then write once.
export async function batch(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  if (statements.length > 0) await db.batch(statements);
}

// `INSERT INTO t (a, b) VALUES (?, ?)` from an object, keys in a stable order.
export function insert(db: D1Database, table: string, row: Row): D1PreparedStatement {
  const keys = Object.keys(row);
  const sql = `INSERT INTO ${table} (${keys.map((k) => `"${k}"`).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`;
  return db.prepare(sql).bind(...keys.map((k) => sqlValue(row[k])));
}

// `UPDATE t SET a = ?, b = ? WHERE key = ?`.
export function update(db: D1Database, table: string, key: string, keyValue: unknown, values: Row): D1PreparedStatement {
  const keys = Object.keys(values);
  const sql = `UPDATE ${table} SET ${keys.map((k) => `"${k}" = ?`).join(", ")} WHERE "${key}" = ?`;
  return db.prepare(sql).bind(...keys.map((k) => sqlValue(values[k])), keyValue);
}

function sqlValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

// The columns of a table, in declared order, read once per isolate. The
// schema is the migration's, not a model's, so this is where a row's shape
// comes from when a whole row has to be serialized — and which of its
// columns are booleans, which SQLite keeps as 0 and 1 and the wire speaks
// as true and false.
export interface Column {
  name: string;
  boolean: boolean;
}

const columnsOf = new Map<string, Promise<Column[]>>();

export function columns(db: D1Database, table: string): Promise<Column[]> {
  let known = columnsOf.get(table);
  if (!known) {
    known = all<{ name: string; type: string }>(db, `PRAGMA table_info("${table}")`).then((rows) =>
      rows.map((r) => ({ name: r.name, boolean: r.type.toUpperCase() === "BOOLEAN" })),
    );
    columnsOf.set(table, known);
  }
  return known;
}
