// Seminar rooms through the API: test_seminar_transitions.py, asked of
// the Worker, plus the cohort's messages, availability and a host
// handing on.
import { describe, expect, it } from "vitest";

import { call, count, defaultShelf, exec, ok, paperWithCopy, register, row, rows, type Account } from "./helpers";

const DIGEST = "5".repeat(64);
const NAME = DIGEST.slice(0, 32);

async function displaying(email?: string, digest = DIGEST, title = "State Machines for Seminars"): Promise<Account> {
  const account = await register(email);
  const paper = await row("SELECT 1 FROM papers WHERE sha256 = ?", digest);
  if (paper) {
    await exec("INSERT INTO copies (uuid, paper_sha256, user_uuid, shelf_uuid, is_author, created_at, updated_at, revision) VALUES (?, ?, ?, ?, 0, ?, ?, 0)",
      crypto.randomUUID(), digest, account.uuid, await defaultShelf(account), new Date().toISOString(), new Date().toISOString());
  } else {
    await paperWithCopy(account, digest, title, { shelfUuid: await defaultShelf(account) });
  }
  return account;
}

const call_ = (account: Account, name = NAME) => ok("POST", `/api/papers/${name}/room`, { headers: account.headers });

describe("a seminar's way", () => {
  it("goes from open to planning to scheduled to finished", async () => {
    const host = await displaying();
    const called = await call_(host);
    expect(called.status).toBe("open");
    expect(called.participants.map((p: any) => p.uuid)).toEqual([host.uuid]);
    const planning = await ok("POST", `/api/rooms/${called.uuid}/lead`, { headers: host.headers });
    expect(planning).toMatchObject({ status: "planning", leader: { uuid: host.uuid }, paper_title: "State Machines for Seminars", viewer_copy_is_public: true });
    const scheduled = await ok("PUT", `/api/rooms/${called.uuid}/announce`, { headers: host.headers,
      json: { scheduled_time: "Friday at 16:00", platform: "Seminar room 2.13", style: "discussion", style_desc: null } });
    expect(scheduled).toMatchObject({ status: "scheduled", scheduled_time: "Friday at 16:00", platform: "Seminar room 2.13", style: "discussion" });
    const finished = await ok("POST", `/api/rooms/${called.uuid}/finish`, { headers: host.headers });
    expect(finished.status).toBe("finished");
    expect((await ok("GET", `/api/papers/${NAME}`, { headers: host.headers })).rooms[0].status).toBe("finished");
  });

  it("lets the host step back to an open call, and only the host finish", async () => {
    const host = await displaying();
    const called = await call_(host);
    await ok("POST", `/api/rooms/${called.uuid}/lead`, { headers: host.headers });
    const reopened = await ok("POST", `/api/rooms/${called.uuid}/unhost`, { headers: host.headers });
    expect(reopened.status).toBe("open");
    expect(reopened.leader).toBeNull();
    expect((await call("POST", `/api/rooms/${called.uuid}/finish`, { headers: host.headers })).status).toBe(403);
  });

  it("is uncalled by its caller while alone, or once the cohort has emptied, and not after someone joins", async () => {
    const caller = await displaying();
    const called = await call_(caller);
    expect((await ok("POST", `/api/rooms/${called.uuid}/uncall`, { headers: caller.headers })).message).toBe("Seminar uncalled");
    expect((await call("GET", `/api/rooms/${called.uuid}`, { headers: caller.headers })).status).toBe(404);
    expect(await count("rooms")).toBe(0);

    const again = await call_(caller);
    await ok("POST", `/api/rooms/${again.uuid}/leave`, { headers: caller.headers });
    expect((await ok("POST", `/api/rooms/${again.uuid}/uncall`, { headers: caller.headers })).message).toBe("Seminar uncalled");

    const third = await call_(caller);
    const other = await displaying("user@example.test");
    expect((await call("POST", `/api/rooms/${third.uuid}/join`, { headers: other.headers })).status).toBe(200);
    const refused = await call("POST", `/api/rooms/${third.uuid}/uncall`, { headers: caller.headers });
    expect(refused.status).toBe(400);
    expect((await refused.json<any>()).detail).toContain("no one else");
    expect((await call("POST", `/api/rooms/${third.uuid}/uncall`, { headers: other.headers })).status).toBe(403);
  });

  it("names its paper by the paper's own name, which a correction does not move", async () => {
    const host = await displaying();
    const called = await call_(host);
    await ok("PUT", `/api/papers/${NAME}`, { headers: host.headers, json: { title: "State Machines for Seminars (Corrected)", doi: "10.1234/corrected" } });
    expect((await ok("GET", `/api/papers/${NAME}`, { headers: host.headers })).rooms.map((r: any) => r.uuid)).toEqual([called.uuid]);
    const detail = await ok("GET", `/api/rooms/${called.uuid}`, { headers: host.headers });
    expect(detail).toMatchObject({ paper_sha256: DIGEST, viewer_copy_is_public: true, paper_title: "State Machines for Seminars (Corrected)" });
    const twice = await call("POST", `/api/papers/${NAME}/room`, { headers: host.headers });
    expect(twice.status).toBe(400);
    expect((await twice.json<any>()).detail).toContain("already being organized");
    expect(await row("SELECT paper_sha256 FROM rooms WHERE uuid = ?", called.uuid)).toEqual({ paper_sha256: DIGEST });
  });

  it("gives two papers printing one title a seminar each", async () => {
    const host = await displaying();
    const twin = "6".repeat(64);
    await paperWithCopy(host, twin, "State Machines for Seminars", { shelfUuid: await defaultShelf(host), filePath: "preprint.pdf" });
    const published = await call_(host), preprint = await call_(host, twin.slice(0, 32));
    expect(published.uuid).not.toBe(preprint.uuid);
    expect((await ok("GET", `/api/papers/${NAME}`, { headers: host.headers })).rooms.map((r: any) => r.uuid)).toEqual([published.uuid]);
    expect((await ok("GET", `/api/papers/${twin.slice(0, 32)}`, { headers: host.headers })).rooms.map((r: any) => r.uuid)).toEqual([preprint.uuid]);
  });

  it("reads a hidden copy in the cohort by the paper's own name", async () => {
    const host = await displaying();
    const called = await call_(host);
    const privateShelf = (await row("SELECT uuid FROM shelves WHERE user_uuid = ? AND is_public = 0", host.uuid))!.uuid;
    await exec("UPDATE copies SET shelf_uuid = ? WHERE user_uuid = ?", privateShelf, host.uuid);
    expect((await ok("GET", `/api/rooms/${called.uuid}`, { headers: host.headers })).viewer_copy_is_public).toBe(false);
  });
});

