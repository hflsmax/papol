// The account: profile, picture, password, leaving with your things, and
// leaving.
import { env } from "cloudflare:test";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { call, count, defaultShelf, exec, ok, paperWithCopy, register, row, rows, uuid, type Account, type Json } from "./helpers";

const PDF = "c".repeat(64);
const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n%%EOF");

// Ada's nook: one paper with a note on the page, a note about the paper,
// a stroke and a clip; and Grace's stroke on the same PDF, which must survive.
async function adasNook(ada: Account, grace: Account) {
  await paperWithCopy(ada, PDF, "On leaving", { shelfUuid: await defaultShelf(ada) });
  await exec("UPDATE papers SET year = 2024, doi = '10.1234/leave' WHERE sha256 = ?", PDF);
  await env.FILES.put(`uploads/${PDF}.pdf`, PDF_BYTES);
  const at = (i: number) => new Date(Date.now() - 60_000 + i * 1000).toISOString();
  const marks: [Account, string, number | null, string, string | null, object][] = [
    [ada, "note", 4, "Placed here", "Lemma 2", { anchor: { type: "point", x: 0.2, y: 0.8 } }],
    [ada, "note", null, "About the paper", null, {}],
    [ada, "ink", 4, "", null, { points: [{ x: 0.1, y: 0.2 }, { x: 0.4, y: 0.2 }], color: "#d92b1f", width: 0.006, opacity: 0.8, shape: "round" }],
    [ada, "clip", 5, "", null, { source: { x: 0.1, y: 0.1, w: 0.3, h: 0.2 }, frame: { x: 0.5, y: 0.5, w: 0.3, h: 0.2 }, floating: true }],
    [grace, "ink", 4, "", null, { points: [{ x: 0.9, y: 0.9 }], color: "#b3923d", width: 0.004, opacity: 1.0, shape: "flat" }],
  ];
  for (const [i, [who, kind, page, content, name, body]] of marks.entries()) {
    await exec("INSERT INTO annotations (uuid, kind, user_uuid, paper_sha256, page, content, name, body, created_at, updated_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
      uuid(), kind, who.uuid, PDF, page, content, name, JSON.stringify(body), at(i), at(i));
  }
}

describe("the profile", () => {
  it("changes the name, the affiliation and whether the email shows, and nothing else", async () => {
    const ada = await register("ada@example.test", "Ada");
    const changed = await ok("PUT", "/api/auth/profile", { headers: ada.headers, json: { display_name: "  Ada L.  ", affiliation: " Analytical Engines ", email_public: false } });
    expect(changed).toMatchObject({ display_name: "Ada L.", affiliation: "Analytical Engines", email_public: false, email: "ada@example.test" });
    expect(await ok("GET", "/api/auth/me", { headers: ada.headers })).toMatchObject({ display_name: "Ada L.", email_public: false });
    // A field left out is left alone; an empty affiliation is none.
    expect(await ok("PUT", "/api/auth/profile", { headers: ada.headers, json: { affiliation: "" } })).toMatchObject({ display_name: "Ada L.", affiliation: null, email_public: false });
    expect((await call("PUT", "/api/auth/profile", { headers: ada.headers, json: { display_name: "  " } })).status).toBe(400);
    expect((await call("PUT", "/api/auth/profile", { headers: ada.headers, json: { display_name: "x".repeat(81) } })).status).toBe(422);
  });
});

describe("the password", () => {
  it("changes only when the current one is right and the new one is long enough", async () => {
    const ada = await register("ada@example.test", "Ada");
    expect((await call("PUT", "/api/auth/password", { headers: ada.headers, json: { current_password: "wrong", new_password: "another-password" } })).status).toBe(401);
    expect((await call("PUT", "/api/auth/password", { headers: ada.headers, json: { current_password: "testing-password", new_password: "short" } })).status).toBe(422);
    await ok("PUT", "/api/auth/password", { headers: ada.headers, json: { current_password: "testing-password", new_password: "another-password" } });
    expect((await call("POST", "/api/auth/login", { json: { email: "ada@example.test", password: "testing-password" } })).status).toBe(401);
    expect((await call("POST", "/api/auth/login", { json: { email: "ada@example.test", password: "another-password" } })).status).toBe(200);
  });
});

