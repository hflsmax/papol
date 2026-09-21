// Notifications, admin messages and feedback.
import { describe, expect, it } from "vitest";

import { call, count, exec, ok, register, rows, uuid } from "./helpers";

describe("notifications", () => {
  it("lists a user's own, newest first, and marks them read one at a time or all at once", async () => {
    const account = await register("reader@example.test", "Reader"), other = await register();
    const at = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
    await exec("INSERT INTO notifications (uuid, user_uuid, content, read, emailed, created_at) VALUES (?, ?, 'older', 0, 0, ?)", uuid(), account.uuid, at(2));
    const newer = uuid();
    await exec("INSERT INTO notifications (uuid, user_uuid, content, read, emailed, created_at) VALUES (?, ?, 'newer', 0, 0, ?)", newer, account.uuid, at(1));
    const listed = await ok("GET", "/api/notifications", { headers: account.headers });
    // The welcome from signing up is the newest of the three.
    expect(listed.notifications.map((n: any) => [n.content, n.read])).toEqual([[expect.stringContaining("Welcome"), false], ["newer", false], ["older", false]]);
    expect((await ok("GET", "/api/notifications", { headers: other.headers })).notifications.map((n: any) => n.content)).toEqual([expect.stringContaining("Welcome")]);

    await ok("POST", `/api/notifications/${newer}/read`, { headers: account.headers });
    expect((await ok("GET", "/api/notifications", { headers: account.headers })).notifications.map((n: any) => n.read)).toEqual([false, true, false]);
    expect((await call("POST", `/api/notifications/${newer}/read`, { headers: other.headers })).status).toBe(404);
    await ok("POST", "/api/notifications/read", { headers: account.headers });
    expect(await count("notifications", "user_uuid = ? AND read = 0", account.uuid)).toBe(0);
    expect(await count("notifications", "user_uuid = ? AND read = 0", other.uuid)).toBe(1);
  });
});

describe("admin messages", () => {
  it("are broadcast once to the accounts that exist, dismissed idempotently, and never reach a later user", async () => {
    const admin = await register("admin@example.com", "Admin"), user = await register("user@example.com", "User");
    await exec("UPDATE users SET is_admin = 1 WHERE uuid = ?", admin.uuid);
    expect((await call("POST", "/api/admin/messages", { headers: user.headers, json: { content: "Nope" } })).status).toBe(403);
    const sent = await ok("POST", "/api/admin/messages", { headers: admin.headers, json: { content: "  Papol will be read-only tonight.  " } });
    expect(sent).toMatchObject({ content: "Papol will be read-only tonight.", recipient_count: 2 });

    expect((await ok("GET", "/api/admin-messages/pending", { headers: user.headers })).map((m: any) => m.uuid)).toEqual([sent.uuid]);
    expect((await call("POST", `/api/admin-messages/${sent.uuid}/dismiss`, { headers: user.headers })).status).toBe(200);
    expect(await ok("GET", "/api/admin-messages/pending", { headers: user.headers })).toEqual([]);
    expect((await call("POST", `/api/admin-messages/${sent.uuid}/dismiss`, { headers: user.headers })).status).toBe(200);

    const late = await register("late@example.com", "Late user");
    expect(await ok("GET", "/api/admin-messages/pending", { headers: late.headers })).toEqual([]);
    expect((await call("POST", `/api/admin-messages/${sent.uuid}/dismiss`, { headers: late.headers })).status).toBe(404);

    const recipients = await ok("GET", "/api/admin/message-recipients", { headers: admin.headers });
    expect(new Set(recipients.map((u: any) => u.email))).toEqual(new Set(["admin@example.com", "user@example.com", "late@example.com"]));
    expect((await call("POST", "/api/admin/messages", { headers: admin.headers, json: { content: "To nobody", user_uuids: [uuid()] } })).status).toBe(400);
    expect((await call("POST", "/api/admin/messages", { headers: admin.headers, json: { content: "To nobody", user_uuids: [] } })).status).toBe(422);
    const targeted = await ok("POST", "/api/admin/messages", { headers: admin.headers, json: { content: "Just you", user_uuids: [late.uuid] } });
    expect(targeted.recipient_count).toBe(1);
    expect((await ok("GET", "/api/admin-messages/pending", { headers: late.headers })).map((m: any) => m.content)).toEqual(["Just you"]);
    expect((await ok("GET", "/api/admin-messages/pending", { headers: user.headers })).map((m: any) => m.content)).toEqual([]);
  });
});

describe("feedback", () => {
  it("is stored, put in every admin's inbox, and mailed to each by a job, from a user or a visitor", async () => {
    const admin = await register("admin@example.test", "Admin"), reporter = await register("reporter@example.test", "Reporter");
    await exec("UPDATE users SET is_admin = 1 WHERE uuid = ?", admin.uuid);
    const signedIn = await ok("POST", "/api/feedback", { headers: reporter.headers, json: { content: "The cow is upside down\nSecond line", page: "/library" } });
    expect(signedIn).toMatchObject({ content: "The cow is upside down\nSecond line", page: "/library", resolved: false, user: { uuid: reporter.uuid }, user_email: "reporter@example.test" });
    const anonymous = await ok("POST", "/api/feedback", { json: { content: "Cannot sign in", contact: " me@example.test " } });
    expect(anonymous).toMatchObject({ user: null, user_email: null, contact: "me@example.test" });
    expect(await count("feedback")).toBe(2);

    const inbox = (await rows("SELECT content FROM notifications WHERE user_uuid = ? AND content LIKE 'Feedback%' ORDER BY created_at", admin.uuid)).map((n) => n.content as string);
    expect(inbox[0]).toBe("Feedback from Reporter <reporter@example.test> (from /library):\n\nThe cow is upside down\nSecond line");
    expect(inbox[1]).toBe("Feedback from a visitor <me@example.test>:\n\nCannot sign in");
    const mail = (await rows("SELECT payload FROM jobs WHERE kind = 'send_email' ORDER BY created_at")).map((j) => JSON.parse(j.payload as string));
    expect(mail.map((m) => [m.to, m.subject])).toEqual([["admin@example.test", "Papol feedback: The cow is upside down"], ["admin@example.test", "Papol feedback: Cannot sign in"]]);
    expect(mail[0].body).toContain("Page: /library");
    expect(mail[0].notification_uuids).toHaveLength(1);
    expect((await call("POST", "/api/feedback", { json: { content: "" } })).status).toBe(422);
  });
});
