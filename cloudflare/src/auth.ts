// Who is asking. A bearer token names a session row; the session names
// the user. Passwords are PBKDF2-SHA256. Accounts made before the move
// hold `salt$hex` at 200,000 iterations, which Workers' WebCrypto refuses
// (100,000 is its ceiling), so that form is checked in plain JavaScript
// and replaced with the Worker's own form the first time it verifies.

import { pbkdf2 as pbkdf2InJs } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";

import { now, one, statement, type Row } from "./db";
import { refuse } from "./http";

// The Worker's form: `pbkdf2$<iterations>$<salt>$<hex>`, at the most
// the platform's native PBKDF2 allows.
const ITERATIONS = 100_000;
// The older `salt$hex` form's.
const LEGACY_ITERATIONS = 200_000;

// How stale last_used_at may get before a request rewrites it. Coarse on
// purpose: a user clicking through the app costs one write a minute rather
// than one per request.
const LAST_USED_RESOLUTION_MS = 60_000;

export const PLATFORM_HEADER = "X-Papol-Platform";
export const WEB = "web";
export const MACOS = "macos";

export interface User extends Row {
  uuid: string;
  email: string;
  display_name: string;
  affiliation: string | null;
  avatar_path: string | null;
  email_public: number;
  is_admin: number;
  password_hash: string;
  created_at: string | null;
  deleted_at: string | null;
}

function hex(bytes: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function pbkdf2(password: string, salt: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations }, key, 256);
  return hex(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return `pbkdf2$${ITERATIONS}$${salt}$${await pbkdf2(password, salt, ITERATIONS)}`;
}

// A hash in the older form, which a successful sign-in replaces.
export function isLegacyHash(stored: string): boolean {
  return !stored.startsWith("pbkdf2$") && stored.includes("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts[0] === "pbkdf2" && parts.length === 4) {
    return timingSafeEqual(await pbkdf2(password, parts[2], Number(parts[1])), parts[3]);
  }
  if (parts.length !== 2) return false; // a closed account's unusable hash, or nonsense
  // Too many iterations for the platform's PBKDF2, so the arithmetic is
  // done here: a few hundred milliseconds, once per account.
  const derived = pbkdf2InJs(sha256, new TextEncoder().encode(password), new TextEncoder().encode(parts[0]), { c: LEGACY_ITERATIONS, dkLen: 32 });
  return timingSafeEqual(hex(derived), parts[1]);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

// Which Papol this sign-in came from. Everything that is not the installed
// application reaches Papol as a page, so "web" is what a caller gets for
// saying nothing, or for saying something this server does not know.
export function loginPlatform(request: Request): string {
  return (request.headers.get(PLATFORM_HEADER) ?? "").trim().toLowerCase() === MACOS ? MACOS : WEB;
}

export function newToken(): string {
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}

// The statement that opens a session; the caller commits it with whatever
// else the sign-in writes.
export function sessionInsert(db: D1Database, token: string, userUuid: string, platform: string): D1PreparedStatement {
  const at = now();
  return statement(
    db,
    "INSERT INTO auth_tokens (token, user_uuid, created_at, last_used_at, platform) VALUES (?, ?, ?, ?, ?)",
    token, userUuid, at, at, platform,
  );
}

function bearer(request: Request): string | null {
  const [scheme, credential] = (request.headers.get("authorization") ?? "").split(" ", 2);
  return scheme?.toLowerCase() === "bearer" && credential ? credential : null;
}

interface Session extends Row {
  token: string;
  last_used_at: string | null;
}

// The signed-in user, or null. A closed account is nobody's; its token
// answers as no token at all.
export async function optionalUser(request: Request, env: Env): Promise<User | null> {
  const token = bearer(request);
  if (!token) return null;
  const session = await one<Session & User>(
    env.DB,
    `SELECT t.token, t.last_used_at, u.* FROM auth_tokens t JOIN users u ON u.uuid = t.user_uuid
     WHERE t.token = ? AND t.revoked_at IS NULL`,
    token,
  );
  if (!session || session.deleted_at) return null;
  const stamped = session.last_used_at ? Date.parse(session.last_used_at) : 0;
  if (Date.now() - stamped >= LAST_USED_RESOLUTION_MS) {
    await statement(env.DB, "UPDATE auth_tokens SET last_used_at = ? WHERE token = ?", now(), token).run();
  }
  const { token: _token, last_used_at: _seen, ...user } = session;
  return user as User;
}

export async function currentUser(request: Request, env: Env): Promise<User> {
  if (!bearer(request)) refuse(401, "Not authenticated");
  const user = await optionalUser(request, env);
  return user ?? refuse(401, "Invalid or expired session");
}

// What a user sees of themselves. `email_public` and `is_admin` are stored
// as 0/1 and spoken as booleans.
export function userPrivate(user: User) {
  return {
    uuid: user.uuid,
    email: user.email,
    display_name: user.display_name,
    affiliation: user.affiliation,
    avatar_path: user.avatar_path,
    email_public: Boolean(user.email_public),
    is_admin: Boolean(user.is_admin),
  };
}
