// What Papol tells a user, and what a user tells Papol: notifications,
// messages an admin broadcasts, and feedback.

import limits from "../../../config/app_limits.json";
import { currentUser, optionalUser, type User } from "../auth";
import { all, batch, insert, newUuid, now, one, statement, type Row } from "../db";
import { json, readJson, refuse, type Router } from "../http";
import { queueEmail, siteUrl } from "../jobs/notifications";
import { wake } from "../jobs/queue";
import * as validate from "../validate";

export async function requireAdmin(request: Request, env: Env): Promise<User> {
  const user = await currentUser(request, env);
  if (!user.is_admin) refuse(403, "Admin access required");
  return user;
}

// The accounts an admin's broadcast goes to: every open account, or the
// ones the admin picked (already checked to be a non-empty list), all of
// which must still be open.
export async function audienceOf(env: Env, userUuids: unknown): Promise<{ uuid: string; email: string }[]> {
  if (!Array.isArray(userUuids)) return all(env.DB, "SELECT uuid, email FROM users WHERE deleted_at IS NULL");
  const wanted = [...new Set(userUuids.map(String))];
  const recipients = await all<{ uuid: string; email: string }>(env.DB, `SELECT uuid, email FROM users WHERE deleted_at IS NULL AND uuid IN (${wanted.map(() => "?").join(",")})`, ...wanted);
  if (recipients.length !== wanted.length) refuse(400, "One or more selected users are unavailable");
  return recipients;
}

function userBase(user: Row) {
  return { uuid: user.uuid, display_name: user.display_name, affiliation: user.affiliation ?? null, avatar_path: user.avatar_path ?? null };
}

export function feedbackOut(fb: Row, user: Row | null) {
  return {
    uuid: fb.uuid, content: fb.content, page: fb.page ?? null, contact: fb.contact ?? null, resolved: Boolean(fb.resolved), created_at: fb.created_at,
    user: user ? userBase(user) : null, user_email: user?.email ?? null,
  };
}

