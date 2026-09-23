// The schema's own guarantees, checked against the migrated database.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("the schema", () => {
  // A foreign key column without an index makes every delete of a parent
  // row scan the whole child table: dropping paper_references once read
  // 9.6 million rows of paper_citations (migration 0004).
  it("indexes every foreign key column", async () => {
    const { results: keys } = await env.DB.prepare(
      `SELECT m.name AS child, p."from" AS column FROM sqlite_master m JOIN pragma_foreign_key_list(m.name) p
       WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' AND m.name NOT LIKE '\\_cf\\_%' ESCAPE '\\'`,
    ).all<{ child: string; column: string }>();
    // D1 refuses pragma_index_list, so the indexes are read from their own
    // CREATE INDEX statements: the first column each one leads with.
    const { results: indexes } = await env.DB.prepare(
      "SELECT tbl_name AS tbl, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL",
    ).all<{ tbl: string; sql: string }>();
    const indexed = new Set(indexes.map((row) => `${row.tbl}.${row.sql.match(/\(\s*"?(\w+)/)?.[1]}`));
    expect(keys.length).toBeGreaterThan(20);
    expect(keys.map((k) => `${k.child}.${k.column}`).filter((key) => !indexed.has(key))).toEqual([]);
  });
});