describe("the cohort", () => {
  it("is for those displaying the paper, tells every keeper, and takes messages and availability from members", async () => {
    const caller = await displaying("caller@example.test");
    const hidden = await register("hidden@example.test");
    const privateShelf = (await row("SELECT uuid FROM shelves WHERE user_uuid = ? AND is_public = 0", hidden.uuid))!.uuid;
    await exec("INSERT INTO copies (uuid, paper_sha256, user_uuid, shelf_uuid, is_author, created_at, updated_at, revision) VALUES (?, ?, ?, ?, 0, ?, ?, 0)",
      crypto.randomUUID(), DIGEST, hidden.uuid, privateShelf, new Date().toISOString(), new Date().toISOString());
    const outsider = await register("outsider@example.test");
    const called = await call_(caller);
    // Every keeper but the caller was told, the hidden one included.
    expect((await rows("SELECT user_uuid FROM notifications WHERE room_uuid = ?", called.uuid)).map((n) => n.user_uuid)).toEqual([hidden.uuid]);
    expect((await call("POST", `/api/rooms/${called.uuid}/join`, { headers: hidden.headers })).status).toBe(403);
    expect((await call("POST", `/api/rooms/${called.uuid}/join`, { headers: outsider.headers })).status).toBe(403);
    expect((await call("POST", `/api/papers/${NAME}/room`, { headers: outsider.headers })).status).toBe(403);

    const member = await displaying("member@example.test");
    expect((await call("POST", `/api/rooms/${called.uuid}/messages`, { headers: member.headers, json: { content: "before joining" } })).status).toBe(400);
    await ok("POST", `/api/rooms/${called.uuid}/join`, { headers: member.headers });
    await ok("POST", `/api/rooms/${called.uuid}/join`, { headers: member.headers }); // twice is once
    expect(await count("room_participants", "room_uuid = ?", called.uuid)).toBe(2);
    const spoken = await ok("POST", `/api/rooms/${called.uuid}/messages`, { headers: member.headers, json: { content: "  Thursday works  " } });
    expect(spoken.messages.map((m: any) => [m.content, m.user.uuid])).toEqual([["Thursday works", member.uuid]]);
    let shared = await ok("POST", `/api/rooms/${called.uuid}/availability`, { headers: member.headers, json: { availability: "Thu, Fri" } });
    shared = await ok("POST", `/api/rooms/${called.uuid}/availability`, { headers: member.headers, json: { availability: "Fri only" } });
    expect(shared.availabilities.map((a: any) => a.availability)).toEqual(["Fri only"]);
    expect((await call("POST", `/api/rooms/${called.uuid}/messages`, { headers: member.headers, json: { content: "" } })).status).toBe(422);
  });

  it("makes a leaving host hand the seminar to a cohort member who displays the paper", async () => {
    const host = await displaying("host@example.test");
    const called = await call_(host);
    const member = await displaying("member@example.test");
    await ok("POST", `/api/rooms/${called.uuid}/join`, { headers: member.headers });
    await ok("POST", `/api/rooms/${called.uuid}/lead`, { headers: host.headers });
    expect((await call("POST", `/api/rooms/${called.uuid}/lead`, { headers: member.headers })).status).toBe(400);
    expect((await call("POST", `/api/rooms/${called.uuid}/leave`, { headers: host.headers })).status).toBe(400);
    expect((await call("POST", `/api/rooms/${called.uuid}/leave`, { headers: host.headers, json: { successor_uuid: host.uuid } })).status).toBe(400);
    const handed = await ok("POST", `/api/rooms/${called.uuid}/leave`, { headers: host.headers, json: { successor_uuid: member.uuid } });
    expect(handed.leader.uuid).toBe(member.uuid);
    expect(handed.participants.map((p: any) => p.uuid)).toEqual([member.uuid]);
    expect((await rows("SELECT content FROM notifications WHERE user_uuid = ? AND room_uuid = ?", member.uuid, called.uuid)).map((n) => n.content))
      .toEqual(expect.arrayContaining([expect.stringContaining("handed you hosting")]));
    expect((await call("PUT", `/api/rooms/${called.uuid}/announce`, { headers: host.headers, json: { scheduled_time: "x", platform: "y", style: "z" } })).status).toBe(403);
    expect((await call("POST", `/api/rooms/${called.uuid}/leave`, { headers: host.headers })).status).toBe(400);
  });

  it("stops taking availability once scheduled, and tells the cohort of an update", async () => {
    const host = await displaying("host@example.test");
    const called = await call_(host);
    await ok("POST", `/api/rooms/${called.uuid}/lead`, { headers: host.headers });
    const member = await displaying("member@example.test");
    await ok("POST", `/api/rooms/${called.uuid}/join`, { headers: member.headers });
    await ok("PUT", `/api/rooms/${called.uuid}/announce`, { headers: host.headers, json: { scheduled_time: "Fri 16:00", platform: "Room 1", style: "custom", style_desc: " Round table " } });
    expect((await call("POST", `/api/rooms/${called.uuid}/availability`, { headers: member.headers, json: { availability: "later" } })).status).toBe(400);
    const updated = await ok("PUT", `/api/rooms/${called.uuid}/announce`, { headers: host.headers, json: { scheduled_time: "Fri 17:00", platform: "Room 2", style: "custom", style_desc: "Round table" } });
    expect(updated).toMatchObject({ status: "scheduled", scheduled_time: "Fri 17:00", style_desc: "Round table" });
    const told = (await rows("SELECT content FROM notifications WHERE user_uuid = ? AND room_uuid = ? ORDER BY created_at", member.uuid, called.uuid)).map((n) => n.content as string);
    expect(told.some((c) => c.includes("scheduled: Fri 16:00"))).toBe(true);
    expect(told.some((c) => c.includes("updated: Fri 17:00"))).toBe(true);
  });
});
