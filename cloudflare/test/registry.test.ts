// The registry has to say the truth about every column of every
// synchronized table, or it is worth nothing. The Python checked this
// against its models at every start; the Worker checks it against the
// migrated database here, once, because the schema does not change
// between deploys.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { keyColumn, registry, TABLES, WRITE_ORDER } from "../src/sync/registry";

const ROW_BOOKKEEPING = new Set(["created_at", "updated_at", "revision", "deleted_at"]);
const TABLE_KEYS = new Set(["owner", "create_only", "client_writable", "server_owned", "server_columns"]);

describe("the sync registry", () => {
  it("names every synchronized table once, in an order a parent precedes its children in", () => {
    expect([...WRITE_ORDER].sort()).toEqual([...TABLES].sort());
  });

  for (const table of TABLES) {
    it(`places every column of ${table}`, async () => {
      const rule = registry.tables[table];
      expect(Object.keys(rule).every((key) => TABLE_KEYS.has(key)), `unknown keys on ${table}`).toBe(true);
      expect("owner" in rule, `${table} needs an owner path, or null`).toBe(true);

      const { results } = await env.DB.prepare(`PRAGMA table_info("${table}")`).all<{ name: string }>();
      const columns = new Set(results.map((column) => column.name));
      const clientWritable = new Set(rule.client_writable ?? []);
      const serverOwned = new Set(rule.server_owned ?? []);
      const serverColumns = new Set(rule.server_columns ?? []);
      for (const named of [...clientWritable, ...serverOwned, ...serverColumns]) {
        expect(columns.has(named), `${table}.${named} is in the registry but not the table`).toBe(true);
      }
      for (const both of clientWritable) {
        expect(serverOwned.has(both), `${table}.${both} is both client-writable and server-owned`).toBe(false);
      }
      // Whose a row is follows from who pushed it; a replica may not say.
      const ownedBy = rule.owner && !rule.owner.includes(".") ? rule.owner : null;
      if (ownedBy) expect(clientWritable.has(ownedBy)).toBe(false);
      const placed = new Set([...clientWritable, ...serverOwned, ...serverColumns, ...ROW_BOOKKEEPING, keyColumn(table), ...(ownedBy ? [ownedBy] : [])]);
      const unplaced = [...columns].filter((column) => !placed.has(column));
      expect(unplaced, `${table} columns the registry does not place`).toEqual([]);
    });
  }
});
