// What every test of the API needs: an account, a way to ask, and a way
// to look at the database afterwards.
import { SELF, env } from "cloudflare:test";
import { expect } from "vitest";

export type Json = Record<string, any>;

export function uuid(): string {
  return crypto.randomUUID();
}

export async function sha256(bytes: ArrayBuffer | Uint8Array | string): Promise<string> {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  const digest = await crypto.subtle.digest("SHA-256", data as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function call(method: string, path: string, { headers = {}, json, body }: { headers?: Record<string, string>; json?: unknown; body?: BodyInit } = {}): Promise<Response> {
  const init: RequestInit = { method, headers: { ...headers } };
  if (json !== undefined) {
    init.body = JSON.stringify(json);
    (init.headers as Record<string, string>)["content-type"] = "application/json";
  } else if (body !== undefined) {
    init.body = body;
  }
  return SELF.fetch(`https://papol.test${path}`, init);
}

// A request that has to succeed, answered as JSON.
export async function ok(method: string, path: string, options: Parameters<typeof call>[2] = {}): Promise<Json> {
  const response = await call(method, path, options);
  expect(response.status, `${method} ${path}: ${await response.clone().text()}`).toBeLessThan(400);
  return response.status === 204 ? {} : response.json();
}

export interface Account {
  headers: Record<string, string>;
  uuid: string;
  email: string;
}

export async function register(email = `${uuid()}@example.test`, displayName = "Desktop Test"): Promise<Account> {
  const answer = await ok("POST", "/api/auth/register", {
    json: { email, display_name: displayName, affiliation: null, password: "testing-password" },
  });
  return { headers: { Authorization: `Bearer ${answer.token}` }, uuid: answer.user.uuid, email };
}

export function push(account: Account, payload: Json) {
  return call("POST", "/api/sync/push", { headers: account.headers, json: payload });
}

export async function pushed(account: Account, payload: Json): Promise<Json> {
  return ok("POST", "/api/sync/push", { headers: account.headers, json: payload });
}

// One change, on its own, as the desktop sends most of them.
export function mutation(changes: Json[], { client = uuid(), sequence = 1 } = {}): Json {
  return { client_uuid: client, mutation_uuid: uuid(), local_sequence: sequence, changes };
}

export async function count(table: string, where = "1 = 1", ...binds: unknown[]): Promise<number> {
  const row = await env.DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`).bind(...binds).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function rows<T = Json>(sql: string, ...binds: unknown[]): Promise<T[]> {
  const { results } = await env.DB.prepare(sql).bind(...binds).all<T>();
  return results;
}

export async function row<T = Json>(sql: string, ...binds: unknown[]): Promise<T | null> {
  return env.DB.prepare(sql).bind(...binds).first<T>();
}

export async function exec(sql: string, ...binds: unknown[]): Promise<void> {
  await env.DB.prepare(sql).bind(...binds).run();
}

// A paper somebody uploaded, and this user's copy of it: what the sync
// tests need in the database before a replica pushes about it.
export async function paperWithCopy(account: Account, digest: string, title: string, { shelfUuid = null as string | null, revision = 0, filePath = `${digest}.pdf` } = {}): Promise<string> {
  const at = new Date().toISOString();
  await exec(
    "INSERT INTO papers (sha256, title, file_path, uploaded_by, created_at, updated_at, revision) VALUES (?, ?, ?, ?, ?, ?, 1)",
    digest, title, filePath, account.uuid, at, at,
  );
  const copyUuid = uuid();
  await exec(
    "INSERT INTO copies (uuid, paper_sha256, user_uuid, shelf_uuid, is_author, created_at, updated_at, revision) VALUES (?, ?, ?, ?, 0, ?, ?, ?)",
    copyUuid, digest, account.uuid, shelfUuid, at, at, revision,
  );
  return copyUuid;
}

export async function defaultShelf(account: Account): Promise<string> {
  const shelf = await row<{ uuid: string }>("SELECT uuid FROM shelves WHERE user_uuid = ? AND is_default = 1", account.uuid);
  return shelf!.uuid;
}
