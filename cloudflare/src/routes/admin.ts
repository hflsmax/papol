// The admin pages: every report, the tables as they are, and one raw
// statement at a time. What the database is made of is asked of the
// database, not of a model held beside it.

import limits from "../../../config/app_limits.json";
import { all, one, type Row } from "../db";
import { json, readJson, refuse, type Router } from "../http";
import * as validate from "../validate";
import { feedbackOut, requireAdmin } from "./inbox";

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RETURNS_ROWS = /^\s*(select|with|pragma|explain|values)\b/i;

interface Column { name: string; type: string; pk: number }

// The tables this schema declares. SQLite's own and D1's bookkeeping
// tables are not part of Papol.
async function tableNames(db: D1Database): Promise<string[]> {
  const rows = await all<{ name: string }>(db,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name != 'd1_migrations' ORDER BY name");
  return rows.map((r) => r.name);
}

async function columnsOf(db: D1Database, table: string): Promise<Column[]> {
  if (!NAME.test(table) || !(await tableNames(db)).includes(table)) refuse(404, "Table not found");
  return all<Column>(db, `PRAGMA table_info("${table}")`);
}

function singleKey(columns: Column[]): Column {
  const keys = columns.filter((c) => c.pk > 0);
  if (keys.length !== 1) refuse(400, "Table has no single-column primary key");
  return keys[0];
}

// A value typed into the admin UI, as the column's affinity would store
// it. Nothing typed is null; a number typed for a numeric column is a
// number; a date stays the ISO string every date here is.
function coerce(column: Column, value: unknown): unknown {
  if (value === null || value === "") return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value !== "string") return value;
  const affinity = column.type.toUpperCase();
  if (/INT|BOOL/.test(affinity)) {
    const n = Number(value);
    if (!Number.isInteger(n)) refuse(400, `Invalid value for ${column.name}`);
    return n;
  }
  if (/REAL|FLOA|DOUB|NUM|DEC/.test(affinity)) {
    const n = Number(value);
    if (Number.isNaN(n)) refuse(400, `Invalid value for ${column.name}`);
    return n;
  }
  return value;
}

export function adminRoutes(router: Router) {
  // Every bug report and feature request, the open ones first, newest first.
  router.on("GET", "/api/admin/feedback", async ({ request, env }) => {
    await requireAdmin(request, env);
    const rows = await all<Row>(env.DB, "SELECT f.*, u.uuid AS u_uuid, u.display_name, u.affiliation, u.avatar_path, u.email FROM feedback f LEFT JOIN users u ON u.uuid = f.user_uuid ORDER BY f.resolved, f.created_at DESC, f.uuid DESC");
    return json(rows.map((fb) => feedbackOut(fb, fb.u_uuid ? { ...fb, uuid: fb.u_uuid } : null)));
  });

  // Mark a report done, or reopen it.
  router.on("PUT", "/api/admin/feedback/:uuid", async ({ request, env, params }) => {
    await requireAdmin(request, env);
    const data = await readJson<{ resolved?: unknown }>(request);
    const check = validate.checking();
    const resolved = check.boolean("resolved", data.resolved);
    check.done();
    const fb = await one<Row>(env.DB, "SELECT * FROM feedback WHERE uuid = ?", params.uuid);
    if (!fb) refuse(404, "Report not found");
    fb.resolved = resolved ? 1 : 0;
    await env.DB.prepare("UPDATE feedback SET resolved = ? WHERE uuid = ?").bind(fb.resolved, fb.uuid).run();
    const user = fb.user_uuid ? await one<Row>(env.DB, "SELECT * FROM users WHERE uuid = ?", fb.user_uuid) : null;
    return json(feedbackOut(fb, user));
  });

  router.on("GET", "/api/admin/tables", async ({ request, env }) => {
    await requireAdmin(request, env);
    return json({ tables: await tableNames(env.DB) });
  });

  router.on("GET", "/api/admin/tables/:table", async ({ request, env, params }) => {
    await requireAdmin(request, env);
    const columns = await columnsOf(env.DB, params.table);
    const rows = await all<Row>(env.DB, `SELECT * FROM "${params.table}" LIMIT ?`, limits.counts.admin_table_rows);
    return json({ columns: columns.map((c) => c.name), primary_key: columns.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name), rows });
  });

  router.on("PUT", "/api/admin/tables/:table/rows/:key", async ({ request, env, params }) => {
    await requireAdmin(request, env);
    const columns = await columnsOf(env.DB, params.table);
    const key = singleKey(columns);
    const data = await readJson<Record<string, unknown>>(request);
    const edits = columns.filter((c) => c.name !== key.name && c.name in data).map((c) => [c.name, coerce(c, data[c.name])] as const);
    if (!edits.length) refuse(400, "No editable columns in payload");
    const result = await env.DB.prepare(`UPDATE "${params.table}" SET ${edits.map(([name]) => `"${name}" = ?`).join(", ")} WHERE "${key.name}" = ?`)
      .bind(...edits.map(([, value]) => value), coerce(key, params.key)).run();
    if (!result.meta.changes) refuse(404, "Row not found");
    return json({ updated: result.meta.changes });
  });

  router.on("DELETE", "/api/admin/tables/:table/rows/:key", async ({ request, env, params }) => {
    await requireAdmin(request, env);
    const key = singleKey(await columnsOf(env.DB, params.table));
    const result = await env.DB.prepare(`DELETE FROM "${params.table}" WHERE "${key.name}" = ?`).bind(coerce(key, params.key)).run();
    if (!result.meta.changes) refuse(404, "Row not found");
    return json({ deleted: result.meta.changes });
  });

  // One raw SQL statement. Admin only, and the admin is trusted with it.
  router.on("POST", "/api/admin/sql", async ({ request, env }) => {
    await requireAdmin(request, env);
    const data = await readJson<{ query?: unknown }>(request);
    const check = validate.checking();
    const query = check.string("query", data.query, { min: 1, max: limits.text.admin_query })!;
    check.done();
    let result: D1Result<Row>;
    try {
      result = await env.DB.prepare(query).all<Row>();
    } catch (error) {
      return refuse(400, (error as Error).message);
    }
    if (RETURNS_ROWS.test(query)) {
      const rows = result.results.slice(0, limits.counts.admin_table_rows);
      return json({ rows, columns: rows.length ? Object.keys(rows[0]) : [] });
    }
    return json({ rowcount: result.meta.changes });
  });
}