describe("the picture", () => {
  const upload = (account: Account, name: string, size = 4) => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array(size)], name));
    return call("POST", "/api/auth/avatar", { headers: account.headers, body: form });
  };

  it("is stored under a minted name, served, replaced, and removed", async () => {
    const ada = await register("ada@example.test", "Ada");
    expect((await upload(ada, "me.gif")).status).toBe(400);
    expect((await upload(ada, "me.png", 2 * 1024 * 1024 + 1)).status).toBe(400);

    const first = await (await upload(ada, "me.png")).json() as Json;
    expect(first.avatar_path).toMatch(/^avatars\/[0-9a-f-]{36}\.png$/);
    expect(await env.FILES.head(`uploads/${first.avatar_path}`)).not.toBeNull();
    const served = await call("GET", `/uploads/${first.avatar_path}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");

    const second = await (await upload(ada, "me.JPG")).json() as Json;
    expect(second.avatar_path).toMatch(/\.jpg$/);
    expect(await env.FILES.head(`uploads/${first.avatar_path}`)).toBeNull();
    expect(await env.FILES.head(`uploads/${second.avatar_path}`)).not.toBeNull();

    expect((await ok("DELETE", "/api/auth/avatar", { headers: ada.headers })).avatar_path).toBeNull();
    expect(await env.FILES.head(`uploads/${second.avatar_path}`)).toBeNull();
    expect((await ok("GET", "/api/auth/me", { headers: ada.headers })).avatar_path).toBeNull();
  });
});

describe("the export", () => {
  it("is a readable archive carrying every kind with its geometry, and the PDFs named after the papers", async () => {
    const ada = await register("leaver@example.com", "Ada"), grace = await register("stays@example.com", "Grace");
    await adasNook(ada, grace);
    const response = await call("GET", "/api/auth/export", { headers: ada.headers });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="papol-export-\d{4}-\d{2}-\d{2}\.zip"$/);
    const archive = unzipSync(new Uint8Array(await response.arrayBuffer()));
    const names = Object.keys(archive).map((n) => n.replace(/^papol-export-\d{4}-\d{2}-\d{2}\//, ""));
    expect(names).toEqual(expect.arrayContaining(["README.txt", "profile.json", "nook.json", "notes.json", "notes.md", "ink.json", "seminars.json", "notifications.json", "uploads.json", "boards.json", "pdfs/on-leaving-2024.pdf"]));
    const read = (name: string) => JSON.parse(new TextDecoder().decode(archive[Object.keys(archive).find((n) => n.endsWith(`/${name}`))!]));

    expect(read("profile.json")).toMatchObject({ email: "leaver@example.com", display_name: "Ada" });
    const notes = read("notes.json");
    expect(notes.map((n: Json) => n.content).sort()).toEqual(["About the paper", "Placed here"]);
    const placed = notes.find((n: Json) => n.content === "Placed here");
    expect(placed).toMatchObject({ page: 4, anchor: { type: "point", x: 0.2, y: 0.8 }, name: "Lemma 2", paper: { title: "On leaving", doi: "10.1234/leave" } });
    // A note never placed on a page says so rather than inventing a spot.
    expect(notes.find((n: Json) => n.content === "About the paper").anchor).toBeNull();
    const ink = read("ink.json");
    expect(ink).toHaveLength(1);
    expect(ink[0]).toMatchObject({ color: "#d92b1f", shape: "round", page: 4 });
    expect(ink[0].points).toHaveLength(2);
    expect(read("nook.json")).toEqual([expect.objectContaining({ paper: expect.objectContaining({ title: "On leaving" }), on_display: true, tags: [] })]);
    expect(new TextDecoder().decode(archive[Object.keys(archive).find((n) => n.endsWith("/notes.md"))!])).toContain("### Lemma 2 — page 4");
    expect(archive[Object.keys(archive).find((n) => n.endsWith("/pdfs/on-leaving-2024.pdf"))!]).toEqual(PDF_BYTES);
  });
});

describe("closing the account", () => {
  it("asks for the email, refuses the only admin, and then takes every annotation and no one else's", async () => {
    const ada = await register("leaver@example.com", "Ada"), grace = await register("stays@example.com", "Grace");
    await adasNook(ada, grace);
    expect((await call("DELETE", "/api/auth/account", { headers: ada.headers, json: { confirm_email: "someone@else.example" } })).status).toBe(400);
    await exec("UPDATE users SET is_admin = 1 WHERE uuid = ?", ada.uuid);
    const alone = await call("DELETE", "/api/auth/account", { headers: ada.headers, json: { confirm_email: "leaver@example.com" } });
    expect(alone.status).toBe(400);
    expect(((await alone.json()) as Json).detail).toContain("only admin");
    await exec("UPDATE users SET is_admin = 1 WHERE uuid = ?", grace.uuid);

    const avatar = (await ok("POST", "/api/auth/avatar", { headers: ada.headers, body: (() => { const f = new FormData(); f.set("file", new File([new Uint8Array(3)], "me.png")); return f; })() })).avatar_path;
    const closed = await ok("DELETE", "/api/auth/account", { headers: ada.headers, json: { confirm_email: " Leaver@example.com " } });
    expect(closed.removed).toMatchObject({ annotations: 4, papers_in_nook: 1, shelves: 2, tags: 1, sessions: 1, pdfs_kept: 1 });
    expect((await rows("SELECT user_uuid FROM annotations")).map((r) => r.user_uuid)).toEqual([grace.uuid]);

    // The row stays, with the person scrubbed out of it, and cannot be signed into.
    const tombstone = (await row("SELECT * FROM users WHERE uuid = ?", ada.uuid))!;
    expect(tombstone).toMatchObject({ display_name: "A former user", email: `deleted-${ada.uuid}@papol.invalid`, affiliation: null, avatar_path: null, is_admin: 0 });
    expect(tombstone.deleted_at).not.toBeNull();
    expect(await env.FILES.head(`uploads/${avatar}`)).toBeNull();
    expect((await call("GET", "/api/auth/me", { headers: ada.headers })).status).toBe(401);
    expect((await call("POST", "/api/auth/login", { json: { email: "leaver@example.com", password: "testing-password" } })).status).toBe(401);
    expect((await call("POST", "/api/auth/login", { json: { email: tombstone.email, password: "testing-password" } })).status).toBe(401);
    // The address is free again: the tombstone holds it no longer.
    expect((await call("POST", "/api/auth/register", { json: { email: "leaver@example.com", display_name: "Ada again", affiliation: null, password: "testing-password" } })).status).toBe(200);
    // The paper is nobody's: it and its PDF stay.
    expect(await count("papers", "sha256 = ?", PDF)).toBe(1);
    expect(await env.FILES.head(`uploads/${PDF}.pdf`)).not.toBeNull();
  });

  it("hands on the seminars the user was hosting, or reopens them when nobody in the cohort can lead", async () => {
    const ada = await register("leaver@example.com", "Ada"), grace = await register("stays@example.com", "Grace"), hidden = await register("hidden@example.com", "Hidden");
    await paperWithCopy(ada, PDF, "On leaving", { shelfUuid: await defaultShelf(ada) });
    await paperWithCopy(grace, "d".repeat(64), "Another", { shelfUuid: await defaultShelf(grace) });
    await exec("INSERT INTO copies (uuid, paper_sha256, user_uuid, shelf_uuid, is_author, created_at, updated_at, revision) VALUES (?, ?, ?, ?, 0, ?, ?, 0)",
      uuid(), PDF, grace.uuid, await defaultShelf(grace), new Date().toISOString(), new Date().toISOString());
    const at = new Date().toISOString();
    const room = async (paper: string, cohort: Account[], status = "planning") => {
      const id = uuid();
      await exec("INSERT INTO rooms (uuid, paper_sha256, created_by, leader_uuid, status, created_at) VALUES (?, ?, ?, ?, ?, ?)", id, paper, ada.uuid, ada.uuid, status, at);
      for (const [i, member] of [ada, ...cohort].entries()) {
        await exec("INSERT INTO room_participants (uuid, room_uuid, user_uuid, created_at) VALUES (?, ?, ?, ?)", uuid(), id, member.uuid, new Date(Date.now() - 10_000 + i * 1000).toISOString());
      }
      return id;
    };
    // Grace displays the paper, so she can lead; Hidden keeps no copy, so
    // the second seminar goes back to open; the finished one is history.
    const handed = await room(PDF, [hidden, grace]);
    const reopened = await room("d".repeat(64), [hidden]);
    const finished = await room(PDF, [grace], "finished");

    const closed = await ok("DELETE", "/api/auth/account", { headers: ada.headers, json: { confirm_email: "leaver@example.com" } });
    expect(closed.removed).toMatchObject({ seminars_handed_on: 1, seminars_reopened: 1, seminars_left: 3 });
    expect(await row("SELECT leader_uuid, status FROM rooms WHERE uuid = ?", handed)).toEqual({ leader_uuid: grace.uuid, status: "planning" });
    expect(await row("SELECT leader_uuid, status FROM rooms WHERE uuid = ?", reopened)).toEqual({ leader_uuid: null, status: "open" });
    expect(await row("SELECT leader_uuid, status FROM rooms WHERE uuid = ?", finished)).toEqual({ leader_uuid: ada.uuid, status: "finished" });
    expect((await rows("SELECT content FROM notifications WHERE user_uuid = ? AND room_uuid = ?", grace.uuid, handed)).map((n) => n.content)).toEqual([expect.stringContaining("yours to lead now")]);
    expect((await rows("SELECT content FROM notifications WHERE user_uuid = ? AND room_uuid = ?", hidden.uuid, reopened)).map((n) => n.content)).toEqual([expect.stringContaining("open again")]);
    expect(await count("room_participants", "user_uuid = ?", ada.uuid)).toBe(0);
  });
});
