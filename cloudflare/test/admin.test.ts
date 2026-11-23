// The admin pages: reports, email, tables, and raw SQL, asked of the Worker.
import { describe, expect, it } from "vitest";

import { groupSends } from "../src/routes/admin";
import { call, count, exec, ok, paperWithCopy, register, row, rows, uuid, type Account } from "./helpers";

async function admin(): Promise<Account> {
  const account = await register("admin@example.test", "Admin");
  await exec("UPDATE users SET is_admin = 1 WHERE uuid = ?", account.uuid);
  return account;
}

describe("the admin pages", () => {
  it("are for admins only", async () => {
    const user = await register();
    for (const [method, path] of [["GET", "/api/admin/feedback"], ["GET", "/api/admin/tables"], ["GET", "/api/admin/tables/users"], ["POST", "/api/admin/sql"],
      ["POST", "/api/admin/announcements"], ["GET", "/api/admin/emails"], ["GET", "/api/admin/emails/some-id"], ["GET", "/api/admin/users"]]) {
      expect((await call(method, path, { headers: user.headers, ...(method === "POST" ? { json: {} } : {}) })).status, `${method} ${path}`).toBe(403);
    }
    expect((await call("GET", "/api/admin/tables")).status).toBe(401);
  });

  it("list every report, open ones first and newest first, and mark one done or open again", async () => {
    const boss = await admin(), reporter = await register("reporter@example.test", "Reporter");
    const older = await ok("POST", "/api/feedback", { headers: reporter.headers, json: { content: "The cow is upside down" } });
    await exec("UPDATE feedback SET created_at = ? WHERE uuid = ?", new Date(Date.now() - 60_000).toISOString(), older.uuid);
    const newer = await ok("POST", "/api/feedback", { json: { content: "Cannot sign in", contact: "me@example.test" } });

    expect((await ok("GET", "/api/admin/feedback", { headers: boss.headers })).map((f: any) => [f.content, f.resolved, f.user?.uuid ?? null, f.user_email]))
      .toEqual([["Cannot sign in", false, null, null], ["The cow is upside down", false, reporter.uuid, "reporter@example.test"]]);

    const done = await ok("PUT", `/api/admin/feedback/${newer.uuid}`, { headers: boss.headers, json: { resolved: true } });
    expect(done).toMatchObject({ uuid: newer.uuid, resolved: true, contact: "me@example.test" });
    expect((await ok("GET", "/api/admin/feedback", { headers: boss.headers })).map((f: any) => f.uuid)).toEqual([older.uuid, newer.uuid]);
    expect((await ok("PUT", `/api/admin/feedback/${newer.uuid}`, { headers: boss.headers, json: { resolved: false } })).resolved).toBe(false);
    expect((await call("PUT", `/api/admin/feedback/${newer.uuid}`, { headers: boss.headers, json: { resolved: "yes" } })).status).toBe(422);
    expect((await call("PUT", "/api/admin/feedback/no-such-report", { headers: boss.headers, json: { resolved: true } })).status).toBe(404);
  });

  it("show the tables the schema declares, their columns and keys, and edit or delete a row by its key", async () => {
    const boss = await admin();
    const { tables } = await ok("GET", "/api/admin/tables", { headers: boss.headers });
    expect(tables).toEqual(expect.arrayContaining(["users", "papers", "copies", "settings"]));
    expect(tables).toEqual([...tables].sort());
    expect(tables.some((t: string) => t.startsWith("sqlite_") || t.startsWith("_cf_") || t === "d1_migrations")).toBe(false);
    expect((await call("GET", "/api/admin/tables/no_such_table", { headers: boss.headers })).status).toBe(404);
    expect((await call("GET", "/api/admin/tables/users%3B%20DROP", { headers: boss.headers })).status).toBe(404);

    const users = await ok("GET", "/api/admin/tables/users", { headers: boss.headers });
    expect(users.columns).toEqual(expect.arrayContaining(["uuid", "email", "display_name", "is_admin"]));
    expect(users.primary_key).toEqual(["uuid"]);
    expect(users.rows).toHaveLength(1);
    expect(users.rows[0].email).toBe("admin@example.test");

    // A typed value takes the column's type: "0" for an integer column is
    // 0, and nothing typed is null. The key itself is not editable.
    const edited = await ok("PUT", `/api/admin/tables/users/rows/${boss.uuid}`, { headers: boss.headers, json: { display_name: "The Boss", affiliation: "", is_admin: "0", uuid: "not-this" } });
    expect(edited).toEqual({ updated: 1 });
    expect(await row("SELECT uuid, display_name, affiliation, is_admin FROM users WHERE uuid = ?", boss.uuid)).toEqual({ uuid: boss.uuid, display_name: "The Boss", affiliation: null, is_admin: 0 });
    await exec("UPDATE users SET is_admin = 1 WHERE uuid = ?", boss.uuid);
    expect((await call("PUT", `/api/admin/tables/users/rows/${boss.uuid}`, { headers: boss.headers, json: { is_admin: "maybe" } })).status).toBe(400);
    expect((await call("PUT", `/api/admin/tables/users/rows/${boss.uuid}`, { headers: boss.headers, json: { not_a_column: 1 } })).status).toBe(400);
    expect((await call("PUT", "/api/admin/tables/users/rows/nobody", { headers: boss.headers, json: { display_name: "x" } })).status).toBe(404);

    const tag = (await row("SELECT uuid FROM tags WHERE user_uuid = ?", boss.uuid))!.uuid as string;
    expect(await ok("DELETE", `/api/admin/tables/tags/rows/${tag}`, { headers: boss.headers })).toEqual({ deleted: 1 });
    expect((await call("DELETE", `/api/admin/tables/tags/rows/${tag}`, { headers: boss.headers })).status).toBe(404);
    expect(await count("tags", "user_uuid = ?", boss.uuid)).toBe(0);
  });

  it("email an announcement to every open account, to the ones picked, or to the admin alone", async () => {
    const boss = await admin(), reader = await register("reader@example.test"), gone = await register("gone@example.test");
    await exec("UPDATE users SET deleted_at = ? WHERE uuid = ?", new Date().toISOString(), gone.uuid);
    const announced = async (json: object) => {
      const sent = await ok("POST", "/api/admin/announcements", { headers: boss.headers, json });
      return { count: sent.recipient_count, payload: JSON.parse((await row<{ payload: string }>("SELECT payload FROM jobs WHERE uuid = ? AND kind = 'send_announcement'", sent.job))!.payload) };
    };

    const everyone = await announced({ subject: " Papol is live ", body: "Hello\n" });
    expect(everyone.count).toBe(2);
    expect({ ...everyone.payload, to: everyone.payload.to.sort() }).toEqual({ to: ["admin@example.test", "reader@example.test"], subject: "Papol is live", body: "Hello" });
    expect((await announced({ subject: "S", body: "B", user_uuids: [reader.uuid] })).payload.to).toEqual(["reader@example.test"]);
    expect((await announced({ subject: "S", body: "B", test: true, user_uuids: [reader.uuid] })).payload.to).toEqual(["admin@example.test"]);

    for (const json of [{ subject: "", body: "B" }, { subject: "S" }, { subject: "S", body: "B", user_uuids: [] }, { subject: "S", body: "B", test: "yes" }]) {
      expect((await call("POST", "/api/admin/announcements", { headers: boss.headers, json })).status, JSON.stringify(json)).toBe(422);
    }
    expect((await call("POST", "/api/admin/announcements", { headers: boss.headers, json: { subject: "S", body: "B", user_uuids: [gone.uuid] } })).status).toBe(400);
    expect(await rows("SELECT uuid FROM jobs WHERE kind = 'send_announcement'")).toHaveLength(3);
  });

  it("say so when no email API is configured, rather than showing an empty record", async () => {
    const boss = await admin();
    expect(await ok("GET", "/api/admin/emails", { headers: boss.headers })).toEqual({ configured: false, from: null, sends: [] });
    expect((await call("GET", "/api/admin/emails/some-id", { headers: boss.headers })).status).toBe(404);
  });

  it("gather Resend's record into sends: an announcement's copies are one send", () => {
    const email = (id: string, subject: string, created_at: string, to = `${id}@example.test`, from = "Papol <admin@papol.io>") => ({ id, to: [to], from, subject, created_at, last_event: "delivered" });
    const sends = groupSends([
      email("t", "Test", "2026-09-22 09:50:31.069000+00"),
      email("a2", "Update", "2026-09-02 21:59:12.669000+00"),
      email("a1", "Update", "2026-09-02 21:59:12.044000+00"),
      email("d2", "Digest", "2026-08-27 02:00:00.000000+00"),
      email("d1", "Digest", "2026-08-25 02:00:00.000000+00"),
    ]);
    expect(sends.map((s) => [s.subject, s.sent_at.slice(0, 10), s.emails.map((e) => e.id)])).toEqual([
      ["Test", "2026-09-22", ["t"]], ["Update", "2026-09-02", ["a2", "a1"]], ["Digest", "2026-08-27", ["d2"]], ["Digest", "2026-08-25", ["d1"]],
    ]);
    expect(sends[1].emails[0]).toEqual({ id: "a2", to: "a2@example.test", status: "delivered" });
  });

  it("run one raw statement, answering rows for a query and a count for a change", async () => {
    const boss = await admin();
    const asked = await ok("POST", "/api/admin/sql", { headers: boss.headers, json: { query: "SELECT email, is_admin FROM users ORDER BY email" } });
    expect(asked).toEqual({ rows: [{ email: "admin@example.test", is_admin: 1 }], columns: ["email", "is_admin"] });
    expect(await ok("POST", "/api/admin/sql", { headers: boss.headers, json: { query: "SELECT 1 WHERE 0" } })).toEqual({ rows: [], columns: [] });
    expect(await ok("POST", "/api/admin/sql", { headers: boss.headers, json: { query: "UPDATE users SET affiliation = 'Papol' WHERE is_admin = 1" } })).toEqual({ rowcount: 1 });
    expect((await row("SELECT affiliation FROM users WHERE uuid = ?", boss.uuid))!.affiliation).toBe("Papol");
    const broken = await call("POST", "/api/admin/sql", { headers: boss.headers, json: { query: "SELECT * FROM no_such_table" } });
    expect(broken.status).toBe(400);
    expect(((await broken.json()) as any).detail).toContain("no_such_table");
    expect((await call("POST", "/api/admin/sql", { headers: boss.headers, json: { query: "" } })).status).toBe(422);
  });
  it("list the users seen lately, most recent first, and the users new lately, newest first, each with their numbers", async () => {
    const boss = await admin();
    const old = await register("old@example.test", "Old Reader"), fresh = await register("fresh@example.test", "Fresh"),
      quiet = await register("quiet@example.test", "Quiet"), gone = await register("gone@example.test", "Gone");
    const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
    // Old Reader joined long ago and read an hour ago; Fresh joined two days
    // ago and was last here yesterday; Quiet joined twenty days ago and has
    // not been here for ten; Gone closed their account.
    await exec("UPDATE users SET created_at = ? WHERE uuid = ?", ago(200), old.uuid);
    await exec("UPDATE users SET created_at = ? WHERE uuid = ?", ago(2), fresh.uuid);
    await exec("UPDATE users SET created_at = ? WHERE uuid = ?", ago(20), quiet.uuid);
    await exec("UPDATE users SET created_at = ? WHERE uuid = ?", ago(200), boss.uuid);
    await exec("UPDATE users SET deleted_at = ? WHERE uuid = ?", ago(0), gone.uuid);
    await exec("UPDATE auth_tokens SET last_used_at = ? WHERE user_uuid = ?", ago(30), old.uuid);
    await exec("UPDATE auth_tokens SET last_used_at = ? WHERE user_uuid = ?", ago(1), fresh.uuid);
    await exec("UPDATE auth_tokens SET last_used_at = ? WHERE user_uuid = ?", ago(10), quiet.uuid);
    await exec("INSERT INTO activity (uuid, user_uuid, kind, subject, started_at, ended_at, seconds) VALUES (?, ?, 'paper', 'a', ?, ?, 600)", uuid(), old.uuid, ago(1 / 12), ago(1 / 24));
    await exec("INSERT INTO activity (uuid, user_uuid, kind, subject, started_at, ended_at, seconds) VALUES (?, ?, 'paper', 'b', ?, ?, 3000)", uuid(), old.uuid, ago(40), ago(40));

    await paperWithCopy(old, "a".repeat(64), "One");
    await paperWithCopy(old, "b".repeat(64), "Two");
    await exec("INSERT INTO digs (uuid, user_uuid, subject, paper_sha256, text, created_at, updated_at) VALUES (?, ?, ?, ?, 'x', ?, ?)", uuid(), old.uuid, `paper:${"a".repeat(64)}`, "a".repeat(64), ago(0), ago(0));
    await exec("INSERT INTO annotations (uuid, kind, user_uuid, paper_sha256, page, content, created_at, updated_at) VALUES (?, 'anchor', ?, ?, 1, '', ?, ?)", uuid(), old.uuid, "a".repeat(64), ago(0), ago(0));
    await exec("INSERT INTO friendships (uuid, asker_uuid, asked_uuid, state, created_at) VALUES (?, ?, ?, 'friends', ?)", uuid(), fresh.uuid, old.uuid, ago(0));
    await exec("INSERT INTO friendships (uuid, asker_uuid, asked_uuid, state, created_at) VALUES (?, ?, ?, 'asked', ?)", uuid(), quiet.uuid, old.uuid, ago(0));

    const users = await ok("GET", "/api/admin/users", { headers: boss.headers });
    expect(users).toMatchObject({ active_days: 7, new_days: 30, total_users: 4, active_count: 3, new_count: 2 });
    expect(users.active.map((u: any) => u.display_name)).toEqual(["Admin", "Old Reader", "Fresh"]);
    expect(users.new.map((u: any) => u.display_name)).toEqual(["Fresh", "Quiet"]);
    expect(users.active[1]).toMatchObject({ email: "old@example.test", papers: 2, digs: 1, anchors: 1, friends: 1, projects: 0, reading_recent_seconds: 600, reading_seconds: 3600, platform: "web", is_admin: false });
    expect(Date.parse(users.active[1].last_active_at)).toBeGreaterThan(Date.now() - 2 * 3_600_000);
    expect(users.active[0].is_admin).toBe(true);

    const wider = await ok("GET", "/api/admin/users?active_days=30&new_days=1", { headers: boss.headers });
    expect(wider.active.map((u: any) => u.display_name)).toEqual(["Admin", "Old Reader", "Fresh", "Quiet"]);
    expect(wider.new).toEqual([]);
    expect((await call("GET", "/api/admin/users?active_days=0", { headers: boss.headers })).status).toBe(400);
    expect((await call("GET", "/api/admin/users?new_days=1.5", { headers: boss.headers })).status).toBe(400);
  });
});
