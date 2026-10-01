// Signing up, in, and out, and asking who you are.

import {
  currentUser, hashPassword, isLegacyHash, loginPlatform, newToken, sessionInsert, userPrivate,
  verifyPassword, type User,
} from "../auth";
import { batch, insert, newUuid, now, one, statement } from "../db";
import { json, readJson, refuse, type Router } from "../http";
import { queueEmail, siteUrl } from "../jobs/notifications";
import { wake } from "../jobs/queue";
import limits from "../../../config/app_limits.json";
import { registration } from "../validate";

const RESET_LIFETIME_MS = 60 * 60 * 1000;
const RESET_REPLY = "If that address belongs to an account, a password reset link is on its way.";

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// The {name} placeholder is filled with the new user's display name.
// Overridden by the settings table key "welcome_message".
const DEFAULT_WELCOME =
  "Welcome to Papol, {name}—your paper-reading companion. Your nook is where you " +
  "document your reading: upload the papers you read, rate them, " +
  "keep a summary and your own digs, and share a public " +
  "one-sentence thought. Use the Library to find papers and see " +
  "what other users keep in their nooks, then add papers to " +
  "your own.";

export function authRoutes(router: Router) {
  router.on("POST", "/api/auth/register", async ({ request, env }) => {
    const data = registration(await readJson(request));
    const email = data.email.toLowerCase();
    if (await one(env.DB, "SELECT 1 FROM users WHERE email = ?", email)) refuse(400, "Email already registered");

    const at = now();
    const user = {
      uuid: newUuid(), email, display_name: data.display_name.trim(),
      affiliation: data.affiliation?.trim() || null, avatar_path: null,
      email_public: 1, is_admin: 0, password_hash: await hashPassword(data.password),
      created_at: at, deleted_at: null,
    };
    const welcome = await one<{ value: string }>(env.DB, "SELECT value FROM settings WHERE key = 'welcome_message'");
    const token = newToken();
    // A new user's furniture: two shelves, a tag, a first inbox message
    // and the session they signed up with — one write.
    await batch(env.DB, [
      insert(env.DB, "users", user),
      insert(env.DB, "shelves", { uuid: newUuid(), user_uuid: user.uuid, name: "Display", color: "#7ba26c", is_public: 1, is_default: 1, position: 0, created_at: at, updated_at: at, revision: 0 }),
      insert(env.DB, "shelves", { uuid: newUuid(), user_uuid: user.uuid, name: "Personal", color: "#2b4a6f", is_public: 0, is_default: 0, position: 1, created_at: at, updated_at: at, revision: 0 }),
      insert(env.DB, "tags", { uuid: newUuid(), user_uuid: user.uuid, name: "favourite", created_at: at, updated_at: at, revision: 0 }),
      insert(env.DB, "notifications", { uuid: newUuid(), user_uuid: user.uuid, content: (welcome?.value || DEFAULT_WELCOME).replace("{name}", user.display_name), read: 0, created_at: at }),
      sessionInsert(env.DB, token, user.uuid, loginPlatform(request)),
    ]);
    return json({ token, user: userPrivate(user as unknown as User) });
  });

  router.on("POST", "/api/auth/login", async ({ request, env }) => {
    const data = await readJson<{ email?: string; password?: string }>(request);
    // A closed account keeps its row, but under an address nobody can
    // type and a password hash nothing can match (account/close.ts), so
    // nothing here needs to know about it.
    const user = await one<User>(env.DB, "SELECT * FROM users WHERE email = ?", String(data.email ?? "").toLowerCase());
    if (!user || !(await verifyPassword(String(data.password ?? ""), user.password_hash))) {
      refuse(401, "Invalid email or password");
    }
    const token = newToken();
    const statements = [sessionInsert(env.DB, token, user.uuid, loginPlatform(request))];
    // A password in the older form is re-hashed in the Worker's form now
    // that it has been seen: the next sign-in is native.
    if (isLegacyHash(user.password_hash)) {
      statements.push(statement(env.DB, "UPDATE users SET password_hash = ? WHERE uuid = ?", await hashPassword(String(data.password)), user.uuid));
    }
    await batch(env.DB, statements);
    return json({ token, user: userPrivate(user) });
  });

  router.on("POST", "/api/auth/forgot-password", async ({ request, env }) => {
    const data = await readJson<{ email?: unknown }>(request);
    const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
    if (email.length > limits.text.email) refuse(422, `email must be at most ${limits.text.email} characters`);
    const user = email ? await one<User>(env.DB, "SELECT * FROM users WHERE email = ? AND deleted_at IS NULL", email) : null;
    if (user) {
      const token = newToken();
      const tokenHash = await sha256(token);
      const at = now();
      const expires = new Date(Date.now() + RESET_LIFETIME_MS).toISOString();
      const resetUrl = `${(await siteUrl(env)).replace(/\/$/, "")}/reset-password/${encodeURIComponent(token)}`;
      const mail = queueEmail(
        env.DB, user.email, "Reset your Papol password",
        `Hello ${user.display_name},\n\nUse this link to choose a new Papol password:\n\n${resetUrl}\n\nThis link expires in one hour and can be used once. If you did not ask for it, you can ignore this email.`,
      );
      await batch(env.DB, [
        statement(env.DB, "UPDATE password_resets SET used_at = ? WHERE user_uuid = ? AND used_at IS NULL", at, user.uuid),
        statement(env.DB, "INSERT INTO password_resets (token_hash, user_uuid, created_at, expires_at) VALUES (?, ?, ?, ?)", tokenHash, user.uuid, at, expires),
        mail.statement,
      ]);
      await wake(env, [mail.uuid]);
    }
    return json({ message: RESET_REPLY });
  });

  router.on("POST", "/api/auth/reset-password", async ({ request, env }) => {
    const data = await readJson<{ token?: unknown; password?: unknown }>(request);
    const token = typeof data.token === "string" ? data.token : "";
    const password = typeof data.password === "string" ? data.password : "";
    if (password.length < 6 || password.length > limits.text.password) {
      refuse(422, `password must be between 6 and ${limits.text.password} characters`);
    }
    const tokenHash = await sha256(token);
    const reset = await one<{ user_uuid: string }>(
      env.DB,
      "SELECT user_uuid FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?",
      tokenHash, now(),
    );
    if (!reset) refuse(400, "This password reset link is invalid or has expired");
    const at = now();
    const results = await env.DB.batch([
      statement(env.DB, "UPDATE password_resets SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?", at, tokenHash, at),
      statement(env.DB, `UPDATE users SET password_hash = ? WHERE uuid = ? AND EXISTS
        (SELECT 1 FROM password_resets WHERE token_hash = ? AND user_uuid = users.uuid AND used_at = ?)`, await hashPassword(password), reset.user_uuid, tokenHash, at),
      statement(env.DB, "UPDATE auth_tokens SET revoked_at = ? WHERE user_uuid = ? AND revoked_at IS NULL", at, reset.user_uuid),
    ]);
    if ((results[0].meta.changes ?? 0) !== 1 || (results[1].meta.changes ?? 0) !== 1) {
      refuse(400, "This password reset link is invalid or has expired");
    }
    return json({ message: "Password updated. You can now sign in." });
  });

  router.on("POST", "/api/auth/logout", async ({ request, env }) => {
    const [scheme, token] = (request.headers.get("authorization") ?? "").split(" ", 2);
    if (scheme?.toLowerCase() === "bearer" && token) {
      // Revoke rather than delete: the row is the record of a session, and
      // when it ended is part of knowing who is coming back.
      await statement(env.DB, "UPDATE auth_tokens SET revoked_at = ? WHERE token = ? AND revoked_at IS NULL", now(), token).run();
    }
    return json({ message: "Logged out" });
  });

  router.on("GET", "/api/auth/me", async ({ request, env }) => {
    return json(userPrivate(await currentUser(request, env)));
  });
}
