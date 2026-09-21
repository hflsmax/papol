// Who is asking. A bearer token names a session row; the session names
// the user. Passwords are PBKDF2-SHA256 in the `salt$hex` form the Python
// backend wrote, so every account's password survives the move as it is.

import { now, one, statement, type Row } from "./db";
import { refuse } from "./http";

const PBKDF2_ITERATIONS = 200_000;

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

async function pbkdf2(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return hex(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return `${salt}$${await pbkdf2(password, salt)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const separator = stored.indexOf("$");
  if (separator < 0) return false;
  const candidate = await pbkdf2(password, stored.slice(0, separator));
  return timingSafeEqual(candidate, stored.slice(separator + 1));
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
