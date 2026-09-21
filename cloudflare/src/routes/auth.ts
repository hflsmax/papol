// Signing up, in, and out, and asking who you are.

import {
  currentUser, hashPassword, isLegacyHash, loginPlatform, newToken, sessionInsert, userPrivate,
  verifyPassword, type User,
} from "../auth";
import { batch, insert, newUuid, now, one, statement } from "../db";
import { json, readJson, refuse, type Router } from "../http";
import { registration } from "../validate";

// The {name} placeholder is filled with the new user's display name.
// Overridden by the settings table key "welcome_message".
const DEFAULT_WELCOME =
  "Welcome to Papol, {name}—your paper reading companion. Your nook is where you " +
  "document your reading: upload the papers you read, rate them, " +
  "keep private notes and a summary, and share a public " +
  "one-sentence thought. Use the Library to find papers and see " +
  "what other users keep in their nooks, then add papers to " +
  "your own. When a paper deserves a conversation, call a " +
  "spontaneous seminar, and every user of it will be invited. " +
  "Each seminar is run by a host: a user who volunteers to plan " +
  "it and lead the discussion. Answer a call to host one yourself!";

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
      insert(env.DB, "notifications", { uuid: newUuid(), user_uuid: user.uuid, content: (welcome?.value || DEFAULT_WELCOME).replace("{name}", user.display_name), read: 0, emailed: 0, created_at: at }),
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
