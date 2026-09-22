// The account: profile, picture, password, leaving with your things, and
// leaving.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import worker from "../src/index";
import { call, count, defaultShelf, exec, ok, paperWithCopy, register, row, rows, uuid, type Account, type Json } from "./helpers";


// A tar, read back: each entry a 512-byte header naming and sizing the
// bytes that follow, padded to the block; two empty blocks at the end.
function untar(bytes: Uint8Array): Record<string, Uint8Array> {
  const decoder = new TextDecoder();
  const field = (block: Uint8Array, offset: number, length: number) => decoder.decode(block.subarray(offset, offset + length)).replace(/\0.*$/s, "");
  const entries: Record<string, Uint8Array> = {};
  for (let at = 0; at + 512 <= bytes.length;) {
    const block = bytes.subarray(at, at + 512);
    if (block.every((b) => b === 0)) break;
    const size = parseInt(field(block, 124, 12), 8);
    const prefix = field(block, 345, 155);
    const name = (prefix ? `${prefix}/` : "") + field(block, 0, 100);
    const claimed = parseInt(field(block, 148, 8), 8);
    const summed = block.reduce((a, b, i) => a + (i >= 148 && i < 156 ? 32 : b), 0);
    if (claimed !== summed) throw new Error(`bad header checksum for ${name}`);
    entries[name] = bytes.slice(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

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
  it("is a readable tar carrying every kind with its geometry, and naming the files with where each lives", async () => {
    const ada = await register("leaver@example.com", "Ada"), grace = await register("stays@example.com", "Grace");
    await adasNook(ada, grace);
    const avatar = (await ok("POST", "/api/auth/avatar", { headers: ada.headers, body: (() => { const f = new FormData(); f.set("file", new File([new Uint8Array(3)], "me.png")); return f; })() })).avatar_path;
    const board = uuid(), item = uuid(), at = new Date().toISOString();
    await exec("INSERT INTO boards (uuid, user_uuid, name, created_at, updated_at, revision) VALUES (?, ?, 'Clippings', ?, ?, 0)", board, ada.uuid, at, at);
    await exec("INSERT INTO board_items (uuid, board_uuid, kind, file_path, original_filename, mime_type, created_at, updated_at, revision) VALUES (?, ?, 'image', ?, 'photo.png', 'image/png', ?, ?, 0)", item, board, `${board}/photo.png`, at, at);
    await env.FILES.put(`board_uploads/${board}/photo.png`, new Uint8Array(4));
    // A paper whose PDF the store no longer has is in the data and not among the files.
    await paperWithCopy(ada, "d".repeat(64), "Lost", { shelfUuid: await defaultShelf(ada) });
    const response = await call("GET", "/api/auth/export", { headers: ada.headers });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/x-tar");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="papol-export-\d{4}-\d{2}-\d{2}\.tar"$/);
    const archive = untar(new Uint8Array(await response.arrayBuffer()));
    const names = Object.keys(archive).map((n) => n.replace(/^papol-export-\d{4}-\d{2}-\d{2}\//, ""));
    expect(names).toEqual(expect.arrayContaining(["README.txt", "profile.json", "nook.json", "notes.json", "notes.md", "ink.json", "seminars.json", "notifications.json", "uploads.json", "boards.json", "files.json"]));
    // The files themselves are not in it: the browser fetches them.
    expect(names.filter((n) => /^(pdfs|board-files|avatar)/.test(n))).toEqual([]);
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
    expect(read("nook.json")).toEqual([expect.objectContaining({ paper: expect.objectContaining({ title: "On leaving" }), on_display: true, tags: [] }), expect.objectContaining({ paper: expect.objectContaining({ title: "Lost" }) })]);
    expect(new TextDecoder().decode(archive[Object.keys(archive).find((n) => n.endsWith("/notes.md"))!])).toContain("### Lemma 2 — page 4");
    expect(read("files.json")).toEqual([
      { path: "avatar.png", url: `/uploads/${avatar}`, size: 3 },
      { path: "pdfs/on-leaving-2024.pdf", url: `/uploads/${PDF}.pdf`, size: PDF_BYTES.length },
      { path: `board-files/${board}/${item}-photo.png`, url: `/api/board-items/${item}/file`, size: 4 },
    ]);
    expect(new TextDecoder().decode(archive[Object.keys(archive).find((n) => n.endsWith("/README.txt"))!])).toContain("files.json");
  });

  it("names the bucket's own address for every file when the bucket has one", async () => {
    const ada = await register("leaver@example.com", "Ada"), grace = await register("stays@example.com", "Grace");
    await adasNook(ada, grace);
    const avatar = (await ok("POST", "/api/auth/avatar", { headers: ada.headers, body: (() => { const f = new FormData(); f.set("file", new File([new Uint8Array(3)], "me.png")); return f; })() })).avatar_path;
    const board = uuid(), item = uuid(), at = new Date().toISOString();
    await exec("INSERT INTO boards (uuid, user_uuid, name, created_at, updated_at, revision) VALUES (?, ?, 'Clippings', ?, ?, 0)", board, ada.uuid, at, at);
    await exec("INSERT INTO board_items (uuid, board_uuid, kind, file_path, original_filename, mime_type, created_at, updated_at, revision) VALUES (?, ?, 'image', ?, 'photo.png', 'image/png', ?, ?, 0)", item, board, `${board}/photo.png`, at, at);
    await env.FILES.put(`board_uploads/${board}/photo.png`, new Uint8Array(4));
    const response = await worker.fetch(new Request("https://papol.test/api/auth/export", { headers: ada.headers }), { ...env, FILES_URL: "https://files.test" as string } as Env);
    expect(response.status).toBe(200);
    const archive = untar(new Uint8Array(await response.arrayBuffer()));
    const files = JSON.parse(new TextDecoder().decode(archive[Object.keys(archive).find((n) => n.endsWith("/files.json"))!]));
    expect(files).toEqual([
      { path: "avatar.png", url: `https://files.test/uploads/${avatar}`, size: 3 },
      { path: "pdfs/on-leaving-2024.pdf", url: `https://files.test/uploads/${PDF}.pdf`, size: PDF_BYTES.length },
      { path: `board-files/${board}/${item}-photo.png`, url: `https://files.test/board_uploads/${board}/photo.png`, size: 4 },
    ]);
  });
});

describe("a closed account's board files", () => {
  // A card with a file on one of the user's boards, the file in the bucket
  // under its digest, as every board file is.
  async function card(owner: Account, bytes: string, extra: Record<string, unknown> = {}) {
    const board = uuid(), item = uuid(), at = new Date().toISOString();
    const digest = await (async () => { const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(bytes)); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join(""); })();
    await exec("INSERT INTO boards (uuid, user_uuid, name, created_at, updated_at, revision) VALUES (?, ?, 'Board', ?, ?, 0)", board, owner.uuid, at, at);
    await exec("INSERT INTO board_items (uuid, board_uuid, kind, file_path, sha256, original_filename, mime_type, deleted_at, created_at, updated_at, revision) VALUES (?, ?, 'image', ?, ?, 'photo.png', 'image/png', ?, ?, ?, 0)",
      item, board, `blobs/${digest}`, digest, extra.deleted_at ?? null, at, at);
    await env.FILES.put(`board_uploads/blobs/${digest}`, bytes);
    return { board, item, digest, key: `board_uploads/blobs/${digest}` };
  }
  const close = (who: Account) => ok("DELETE", "/api/auth/account", { headers: who.headers, json: { confirm_email: who.email } });

  it("go with the account when nobody else's card names them, and stay while one does, deleted or not", async () => {
    const ada = await register("leaver@example.com", "Ada"), grace = await register("stays@example.com", "Grace");
    const own = await card(ada, "only Ada's");
    const shared = await card(ada, "on both boards");
    await card(grace, "on both boards");
    // Grace let this one go; she may restore it, so its bytes stay.
    const letGo = await card(ada, "Grace let it go");
    await card(grace, "Grace let it go", { deleted_at: new Date().toISOString() });
    // A legacy key, named for one write and nobody else's.
    const legacyBoard = uuid(), legacyItem = uuid(), at = new Date().toISOString();
    await exec("INSERT INTO boards (uuid, user_uuid, name, created_at, updated_at, revision) VALUES (?, ?, 'Old', ?, ?, 0)", legacyBoard, ada.uuid, at, at);
    await exec("INSERT INTO board_items (uuid, board_uuid, kind, file_path, original_filename, mime_type, created_at, updated_at, revision) VALUES (?, ?, 'image', ?, 'old.png', 'image/png', ?, ?, 0)", legacyItem, legacyBoard, `${legacyBoard}/old.png`, at, at);
    await env.FILES.put(`board_uploads/${legacyBoard}/old.png`, "old");

    const closed = await close(ada);
    expect(closed.removed).toMatchObject({ board_items: 4, boards: 4, board_files: 2 });
    expect(await env.FILES.head(own.key)).toBeNull();
    expect(await env.FILES.head(`board_uploads/${legacyBoard}/old.png`)).toBeNull();
    expect(await env.FILES.head(shared.key)).not.toBeNull();
    expect(await env.FILES.head(letGo.key)).not.toBeNull();

    // The last card to name a file takes it with it.
    const last = await close(grace);
    expect(last.removed).toMatchObject({ board_items: 2, board_files: 2 });
    expect(await env.FILES.head(shared.key)).toBeNull();
    expect(await env.FILES.head(letGo.key)).toBeNull();
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
