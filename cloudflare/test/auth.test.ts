import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "../src/auth";
import { call, exec, ok, register, row, uuid } from "./helpers";

describe("accounts", () => {
  it("signs a new user up with their furniture and a session", async () => {
    const account = await register("reader@example.test", "Reader");
    const me = await ok("GET", "/api/auth/me", { headers: account.headers });
    expect(me).toEqual({
      uuid: account.uuid, email: "reader@example.test", display_name: "Reader",
      affiliation: null, avatar_path: null, email_public: true, is_admin: false,
    });
    const shelves = await row<{ n: number }>("SELECT count(*) AS n FROM shelves WHERE user_uuid = ?", account.uuid);
    expect(shelves?.n).toBe(2);
    const welcome = await row<{ content: string }>("SELECT content FROM notifications WHERE user_uuid = ?", account.uuid);
    expect(welcome?.content).toContain("Welcome to Papol, Reader");
  });

  it("refuses a second account on one address, and a password too short to be one", async () => {
    await register("taken@example.test");
    const again = await call("POST", "/api/auth/register", {
      json: { email: "Taken@example.test", display_name: "Again", password: "testing-password" },
    });
    expect(again.status).toBe(400);
    const weak = await call("POST", "/api/auth/register", {
      json: { email: "weak@example.test", display_name: "Weak", password: "12345" },
    });
    expect(weak.status).toBe(422);
  });

  it("signs in with the password, and not without it", async () => {
    const account = await register("login@example.test");
    const wrong = await call("POST", "/api/auth/login", { json: { email: "login@example.test", password: "nope" } });
    expect(wrong.status).toBe(401);
    const right = await ok("POST", "/api/auth/login", { json: { email: "LOGIN@example.test", password: "testing-password" } });
    expect(right.user.uuid).toBe(account.uuid);
    expect(right.token).not.toBe(account.headers.Authorization.slice(7));
  });

  it("ends a session on sign-out and keeps its record", async () => {
    const account = await register();
    await ok("POST", "/api/auth/logout", { headers: account.headers });
    expect((await call("GET", "/api/auth/me", { headers: account.headers })).status).toBe(401);
    const session = await row<{ revoked_at: string | null }>("SELECT revoked_at FROM auth_tokens WHERE user_uuid = ?", account.uuid);
    expect(session?.revoked_at).not.toBeNull();
  });

  it("refuses a request with no session, or a session nobody opened", async () => {
    expect((await call("GET", "/api/auth/me")).status).toBe(401);
    expect((await call("GET", "/api/auth/me", { headers: { Authorization: "Bearer expired" } })).status).toBe(401);
  });

  it("reads the older password hashes, and re-hashes them in its own form at sign-in", { timeout: 60_000 }, async () => {
    // hashlib.pbkdf2_hmac("sha256", b"testing-password", b"0" * 32, 200_000).hex()
    const legacy = "00000000000000000000000000000000$647714d0f7ae0f44941ebadde82604f5c37bf85875f58bbdd82f3bb37cb9b369";
    expect(await verifyPassword("testing-password", legacy)).toBe(true);
    expect(await verifyPassword("other", legacy)).toBe(false);
    expect(await verifyPassword("testing-password", "closed-account-no-password")).toBe(false);
    const ours = await hashPassword("testing-password");
    expect(ours).toMatch(/^pbkdf2\$100000\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
    expect(await verifyPassword("testing-password", ours)).toBe(true);
    expect(await verifyPassword("other", ours)).toBe(false);

    const at = new Date().toISOString();
    await exec("INSERT INTO users (uuid, email, display_name, email_public, is_admin, password_hash, created_at) VALUES (?, 'older@example.test', 'Older', 1, 0, ?, ?)", uuid(), legacy, at);
    expect((await call("POST", "/api/auth/login", { json: { email: "older@example.test", password: "wrong" } })).status).toBe(401);
    expect((await call("POST", "/api/auth/login", { json: { email: "older@example.test", password: "testing-password" } })).status).toBe(200);
    const stored = (await row<{ password_hash: string }>("SELECT password_hash FROM users WHERE email = 'older@example.test'"))!.password_hash;
    expect(stored).toMatch(/^pbkdf2\$100000\$/);
    expect((await call("POST", "/api/auth/login", { json: { email: "older@example.test", password: "testing-password" } })).status).toBe(200);
  });
});