export function inboxRoutes(router: Router) {
  // ------------------------------------------------------- notifications

  router.on("GET", "/api/notifications", async ({ request, env }) => {
    const user = await currentUser(request, env);
    const rows = await all<Row>(env.DB,
      "SELECT uuid, content, room_uuid, read, created_at FROM notifications WHERE user_uuid = ? ORDER BY created_at DESC, uuid DESC LIMIT ?",
      user.uuid, limits.counts.notifications);
    return json({ notifications: rows.map((n) => ({ uuid: n.uuid, content: n.content, room_uuid: n.room_uuid ?? null, read: Boolean(n.read), created_at: n.created_at })) });
  });

  // Reading happens by clicking: one notification read.
  router.on("POST", "/api/notifications/:uuid/read", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const found = await one(env.DB, "SELECT 1 FROM notifications WHERE uuid = ? AND user_uuid = ?", params.uuid, user.uuid);
    if (!found) refuse(404, "Notification not found");
    await statement(env.DB, "UPDATE notifications SET read = 1 WHERE uuid = ?", params.uuid).run();
    return json({ message: "Notification marked read" });
  });

  router.on("POST", "/api/notifications/read", async ({ request, env }) => {
    const user = await currentUser(request, env);
    await statement(env.DB, "UPDATE notifications SET read = 1 WHERE user_uuid = ? AND read = 0", user.uuid).run();
    return json({ message: "All notifications marked read" });
  });

  // ------------------------------------------------------ admin messages

  // Messages broadcast to this user that they have not dismissed.
  router.on("GET", "/api/admin-messages/pending", async ({ request, env }) => {
    const user = await currentUser(request, env);
    const rows = await all<Row>(env.DB,
      `SELECT m.uuid, m.content, m.created_at FROM admin_messages m JOIN admin_message_deliveries d ON d.message_uuid = m.uuid
       WHERE d.user_uuid = ? AND d.dismissed_at IS NULL ORDER BY m.created_at, m.uuid LIMIT ?`, user.uuid, limits.counts.notifications);
    return json(rows);
  });

  router.on("POST", "/api/admin-messages/:uuid/dismiss", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const delivery = await one<{ uuid: string; dismissed_at: string | null }>(env.DB,
      "SELECT uuid, dismissed_at FROM admin_message_deliveries WHERE message_uuid = ? AND user_uuid = ?", params.uuid, user.uuid);
    if (!delivery) refuse(404, "Message not found");
    // Idempotent, so a retry cannot make the message return.
    if (!delivery.dismissed_at) await statement(env.DB, "UPDATE admin_message_deliveries SET dismissed_at = ? WHERE uuid = ?", now(), delivery.uuid).run();
    return json({ message: "Admin message dismissed" });
  });

  // Broadcast a message to every account that exists when it is sent, or
  // to an audience the admin picked.
  router.on("POST", "/api/admin/messages", async ({ request, env }) => {
    const admin = await requireAdmin(request, env);
    const data = await readJson<Row>(request);
    const check = validate.checking();
    const given = check.string("content", data.content, { min: 1, max: limits.text.admin_message });
    if (data.user_uuids !== undefined && data.user_uuids !== null && (!Array.isArray(data.user_uuids) || !data.user_uuids.length)) check.fail("user_uuids must name at least one user");
    check.done();
    const content = given!.trim();
    if (!content) refuse(400, "Message cannot be empty");
    const recipients = await audienceOf(env, data.user_uuids);
    const message = { uuid: newUuid(), created_by_uuid: admin.uuid, content, created_at: now() };
    await batch(env.DB, [
      insert(env.DB, "admin_messages", message),
      ...recipients.map((r) => insert(env.DB, "admin_message_deliveries", { uuid: newUuid(), message_uuid: message.uuid, user_uuid: r.uuid, dismissed_at: null })),
    ]);
    return json({ uuid: message.uuid, content, created_at: message.created_at, recipient_count: recipients.length });
  });

  // Active accounts available to the admin message audience picker.
  router.on("GET", "/api/admin/message-recipients", async ({ request, env }) => {
    await requireAdmin(request, env);
    const users = await all<Row>(env.DB, "SELECT uuid, display_name, affiliation, avatar_path, email FROM users WHERE deleted_at IS NULL ORDER BY display_name, email, uuid");
    return json(users.map((u) => ({ ...userBase(u), email: u.email })));
  });

  // ------------------------------------------------------------ feedback

  // Report a bug or request a feature. Open to visitors too, so that a
  // user who cannot sign in can still say so. The report is stored and
  // every admin gets it as an inbox message and an email — the email as
  // a job, queued in the same batch as the report.
  router.on("POST", "/api/feedback", async ({ request, env }) => {
    const user = await optionalUser(request, env);
    const data = await readJson<Row>(request);
    const check = validate.checking();
    const content = check.string("content", data.content, { min: 1, max: limits.text.feedback });
    const page = check.string("page", data.page, { max: limits.text.feedback_page, optional: true });
    const contact = check.string("contact", data.contact, { max: limits.text.email, optional: true });
    check.done();
    const at = now();
    const fb = { uuid: newUuid(), user_uuid: user?.uuid ?? null, content: content!.trim(), page: page || null, contact: contact?.trim() || null, resolved: 0, created_at: at };
    const reporter = user ? `${user.display_name} <${user.email}>` : fb.contact ? `a visitor <${fb.contact}>` : "an anonymous visitor";
    const where = fb.page ? ` (from ${fb.page})` : "";
    const admins = await all<{ uuid: string; email: string }>(env.DB, "SELECT uuid, email FROM users WHERE is_admin = 1 AND deleted_at IS NULL");
    const headline = fb.content.split(/\r?\n/)[0].slice(0, limits.text.notification_email_headline);
    const body = [`Feedback from ${reporter}`, ...(fb.page ? [`Page: ${fb.page}`] : []), "", fb.content, "",
      `Reports are listed on the admin page: ${(await siteUrl(env)).replace(/\/$/, "")}/admin`, "", "— Papol"].join("\n");
    const statements: D1PreparedStatement[] = [insert(env.DB, "feedback", fb)];
    const wakeups: string[] = [];
    for (const admin of admins) {
      const notification = newUuid();
      statements.push(insert(env.DB, "notifications", { uuid: notification, user_uuid: admin.uuid, room_uuid: null, content: `Feedback from ${reporter}${where}:\n\n${fb.content}`, read: 0, emailed: 0, created_at: at }));
      const mail = queueEmail(env.DB, admin.email, `Papol feedback: ${headline}`, body, [notification]);
      statements.push(mail.statement);
      wakeups.push(mail.uuid);
    }
    await batch(env.DB, statements);
    await wake(env, wakeups);
    return json(feedbackOut(fb, user));
  });
}
