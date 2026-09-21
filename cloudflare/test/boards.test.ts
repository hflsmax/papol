// Boards through the API, and the cards whose pictures are jobs. The
// board-route cases of test_desktop_sync.py, test_board_group_booklets.py
// and the capture cases of test_jobs.py, asked of the Worker.
import { createExecutionContext, createMessageBatch, env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

import worker from "../src/index";
import { capturers } from "../src/jobs/capture";
import type { Wakeup } from "../src/jobs/run";
import { call, count, mutation, ok, pushed, register, row, rows, uuid, type Account } from "./helpers";

const original = { ...capturers };
afterEach(() => Object.assign(capturers, original));

async function woken(...uuids: string[]) {
  const batch = createMessageBatch<Wakeup>("papol-jobs", uuids.map((id) => ({ id: uuid(), timestamp: new Date(), body: { job: id }, attempts: 1 })));
  await worker.queue(batch, env, createExecutionContext());
}

function upload(account: Account, path: string, file: { name: string; bytes: string; type: string }, fields: Record<string, string> = {}) {
  const data = new FormData();
  data.append("file", new File([file.bytes], file.name, { type: file.type }));
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return call("POST", path, { headers: account.headers, body: data });
}

describe("boards", () => {
  it("makes a board on the default shelf, lists it, edits it, and deletes it with its cards", async () => {
    const account = await register();
    const board = await ok("POST", "/api/boards", { headers: account.headers, json: { name: "  Offline board ", description: "" } });
    expect(board).toMatchObject({ name: "Offline board", description: null, can_edit: true, item_count: 0, revision: 1 });
    expect(board.owner.uuid).toBe(account.uuid);
    expect(board.shelf_uuid).toBe((await row("SELECT uuid FROM shelves WHERE user_uuid = ? AND is_default = 1", account.uuid))!.uuid);
    expect((await ok("GET", "/api/boards", { headers: account.headers })).map((b: any) => b.uuid)).toEqual([board.uuid]);

    const renamed = await ok("PUT", `/api/boards/${board.uuid}`, { headers: account.headers, json: { name: "Renamed", description: "About it" } });
    expect(renamed).toMatchObject({ name: "Renamed", description: "About it", revision: 2 });
    expect((await call("PUT", `/api/boards/${board.uuid}`, { headers: account.headers, json: { name: "" } })).status).toBe(422);
    expect((await call("PUT", `/api/boards/${board.uuid}`, { headers: account.headers, json: { shelf_uuid: uuid() } })).status).toBe(400);

    await ok("POST", `/api/boards/${board.uuid}/comments`, { headers: account.headers, json: { content: "A card" } });
    expect((await call("DELETE", `/api/boards/${board.uuid}`, { headers: account.headers })).status).toBe(204);
    expect((await call("GET", `/api/boards/${board.uuid}`, { headers: account.headers })).status).toBe(404);
    expect(await count("board_items", "deleted_at IS NOT NULL")).toBe(1);
    // A replica hears of the board and its card, twice each: made, then deleted.
    expect(await count("_server_change_log", "user_uuid = ?", account.uuid)).toBe(5);
  });

  it("shows a board on a public shelf to others, read-only, and hides a private one", async () => {
    const owner = await register(), other = await register();
    const board = await ok("POST", "/api/boards", { headers: owner.headers, json: { name: "Shown" } });
    const seen = await ok("GET", `/api/boards/${board.uuid}`, { headers: other.headers });
    expect(seen.can_edit).toBe(false);
    expect((await ok("GET", "/api/library/boards", { headers: other.headers })).map((b: any) => b.uuid)).toEqual([board.uuid]);
    const privateShelf = (await row("SELECT uuid FROM shelves WHERE user_uuid = ? AND is_public = 0", owner.uuid))!.uuid;
    await ok("PUT", `/api/boards/${board.uuid}`, { headers: owner.headers, json: { shelf_uuid: privateShelf } });
    expect((await call("GET", `/api/boards/${board.uuid}`, { headers: other.headers })).status).toBe(404);
    expect((await call("PUT", `/api/boards/${board.uuid}`, { headers: other.headers, json: { name: "Mine now" } })).status).toBe(404);
    expect(await ok("GET", "/api/library/boards", { headers: other.headers })).toEqual([]);
  });

  it("answers every id-bearing response the client's ordered remapping needs", async () => {
    const account = await register();
    const board = await ok("POST", "/api/boards", { headers: account.headers, json: { name: "Offline board" } });
    const first = await ok("POST", `/api/boards/${board.uuid}/comments`, { headers: account.headers, json: { content: "first", x: 1, y: 2 } });
    const second = await ok("POST", `/api/boards/${board.uuid}/comments`, { headers: account.headers, json: { content: "second", x: 10, y: 20 } });
    const moved = await ok("PUT", `/api/board-items/${first.uuid}`, { headers: account.headers, json: { x: 30, y: 40 } });
    const group = await ok("POST", `/api/boards/${board.uuid}/groups`, {
      headers: account.headers, json: { kind: "collection", title: "Synced", item_uuids: [first.uuid, second.uuid] },
    });
    expect([moved.x, moved.y]).toEqual([30, 40]);
    expect(group.item_uuids).toEqual([first.uuid, second.uuid]);
    const fetched = await ok("GET", `/api/boards/${board.uuid}`, { headers: account.headers });
    expect(new Set(fetched.items.map((i: any) => i.uuid))).toEqual(new Set([first.uuid, second.uuid]));
    expect(fetched.groups[0].uuid).toBe(group.uuid);
    expect(fetched.items[0].staged).toBe(false);
    for (const item of fetched.items) for (const key of Object.keys(item)) expect(key.endsWith("_id")).toBe(false);
  });

  it("stores a board file privately and immutably, named for the download", async () => {
    const account = await register(), other = await register();
    const board = await ok("POST", "/api/boards", { headers: account.headers, json: { name: "Image cache" } });
    const response = await upload(account, `/api/boards/${board.uuid}/files`, { name: "diagram.png", bytes: "image bytes", type: "image/png" }, { caption: "Figure 1" });
    expect(response.status, await response.clone().text()).toBe(200);
    const item = await response.json<any>();
    expect(item).toMatchObject({ kind: "image", content: "Figure 1", original_filename: "diagram.png", mime_type: "image/png" });
    const served = await call("GET", `/api/board-items/${item.uuid}/file`, { headers: account.headers });
    expect(served.status).toBe(200);
    expect(await served.text()).toBe("image bytes");
    expect(served.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(served.headers.get("content-disposition")).toBe('attachment; filename="diagram.png"');
    expect(served.headers.get("content-type")).toBe("image/png");
    // On the default (public) shelf, the file is anyone's to see.
    expect((await call("GET", `/api/board-items/${item.uuid}/file`, { headers: other.headers })).status).toBe(200);
    const privateShelf = (await row("SELECT uuid FROM shelves WHERE user_uuid = ? AND is_public = 0", account.uuid))!.uuid;
    await ok("PUT", `/api/boards/${board.uuid}`, { headers: account.headers, json: { shelf_uuid: privateShelf } });
    expect((await call("GET", `/api/board-items/${item.uuid}/file`, { headers: other.headers })).status).toBe(404);
  });

  it("stages an excerpt and a clip, then places them", async () => {
    const account = await register();
    const board = await ok("POST", "/api/boards", { headers: account.headers, json: { name: "Reading" } });
    const excerpt = await ok("POST", `/api/boards/${board.uuid}/staging`, {
      headers: account.headers, json: { excerpt_text: "A quoted line", source_url: "https://papol.test/paper/abc", source_label: "p. 3" },
    });
    expect(excerpt).toMatchObject({ kind: "excerpt", staged: true, excerpt_text: "A quoted line" });
    const clipped = await upload(account, `/api/boards/${board.uuid}/staging/clip`, { name: "clip.png", bytes: "png", type: "image/png" },
      { caption: "Fig", source_url: "https://papol.test/paper/abc", source_label: "p. 4" });
    expect(clipped.status, await clipped.clone().text()).toBe(200);
    const clip = await clipped.json<any>();
    expect(clip).toMatchObject({ kind: "image", staged: true, original_filename: "paper-clip.png", source_label: "p. 4" });
    const before = await ok("GET", `/api/boards/${board.uuid}`, { headers: account.headers });
    expect(before.items).toEqual([]);
    expect(before.staged_items.map((i: any) => i.uuid).sort()).toEqual([excerpt.uuid, clip.uuid].sort());
    const placed = await ok("POST", `/api/board-items/${excerpt.uuid}/place`, { headers: account.headers, json: { x: 5, y: 6 } });
    expect(placed).toMatchObject({ staged: false, x: 5, y: 6 });
    expect((await call("POST", `/api/board-items/${excerpt.uuid}/place`, { headers: account.headers, json: { x: 0, y: 0 } })).status).toBe(404);
    expect((await call("POST", `/api/boards/${board.uuid}/staging/clip`, { headers: account.headers, json: {} })).status).toBe(422);
  });

  it("groups cards into a booklet aligned on the leftmost, moves, edits, lays out and ungroups them", async () => {
    const account = await register();
    const board = await ok("POST", "/api/boards", { headers: account.headers, json: { name: "Grouped" } });
    const a = await ok("POST", `/api/boards/${board.uuid}/comments`, { headers: account.headers, json: { content: "a", x: 100, y: 0 } });
    const b = await ok("POST", `/api/boards/${board.uuid}/comments`, { headers: account.headers, json: { content: "b", x: 40, y: 300 } });
    expect((await call("POST", `/api/boards/${board.uuid}/groups`, { headers: account.headers, json: { item_uuids: [a.uuid] } })).status).toBe(422);
    expect((await call("POST", `/api/boards/${board.uuid}/groups`, { headers: account.headers, json: { kind: "stack", item_uuids: [a.uuid, b.uuid] } })).status).toBe(422);
    const group = await ok("POST", `/api/boards/${board.uuid}/groups`, { headers: account.headers, json: { item_uuids: [a.uuid, b.uuid], auto_arrange: true } });
    // Booklet is the default kind, and never auto-arranges.
    expect(group).toMatchObject({ kind: "booklet", auto_arrange: false, header: "" });
    const shown = await ok("GET", `/api/boards/${board.uuid}`, { headers: account.headers });
    expect(shown.items.map((i: any) => i.x)).toEqual([40, 40]);

    const moved = await ok("PUT", `/api/board-groups/${group.uuid}/move`, { headers: account.headers, json: { dx: 10, dy: -5 } });
    expect(moved.map((i: any) => [i.x, i.y])).toEqual([[50, -5], [50, 295]]);
    expect((await call("PUT", `/api/board-groups/${group.uuid}`, { headers: account.headers, json: { auto_arrange: true } })).status).toBe(400);
    const retitled = await ok("PUT", `/api/board-groups/${group.uuid}`, { headers: account.headers, json: { title: " Chapter ", header: "Intro" } });
    expect(retitled).toMatchObject({ title: "Chapter", header: "Intro", item_uuids: [a.uuid, b.uuid] });
    const laid = await ok("PUT", `/api/board-groups/${group.uuid}/layout`, { headers: account.headers, json: { items: [{ uuid: a.uuid, x: 1, y: 2 }, { uuid: b.uuid, x: 3, y: 4 }] } });
    expect(laid.map((i: any) => [i.x, i.y])).toEqual([[1, 2], [3, 4]]);
    expect((await call("PUT", `/api/board-groups/${group.uuid}/layout`, { headers: account.headers, json: { items: [{ uuid: a.uuid, x: 1, y: 2 }] } })).status).toBe(400);

    expect((await call("POST", `/api/board-groups/${group.uuid}/ungroup`, { headers: account.headers, json: { items: [{ uuid: a.uuid, x: 0, y: 0 }, { uuid: uuid(), x: 0, y: 0 }] } })).status).toBe(400);
    expect((await call("POST", `/api/board-groups/${group.uuid}/ungroup`, { headers: account.headers, json: { items: [{ uuid: a.uuid, group_uuid: null, x: 7, y: 8 }, { uuid: b.uuid, group_uuid: null, x: 9, y: 10 }] } })).status).toBe(204);
    const after = await ok("GET", `/api/boards/${board.uuid}`, { headers: account.headers });
    expect(after.groups).toEqual([]);
    expect(after.items.map((i: any) => [i.group_uuid, i.x, i.y])).toEqual([[null, 7, 8], [null, 9, 10]]);
  });

  it("deletes and restores a card, and moves one into and out of a booklet", async () => {
    const account = await register();
    const board = await ok("POST", "/api/boards", { headers: account.headers, json: { name: "Cards" } });
    const card = await ok("POST", `/api/boards/${board.uuid}/comments`, { headers: account.headers, json: { content: "gone soon" } });
    expect((await call("DELETE", `/api/board-items/${card.uuid}`, { headers: account.headers })).status).toBe(204);
    expect((await call("DELETE", `/api/board-items/${card.uuid}`, { headers: account.headers })).status).toBe(404);
    expect((await ok("GET", `/api/boards/${board.uuid}`, { headers: account.headers })).items).toEqual([]);
    const back = await ok("POST", `/api/board-items/${card.uuid}/restore`, { headers: account.headers });
    expect(back.deleted_at).toBeNull();
    expect((await call("PUT", `/api/board-items/${card.uuid}`, { headers: account.headers, json: { group_uuid: uuid() } })).status).toBe(400);
    expect((await call("PUT", `/api/board-items/${card.uuid}`, { headers: account.headers, json: { width: 1 } })).status).toBe(422);
    const edited = await ok("PUT", `/api/board-items/${card.uuid}`, { headers: account.headers, json: { content: " re-said ", text_align: "center", width: 400, position: 3 } });
    expect(edited).toMatchObject({ content: "re-said", text_align: "center", width: 400, position: 3 });
  });

  it("is what the desktop deletes offline: the web nook's board is gone", async () => {
    const account = await register();
    const board = await ok("POST", "/api/boards", { headers: account.headers, json: { name: "Delete offline" } });
    await pushed(account, mutation([{ table: "boards", uuid: board.uuid, base_revision: board.revision, operation: "delete", values: {} }]));
    expect(await ok("GET", "/api/boards", { headers: account.headers })).toEqual([]);
  });
});

describe("link cards", () => {
  it("puts a webpage card on the board at once and its picture on it when the job is done", async () => {
    const account = await register();
    const board = await ok("POST", "/api/boards", { headers: account.headers, json: { name: "Links" } });
    const response = await call("POST", `/api/boards/${board.uuid}/webpage`, { headers: account.headers, json: { url: "https://example.test/article", x: 10, y: 20 } });
    expect(response.status, await response.clone().text()).toBe(202);
    const queued = await response.json<any>();
    expect(queued.item).toMatchObject({ kind: "webpage", content: "example.test", file_path: null, width: 480 });
    expect((await ok("GET", `/api/jobs/${queued.job}`, { headers: account.headers })).status).toBe("queued");

    capturers.webpage = async () => new TextEncoder().encode("a png");
    await woken(queued.job);
    expect((await ok("GET", `/api/jobs/${queued.job}`, { headers: account.headers })).status).toBe("done");
    const card = (await ok("GET", `/api/boards/${board.uuid}`, { headers: account.headers })).items[0];
    expect(card.file_path).toMatch(new RegExp(`^${board.uuid}/[0-9a-f]{32}\\.png$`));
    expect(card.mime_type).toBe("image/png");
    const served = await call("GET", `/api/board-items/${card.uuid}/file`, { headers: account.headers });
    expect(await served.text()).toBe("a png");
    // The card was made, then pictured: two versions for the replicas.
    expect(await count("_server_change_log", "table_name = 'board_items'")).toBe(2);
  });

  it("leaves the link card when the capture fails, and says why", async () => {
    const account = await register();
    const board = await ok("POST", "/api/boards", { headers: account.headers, json: { name: "Links" } });
    const queued = await (await call("POST", `/api/boards/${board.uuid}/webpage`, { headers: account.headers, json: { url: "https://example.test/", x: 0, y: 0 } })).json<any>();
    capturers.webpage = async () => { throw new Error("The website could not be rendered"); };
    await woken(queued.job);
    expect(await ok("GET", `/api/jobs/${queued.job}`, { headers: account.headers })).toMatchObject({ status: "failed", detail: "Could not capture the webpage: The website could not be rendered" });
    const card = await row("SELECT file_path, source_url FROM board_items WHERE uuid = ?", queued.item.uuid);
    expect(card).toEqual({ file_path: null, source_url: "https://example.test/" });
  });

  it("refuses a bad link now, not by the worker", async () => {
    const account = await register();
    const board = await ok("POST", "/api/boards", { headers: account.headers, json: { name: "Links" } });
    for (const url of ["ftp://example.test/", "https://user:pw@example.test/", "http://localhost:8000/", "http://192.168.1.1/", "http://10.0.0.1/x"]) {
      expect((await call("POST", `/api/boards/${board.uuid}/webpage`, { headers: account.headers, json: { url, x: 0, y: 0 } })).status, url).toBe(422);
    }
    expect((await call("POST", `/api/boards/${board.uuid}/youtube`, { headers: account.headers, json: { url: "https://example.test/watch", x: 0, y: 0 } })).status).toBe(422);
    expect(await count("jobs")).toBe(0);
    expect(await count("board_items")).toBe(0);
  });

  it("gives a video card its thumbnail and title, whatever timestamp the link carries", async () => {
    const account = await register();
    const board = await ok("POST", "/api/boards", { headers: account.headers, json: { name: "Links" } });
    const queued = await (await call("POST", `/api/boards/${board.uuid}/youtube`, { headers: account.headers, json: { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s", x: 0, y: 0 } })).json<any>();
    expect(queued.item).toMatchObject({ kind: "youtube", content: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s" });
    capturers.youtubeThumbnail = async (_url, videoId) => ({ image: new TextEncoder().encode(`jpg ${videoId}`), title: "Never Gonna" });
    await woken(queued.job);
    const card = await row("SELECT content, mime_type, original_filename, file_path FROM board_items WHERE uuid = ?", queued.item.uuid);
    expect(card).toMatchObject({ content: "Never Gonna", mime_type: "image/jpeg", original_filename: "youtube-dQw4w9WgXcQ.jpg" });
    expect(await (await env.FILES.get(`board_uploads/${card!.file_path}`))!.text()).toBe("jpg dQw4w9WgXcQ");
  });
});

describe("what a board says of its owner", () => {
  it("carries the owner's email only when they show it", async () => {
    const owner = await register("shown@example.test"), other = await register();
    const board = await ok("POST", "/api/boards", { headers: owner.headers, json: { name: "Owned" } });
    expect((await ok("GET", `/api/boards/${board.uuid}`, { headers: other.headers })).owner.email).toBe("shown@example.test");
    await env.DB.prepare("UPDATE users SET email_public = 0 WHERE uuid = ?").bind(owner.uuid).run();
    expect((await ok("GET", `/api/boards/${board.uuid}`, { headers: other.headers })).owner.email).toBeNull();
    expect((await rows("SELECT 1 FROM boards")).length).toBe(1);
  });
});
