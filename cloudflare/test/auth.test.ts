import { describe, expect, it } from "vitest";

import { call, exec, ok, register, row } from "./helpers";

describe("accounts", () => {
  it("signs a new user up with their furniture and a session", async () => {
    const account = await register("reader@example.test", "Reader");
    const me = await ok("GET", "/api/auth/me", { headers: account.headers });
    expect(me).toEqual({
      uuid: account.uuid, email: "reader@example.test", display_name: "Reader",
      affiliation: null, avatar_path: null, email_public: true, is_admin: false,
      nav_marks: ["figure", "table", "algorithm", "definition", "theorem"],
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

  it("resets a forgotten password through a single-use emailed link", async () => {
    const account = await register("forgotten@example.test", "Forgotten Reader");
    const requested = await ok("POST", "/api/auth/forgot-password", { json: { email: "FORGOTTEN@example.test" } });
    expect(requested.message).toContain("If that address belongs to an account");

    const job = await row<{ payload: string }>("SELECT payload FROM jobs WHERE kind = 'send_email'");
    const body = JSON.parse(job!.payload).body as string;
    const token = body.match(/\/reset-password\/([0-9a-f]{64})/)?.[1];
    expect(token).toHaveLength(64);

    expect((await call("POST", "/api/auth/reset-password", { json: { token, password: "short" } })).status).toBe(422);
    await ok("POST", "/api/auth/reset-password", { json: { token, password: "replacement-password" } });
    expect((await call("POST", "/api/auth/reset-password", { json: { token, password: "another-password" } })).status).toBe(400);
    expect((await call("GET", "/api/auth/me", { headers: account.headers })).status).toBe(401);
    expect((await call("POST", "/api/auth/login", { json: { email: account.email, password: "testing-password" } })).status).toBe(401);
    expect((await call("POST", "/api/auth/login", { json: { email: account.email, password: "replacement-password" } })).status).toBe(200);
  });

  it("does not reveal whether a password-reset address exists and rejects expired links", async () => {
    const missing = await ok("POST", "/api/auth/forgot-password", { json: { email: "nobody@example.test" } });
    expect(missing.message).toContain("If that address belongs to an account");
    expect(await row("SELECT * FROM jobs WHERE kind = 'send_email'")).toBeNull();

    await register("expired@example.test");
    await ok("POST", "/api/auth/forgot-password", { json: { email: "expired@example.test" } });
    const job = await row<{ payload: string }>("SELECT payload FROM jobs WHERE kind = 'send_email'");
    const token = (JSON.parse(job!.payload).body as string).match(/\/reset-password\/([0-9a-f]{64})/)?.[1];
    await exec("UPDATE password_resets SET expires_at = '2000-01-01T00:00:00.000Z'");
    expect((await call("POST", "/api/auth/reset-password", { json: { token, password: "replacement-password" } })).status).toBe(400);
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
});
