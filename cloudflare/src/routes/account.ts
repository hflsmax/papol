// The account itself: who you say you are, your picture, your password,
// everything Papol holds about you in one file, and closing the door.

import limits from "../../../config/app_limits.json";
import { closeAccount } from "../account/close";
import { exportZip } from "../account/export";
import { currentUser, hashPassword, userPrivate, verifyPassword, type User } from "../auth";
import { newUuid, one, statement } from "../db";
import { json, readJson, refuse, type Router } from "../http";
import { UPLOADS } from "../sync/blobs";
import * as validate from "../validate";

const AVATAR_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
const AVATAR_LIMIT = limits.files.avatar_mb * 1024 * 1024;

async function saveAvatar(env: Env, user: User, avatarPath: string | null) {
  const previous = user.avatar_path;
  user.avatar_path = avatarPath;
  await statement(env.DB, "UPDATE users SET avatar_path = ? WHERE uuid = ?", avatarPath, user.uuid).run();
  // Only once the row no longer points at it.
  if (previous && /^avatars\/[A-Za-z0-9._-]+$/.test(previous)) await env.FILES.delete(`${UPLOADS}${previous}`);
  return json(userPrivate(user));
}

export function accountRoutes(router: Router) {
  // Display name, affiliation, and whether the email shows on the user's
  // nook. The email address itself is the login identifier and is fixed.
  router.on("PUT", "/api/auth/profile", async ({ request, env }) => {
    const user = await currentUser(request, env);
    const data = await readJson<Record<string, unknown>>(request);
    const check = validate.checking();
    const displayName = "display_name" in data ? check.string("display_name", data.display_name, { max: limits.text.display_name, optional: true }) : undefined;
    const affiliation = "affiliation" in data ? check.string("affiliation", data.affiliation, { max: limits.text.affiliation, optional: true }) : undefined;
    const emailPublic = check.boolean("email_public", data.email_public, { optional: true });
    check.done();
    if (displayName !== undefined) {
      if (!(displayName ?? "").trim()) refuse(400, "Display name cannot be empty");
      user.display_name = displayName!.trim();
    }
    if (affiliation !== undefined) user.affiliation = (affiliation ?? "").trim() || null;
    if (emailPublic !== null) user.email_public = emailPublic ? 1 : 0;
    await statement(env.DB, "UPDATE users SET display_name = ?, affiliation = ?, email_public = ? WHERE uuid = ?", user.display_name, user.affiliation, user.email_public, user.uuid).run();
    return json(userPrivate(user));
  });

  // A picture, stored under a name minted for this one upload so the URL
  // that serves it may be cached for good.
  router.on("POST", "/api/auth/avatar", async ({ request, env }) => {
    const user = await currentUser(request, env);
    let form: FormData;
    try { form = await request.formData(); } catch { return refuse(422, "The request is not a form"); }
    const file = form.get("file");
    if (!(file instanceof File)) refuse(422, "file is required");
    const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    const mime = AVATAR_TYPES[ext];
    if (!mime) refuse(400, "Only PNG, JPEG, or WebP images are allowed");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length > AVATAR_LIMIT) refuse(400, `Image must be at most ${limits.files.avatar_mb} MB`);
    const key = `avatars/${newUuid()}${ext}`;
    await env.FILES.put(`${UPLOADS}${key}`, bytes, { httpMetadata: { contentType: mime } });
    return saveAvatar(env, user, key);
  });

  router.on("DELETE", "/api/auth/avatar", async ({ request, env }) => {
    return saveAvatar(env, await currentUser(request, env), null);
  });

  router.on("PUT", "/api/auth/password", async ({ request, env }) => {
    const user = await currentUser(request, env);
    const data = await readJson<Record<string, unknown>>(request);
    const check = validate.checking();
    const current = check.string("current_password", data.current_password);
    const wanted = check.string("new_password", data.new_password, { min: 6, max: limits.text.password });
    check.done();
    if (!(await verifyPassword(current!, user.password_hash))) refuse(401, "Current password is incorrect");
    await statement(env.DB, "UPDATE users SET password_hash = ? WHERE uuid = ?", await hashPassword(wanted!), user.uuid).run();
    return json({ message: "Password updated" });
  });

  // Everything Papol holds about this user, in one zip.
  router.on("GET", "/api/auth/export", async ({ request, env }) => {
    return exportZip(env, await currentUser(request, env));
  });

  // Close the account. Being signed in is what proves who they are;
  // typing their own address out is what proves they meant it.
  router.on("DELETE", "/api/auth/account", async ({ request, env }) => {
    const user = await currentUser(request, env);
    const data = await readJson<{ confirm_email?: unknown }>(request);
    if (String(data.confirm_email ?? "").trim().toLowerCase() !== user.email.toLowerCase()) refuse(400, "Type your own email address exactly to confirm.");
    // Papol would otherwise have no one who can reach the admin pages, and
    // no way to appoint one.
    if (user.is_admin && !(await one(env.DB, "SELECT 1 FROM users WHERE is_admin = 1 AND uuid != ?", user.uuid))) {
      refuse(400, "You are the only admin. Make someone else an admin before closing this account.");
    }
    return json({ message: "Your account has been closed.", removed: await closeAccount(env, user) });
  });
}
