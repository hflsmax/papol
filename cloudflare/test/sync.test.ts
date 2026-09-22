// The desktop sync contract, asked of the Worker. Cases that reached the protocol through routes
// not yet ported (boards, papers, the nook, closing an account) are
// asked through the push instead where the protocol is what they were
// about, and listed at the end where they are not.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import worker from "../src/index";
import { SCHEMA_HEADER, schemaVersion } from "../src/clientRequirements";
import {
  call, count, defaultShelf, exec, mutation, ok, paperWithCopy, push, pushed, register, row, rows, sha256, uuid,
} from "./helpers";

const CURRENT = String(schemaVersion());
const OLDER = String(schemaVersion() - 1);

describe("pushing and pulling", () => {
  it("applies a mutation once, replays its reply, and lets a pulled log go", async () => {
    const account = await register();
    const client = uuid(), board = uuid(), item = uuid();
    const create = mutation([
      { table: "boards", uuid: board, base_revision: 0, operation: "upsert", values: { name: "Native board", description: "offline" } },
      { table: "board_items", uuid: item, base_revision: 0, operation: "upsert",
        values: { board_uuid: board, kind: "comment", content: "written offline", x: 12, y: 34 } },
    ], { client });
    const first = await pushed(account, create);
    const replay = await pushed(account, create);
    expect(replay).toEqual(first);
    expect(new Set(first.rows.map((r: any) => r.uuid))).toEqual(new Set([board, item]));
    expect(first.rows[0].revision).toBe(1);

    const pulled = await ok("GET", `/api/sync/pull?cursor=0&limit=10&client_uuid=${client}`, { headers: account.headers });
    expect(pulled.has_more).toBe(false);
    expect(new Set(pulled.changes.map((c: any) => [c.table, c.row.uuid].join()))).toEqual(new Set([`boards,${board}`, `board_items,${item}`]));
    const cursor = pulled.cursor;

    const deleted = await pushed(account, mutation([
      { table: "board_items", uuid: item, base_revision: 1, operation: "delete", values: {} },
    ], { client, sequence: 2 }));
    expect(deleted.rows[0].revision).toBe(2);
    expect(deleted.rows[0].deleted_at).not.toBeNull();
    const tail = await ok("GET", `/api/sync/pull?cursor=${cursor}&client_uuid=${client}`, { headers: account.headers });
    const tombstones = tail.changes.filter((c: any) => c.table === "board_items");
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0].row.uuid).toBe(item);
    expect(tombstones[0].row.deleted_at).not.toBeNull();

    expect(await count("boards")).toBe(1);
    expect(await count("board_items")).toBe(1);
    // Three changes were written (the board's clock moving is not one);
    // the second pull acknowledged the first two, and the log does not
    // keep what its only replica has taken.
    expect((await rows<{ sequence: number }>("SELECT sequence FROM _server_change_log ORDER BY sequence")).map((r) => r.sequence)).toEqual([3]);
    expect(await count("applied_mutations")).toBe(2);
    const replica = await row<{ client_uuid: string; acknowledged_cursor: number }>("SELECT client_uuid, acknowledged_cursor FROM _server_clients");
    expect(replica).toEqual({ client_uuid: client, acknowledged_cursor: cursor });
  });

  it("needs a live session", async () => {
    expect((await call("POST", "/api/sync/push", { json: mutation([]) })).status).toBe(401);
    expect((await call("POST", "/api/sync/push", { headers: { Authorization: "Bearer expired" }, json: mutation([]) })).status).toBe(401);
  });

  it("refuses a mutation id reused for different content", async () => {
    const account = await register();
    const first = mutation([{ table: "boards", uuid: uuid(), operation: "upsert", values: { name: "Original" } }]);
    await pushed(account, first);
    const different = { ...first, changes: [{ ...first.changes[0], values: { name: "Different" } }] };
    expect((await push(account, different)).status).toBe(409);
    expect(await count("boards")).toBe(1);
  });

  it("acknowledges a delete of a row a restored database has already lost", async () => {
    const account = await register();
    const payload = mutation([{ table: "boards", uuid: uuid(), base_revision: 4, operation: "delete", values: {} }]);
    const first = await pushed(account, payload);
    expect(first.rows).toEqual([]);
    expect(await pushed(account, payload)).toEqual(first);
  });

  it("keeps each account's log to itself", async () => {
    const mine = await register(), theirs = await register();
    const board = uuid();
    await pushed(mine, mutation([{ table: "boards", uuid: board, operation: "upsert", values: { name: "Private" } }]));
    expect((await ok("GET", "/api/sync/pull", { headers: theirs.headers })).changes).toEqual([]);
    expect((await ok("GET", "/api/sync/pull", { headers: mine.headers })).changes[0].row.uuid).toBe(board);
  });

  it("refuses a foreign parent and a field the registry does not let a client write", async () => {
    const mine = await register(), theirs = await register();
    const foreignBoard = uuid();
    await pushed(theirs, mutation([{ table: "boards", uuid: foreignBoard, operation: "upsert", values: { name: "Foreign" } }]));
    const unregistered = await push(mine, mutation([{
      table: "board_items", uuid: uuid(), operation: "upsert",
      values: { board_uuid: foreignBoard, kind: "comment", content: "not mine", user_uuid: 1 },
    }]));
    expect(unregistered.status).toBe(422);
    const foreign = await push(mine, mutation([{
      table: "board_items", uuid: uuid(), operation: "upsert",
      values: { board_uuid: foreignBoard, kind: "comment", content: "not mine" },
    }]));
    expect(foreign.status).toBe(409);
    // Somebody else's row is not this user's to change, and is not
    // described to them either.
    const notMine = await push(mine, mutation([{ table: "boards", uuid: foreignBoard, base_revision: 1, operation: "upsert", values: { name: "Taken" } }]));
    expect(notMine.status).toBe(404);
  });

  it("refuses a script or a credential in a card's link", async () => {
    const account = await register();
    const board = uuid();
    for (const source_url of ["javascript:alert(1)", "https://user:secret@example.test/page"]) {
      const response = await push(account, mutation([
        { table: "boards", uuid: board, operation: "upsert", values: { name: "Safe links" } },
        { table: "board_items", uuid: uuid(), operation: "upsert", values: { board_uuid: board, kind: "webpage", source_url } },
      ]));
      expect(response.status, source_url).toBe(422);
    }
    expect(await count("boards")).toBe(0);
  });
});

describe("blobs", () => {
  it("names a card's file by its digest once the bytes are in the bucket, and hands it back by that digest", async () => {
    const account = await register();
    const content = new TextEncoder().encode("offline clipped image bytes");
    const digest = await sha256(content);
    expect((await call("GET", `/api/sync/blobs/${digest}`, { headers: account.headers })).status).toBe(404);
    // The replica put the bytes in the bucket by the address it was given (files.test.ts).
    await env.FILES.put(`board_uploads/blobs/${digest}`, content, { httpMetadata: { contentType: "image/png" } });

    const board = uuid(), item = uuid();
    const result = await pushed(account, mutation([
      { table: "boards", uuid: board, operation: "upsert", values: { name: "Blob board" } },
      { table: "board_items", uuid: item, operation: "upsert",
        values: { board_uuid: board, kind: "image", sha256: digest, mime_type: "image/png", original_filename: "clip.png" } },
    ]));
    expect(result.rows[1].file_path).toBe(`blobs/${digest}`);
    const downloaded = await call("GET", `/api/sync/blobs/${digest}`, { headers: account.headers });
    expect(downloaded.status).toBe(200);
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(content);
    expect(downloaded.headers.get("content-type")).toBe("image/png");
    expect(downloaded.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect((await call("GET", `/api/sync/blobs/${digest}`)).status).toBe(401);
    // With a bucket address, the answer is that address: the bytes are the bucket's to serve.
    const hosted = await worker.fetch(new Request(`https://papol.test/api/sync/blobs/${digest}`, { headers: account.headers }), { ...env, FILES_URL: "https://files.test" as string } as Env);
    expect(hosted.status).toBe(301);
    expect(hosted.headers.get("location")).toBe(`https://files.test/board_uploads/blobs/${digest}`);
  });

  it("refuses a card naming a blob that was never sent", async () => {
    const account = await register();
    const board = uuid();
    const response = await push(account, mutation([
      { table: "boards", uuid: board, operation: "upsert", values: { name: "Blob board" } },
      { table: "board_items", uuid: uuid(), operation: "upsert", values: { board_uuid: board, kind: "image", sha256: "f".repeat(64) } },
    ]));
    expect(response.status).toBe(409);
  });
});

describe("papers", () => {
  it("imports a PDF once under its digest and creates the owned graph", async () => {
    const account = await register();
    const content = new TextEncoder().encode("%PDF-1.4\noffline paper\n%%EOF");
    const digest = await sha256(content);
    // Papol holds this paper already, uploaded through the website.
    const at = new Date().toISOString();
    await exec("INSERT INTO papers (sha256, title, file_path, uploaded_by, created_at, updated_at, revision) VALUES (?, ?, ?, ?, ?, ?, 1)",
      digest, "Imported while offline", `${digest}.pdf`, account.uuid, at, at);
    await env.FILES.put(`uploads/${digest}.pdf`, content, { httpMetadata: { contentType: "application/pdf" } });

    const copy = uuid();
    const result = await pushed(account, mutation([
      { table: "papers", uuid: digest, operation: "upsert", values: { title: "Imported while offline", doi: null, file_path: `${digest}.pdf` } },
      { table: "copies", uuid: copy, operation: "upsert", values: { paper_sha256: digest, summary: "Local first" } },
    ]));
    expect(result.rows.map((r: any) => r.table)).toEqual(["papers", "copies"]);
    // Both ends read the name off the same bytes, so no alias is needed.
    expect(result.aliases).toEqual({});
    expect(result.rows[0].sha256).toBe(digest);
    const downloaded = await call("GET", `/api/sync/blobs/${digest}`, { headers: account.headers });
    expect(downloaded.status).toBe(200);
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(content);
    expect(await env.FILES.head(`uploads/${digest}.pdf`)).not.toBeNull();

    // The bytes are the name, so a second import of the same file cannot
    // become a second paper however it is titled; and a user has one copy
    // per paper, so the second copy is the first one again.
    const duplicate = uuid();
    const again = await pushed(account, mutation([
      { table: "papers", uuid: digest, operation: "upsert", values: { title: "A different filename", doi: null, file_path: `${digest}.pdf` } },
      { table: "copies", uuid: duplicate, operation: "upsert", values: { paper_sha256: digest, summary: "Updated offline" } },
    ], { sequence: 2 }));
    expect(again.aliases).toEqual({ [duplicate]: copy });
    const copies = await rows<{ summary: string }>("SELECT summary FROM copies WHERE paper_sha256 = ?", digest);
    expect(copies).toEqual([{ summary: "Updated offline" }]);
  });

  it("refuses a paper whose bytes were never sent, and an import without a copy", async () => {
    const account = await register();
    const digest = "c".repeat(64);
    const noCopy = await push(account, mutation([
      { table: "papers", uuid: digest, operation: "upsert", values: { title: "Alone" } },
    ]));
    expect(noCopy.status).toBe(422);
    const noBytes = await push(account, mutation([
      { table: "papers", uuid: digest, operation: "upsert", values: { title: "Never sent" } },
      { table: "copies", uuid: uuid(), operation: "upsert", values: { paper_sha256: digest } },
    ]));
    expect(noBytes.status).toBe(409);
    expect(await count("papers")).toBe(0);
  });

  it("lets a user keep a paper somebody displays", async () => {
    const other = await register();
    const otherShelf = await defaultShelf(other); // public
    const digest = "a".repeat(64);
    await paperWithCopy(other, digest, "Visible before adding", { shelfUuid: otherShelf, filePath: "visible.pdf" });

    const account = await register();
    const copy = uuid();
    const result = await pushed(account, mutation([{
      table: "copies", uuid: copy, operation: "upsert", base_revision: 0,
      values: { paper_sha256: digest, shelf_uuid: await defaultShelf(account) },
    }]));
    expect(result.rows[0].uuid).toBe(copy);
    expect(result.rows[0].paper_sha256).toBe(digest);
  });

  it("refuses a paper nobody displays and this user does not keep", async () => {
    const other = await register();
    const privateShelf = await row<{ uuid: string }>("SELECT uuid FROM shelves WHERE user_uuid = ? AND is_public = 0", other.uuid);
    const digest = "d".repeat(64);
    await paperWithCopy(other, digest, "Hidden", { shelfUuid: privateShelf!.uuid });
    const account = await register();
    const response = await push(account, mutation([{ table: "copies", uuid: uuid(), operation: "upsert", values: { paper_sha256: digest } }]));
    expect(response.status).toBe(409);
  });

  it("revives the user's copy when a removed paper is opened again", async () => {
    const account = await register();
    const content = new TextEncoder().encode("%PDF-1.4\nremoved and opened again\n%%EOF");
    const digest = await sha256(content);
    await env.FILES.put(`uploads/${digest}.pdf`, content);
    const client = uuid(), copy = uuid();
    const paper = { table: "papers", uuid: digest, operation: "upsert", values: { title: "Removed and opened again", doi: null, file_path: `${digest}.pdf` } };
    await pushed(account, mutation([paper, { table: "copies", uuid: copy, operation: "upsert", values: { paper_sha256: digest } }], { client }));
    await pushed(account, mutation([{ table: "copies", uuid: copy, base_revision: 1, operation: "delete", values: {} }], { client, sequence: 2 }));

    const again = uuid();
    const revived = await pushed(account, mutation([
      paper, { table: "copies", uuid: again, base_revision: 0, operation: "upsert", values: { paper_sha256: digest } },
    ], { client, sequence: 3 }));
    expect(revived.aliases[again]).toBe(copy);
    // The fresh addition wins the ordinary revision conflict; what must
    // never happen is the removal rejecting it outright.
    expect(revived.conflicts.map((c: any) => c.resolution)).not.toContain("server_won");
    const copyRow = revived.rows.find((r: any) => r.table === "copies");
    expect(copyRow.deleted_at).toBeNull();
    expect(copyRow.paper_sha256).toBe(digest);
    expect(await rows("SELECT deleted_at FROM copies WHERE user_uuid = ?", account.uuid)).toEqual([{ deleted_at: null }]);
  });

  it("holds a paper's record to the shape the website holds it to", async () => {
    const account = await register();
    const content = new TextEncoder().encode("%PDF-1.4\nheld\n%%EOF");
    const digest = await sha256(content);
    await env.FILES.put(`uploads/${digest}.pdf`, content);
    for (const values of [{ title: "t".repeat(501) }, { title: "" }, { title: "Fine", year: 99999 }]) {
      const response = await push(account, mutation([
        { table: "papers", uuid: digest, operation: "upsert", values },
        { table: "copies", uuid: uuid(), operation: "upsert", values: { paper_sha256: digest } },
      ]));
      expect(response.status, JSON.stringify(values)).toBe(422);
    }
    expect(await count("papers")).toBe(0);
  });
});

describe("conflicts", () => {
  async function boardAt(account: Awaited<ReturnType<typeof register>>, board: string, client: string) {
    await pushed(account, mutation([{ table: "boards", uuid: board, base_revision: 0, operation: "upsert", values: { name: "Original" } }], { client }));
  }

  it("lets a stale edit win and reports what it overwrote", async () => {
    const account = await register();
    const board = uuid(), first = uuid();
    await boardAt(account, board, first);
    await pushed(account, mutation([{ table: "boards", uuid: board, base_revision: 1, operation: "upsert", values: { name: "First edit" } }], { client: first, sequence: 2 }));
    const result = await pushed(account, mutation([{ table: "boards", uuid: board, base_revision: 1, operation: "upsert", values: { name: "Later edit" } }]));
    expect(result.rows[0].revision).toBe(3);
    expect(result.rows[0].name).toBe("Later edit");
    expect(result.conflicts[0]).toMatchObject({ resolution: "client_won", server_revision: 2, previous: { name: "First edit" } });
  });

  it("lets a delete win over a stale edit and keeps the edit for recovery", async () => {
    const account = await register();
    const board = uuid(), client = uuid();
    await boardAt(account, board, client);
    await pushed(account, mutation([{ table: "boards", uuid: board, base_revision: 1, operation: "delete", values: {} }], { client, sequence: 2 }));
    const stale = await pushed(account, mutation([{ table: "boards", uuid: board, base_revision: 1, operation: "upsert", values: { name: "Unsynced edit" } }]));
    expect(stale.rows[0].deleted_at).not.toBeNull();
    expect(stale.rows[0].name).toBe("Original");
    expect(stale.conflicts[0]).toMatchObject({ resolution: "server_won", reason: "row_deleted", rejected_values: { name: "Unsynced edit" } });
  });

  it("does the same for a group's edit", async () => {
    const account = await register();
    const board = uuid(), group = uuid(), client = uuid();
    await pushed(account, mutation([
      { table: "boards", uuid: board, base_revision: 0, operation: "upsert", values: { name: "Board" } },
      { table: "board_groups", uuid: group, base_revision: 0, operation: "upsert", values: { board_uuid: board, kind: "booklet", title: "Original" } },
    ], { client }));
    await pushed(account, mutation([{ table: "board_groups", uuid: group, base_revision: 1, operation: "upsert", values: { title: "Device one" } }], { client, sequence: 2 }));
    const stale = await pushed(account, mutation([{ table: "board_groups", uuid: group, base_revision: 1, operation: "upsert", values: { title: "Device two" } }]));
    expect(stale.rows[0].title).toBe("Device two");
    expect(stale.conflicts[0].resolution).toBe("client_won");
  });

  it("does the same for an ink stroke", async () => {
    const account = await register();
    const digest = "2".repeat(64);
    await paperWithCopy(account, digest, "Conflict paper", { filePath: "conflict.pdf" });
    const ink = uuid(), client = uuid();
    const stroke = (color: string) => JSON.stringify({ points: [{ x: 0.1, y: 0.2 }], color, width: 0.004, opacity: 1, shape: "flat" });
    await pushed(account, mutation([{ table: "annotations", uuid: ink, base_revision: 0, operation: "upsert",
      values: { kind: "ink", paper_sha256: digest, page: 1, body: stroke("#111111") } }], { client }));
    await pushed(account, mutation([{ table: "annotations", uuid: ink, base_revision: 1, operation: "upsert", values: { body: stroke("#222222") } }], { client, sequence: 2 }));
    const stale = await pushed(account, mutation([{ table: "annotations", uuid: ink, base_revision: 1, operation: "upsert", values: { body: stroke("#333333") } }]));
    expect(JSON.parse(stale.rows[0].body).color).toBe("#333333");
    expect(JSON.parse(stale.conflicts[0].previous.body).color).toBe("#222222");
    expect(stale.conflicts[0].resolution).toBe("client_won");
  });
});

describe("the nook", () => {
  it("snapshots papers by their file and every other row by its UUID, and takes every kind of annotation", async () => {
    const account = await register();
    const digest = "1".repeat(64);
    await paperWithCopy(account, digest, "Offline annotations", { filePath: "offline.pdf" });
    const initial = await ok("GET", "/api/sync/snapshot", { headers: account.headers });
    const identities = new Set(initial.rows.map((r: any) => `${r.table}:${r.table === "papers" ? r.sha256 : r.uuid}`));
    expect(identities.has(`papers:${digest}`)).toBe(true);
    expect(initial.rows.some((r: any) => r.table === "copies")).toBe(true);
    expect(initial.rows.some((r: any) => r.table === "shelves")).toBe(true);
    // Booleans travel as booleans, whatever SQLite keeps.
    expect(typeof initial.rows.find((r: any) => r.table === "shelves").is_public).toBe("boolean");

    const ids = [uuid(), uuid(), uuid()];
    const pushedRows = await pushed(account, mutation([
      { table: "annotations", uuid: ids[0], operation: "upsert", values: { kind: "note", paper_sha256: digest, content: "offline note", page: 1,
        body: JSON.stringify({ anchor: { type: "point", x: 0.2, y: 0.3 } }) } },
      { table: "annotations", uuid: ids[1], operation: "upsert", values: { kind: "ink", paper_sha256: digest, page: 1,
        body: JSON.stringify({ points: [{ x: 0.1, y: 0.2 }], color: "#b3923d", width: 0.004, opacity: 1, shape: "flat" }) } },
      { table: "annotations", uuid: ids[2], operation: "upsert", values: { kind: "clip", paper_sha256: digest, page: 1,
        body: JSON.stringify({ source: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, frame: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, floating: false }) } },
    ]));
    expect(new Set(pushedRows.rows.map((r: any) => r.uuid))).toEqual(new Set(ids));
    const refreshed = await ok("GET", "/api/sync/snapshot", { headers: account.headers });
    expect(new Set(refreshed.rows.map((r: any) => r.table))).toContain("annotations");
    expect((await rows<{ kind: string }>("SELECT kind FROM annotations ORDER BY kind")).map((r) => r.kind)).toEqual(["clip", "ink", "note"]);
  });

  it("refuses an annotation that is not its kind's shape", async () => {
    const account = await register();
    const digest = "5".repeat(64);
    await paperWithCopy(account, digest, "Shapes");
    for (const values of [
      { kind: "ink", paper_sha256: digest, page: 1, body: JSON.stringify({ points: [] }) },
      { kind: "note", paper_sha256: digest, content: "", body: "{}" },
      { kind: "clip", paper_sha256: digest, page: 1, body: JSON.stringify({ source: { x: 0.9, y: 0.9, w: 0.5, h: 0.5 }, frame: { x: 0, y: 0, w: 1, h: 1 } }) },
    ]) {
      const response = await push(account, mutation([{ table: "annotations", uuid: uuid(), operation: "upsert", values }]));
      expect(response.status, values.kind).toBe(422);
    }
  });

  it("snapshots the complete board hierarchy", async () => {
    const account = await register();
    const board = uuid(), first = uuid(), second = uuid(), group = uuid();
    await pushed(account, mutation([
      { table: "boards", uuid: board, operation: "upsert", values: { name: "Snapshot board" } },
      { table: "board_groups", uuid: group, operation: "upsert", values: { board_uuid: board, kind: "collection", title: "Snapshot group" } },
      { table: "board_items", uuid: first, operation: "upsert", values: { board_uuid: board, group_uuid: group, kind: "comment", content: "On the board", x: 12, y: 34 } },
      { table: "board_items", uuid: second, operation: "upsert", values: { board_uuid: board, group_uuid: group, kind: "comment", content: "Also", x: 56, y: 78 } },
    ]));
    const snapshot = await ok("GET", "/api/sync/snapshot", { headers: account.headers });
    const identities = new Set(snapshot.rows.map((r: any) => `${r.table}:${r.uuid}`));
    for (const expected of [`boards:${board}`, `board_groups:${group}`, `board_items:${first}`, `board_items:${second}`]) {
      expect(identities.has(expected), expected).toBe(true);
    }
    // Parents before children, so a replica can store them in this order.
    const order = snapshot.rows.map((r: any) => r.table);
    expect(order.indexOf("boards")).toBeLessThan(order.indexOf("board_groups"));
    expect(order.indexOf("board_groups")).toBeLessThan(order.indexOf("board_items"));
  });

  it("syncs shelves, tags, a copy and its tag together, and holds the copy to the form's limits", async () => {
    const account = await register();
    const digest = "6".repeat(64);
    const copy = await paperWithCopy(account, digest, "Offline nook", { shelfUuid: await defaultShelf(account), revision: 1 });
    const shelf = uuid(), tag = uuid(), link = uuid();
    const result = await pushed(account, mutation([
      { table: "shelves", uuid: shelf, operation: "upsert", values: { name: "Methods", color: "#123456", position: 2 } },
      { table: "tags", uuid: tag, operation: "upsert", values: { name: "distributed" } },
      { table: "copies", uuid: copy, operation: "upsert", base_revision: 1, values: { shelf_uuid: shelf, summary: "Saved without a network", rating_reading: 4 } },
      { table: "copy_tags", uuid: link, operation: "upsert", values: { copy_uuid: copy, tag_uuid: tag } },
    ]));
    expect(result.rows.map((r: any) => r.table)).toEqual(["shelves", "tags", "copies", "copy_tags"]);
    expect(result.rows[2]).toMatchObject({ paper_sha256: digest, shelf_uuid: shelf, summary: "Saved without a network", rating_reading: 4 });
    expect(await row("SELECT copy_uuid FROM copy_tags WHERE uuid = ?", link)).toEqual({ copy_uuid: copy });

    const rejected = await push(account, mutation([{ table: "copies", uuid: copy, operation: "upsert", base_revision: 2, values: { rating_liking: 6 } }], { sequence: 2 }));
    expect(rejected.status).toBe(422);
  });

  it("publishes and hides a paper by the shelf it is moved to, unless a seminar is on", async () => {
    const account = await register();
    const at = new Date().toISOString();
    const publicShelf = uuid(), privateShelf = uuid();
    await exec("INSERT INTO shelves (uuid, user_uuid, name, color, is_public, is_default, position, created_at, updated_at, revision) VALUES (?, ?, 'Offline public', '#123456', 1, 0, 3, ?, ?, 0)", publicShelf, account.uuid, at, at);
    await exec("INSERT INTO shelves (uuid, user_uuid, name, color, is_public, is_default, position, created_at, updated_at, revision) VALUES (?, ?, 'Offline private', '#654321', 0, 0, 4, ?, ?, 0)", privateShelf, account.uuid, at, at);
    const digest = "7".repeat(64);
    const copy = await paperWithCopy(account, digest, "Shelved offline", { shelfUuid: publicShelf, revision: 1 });
    const client = uuid();
    const move = (shelf: string, sequence: number) => push(account, mutation([
      { table: "copies", uuid: copy, operation: "upsert", base_revision: 1, values: { shelf_uuid: shelf } },
    ], { client, sequence }));
    const onShelf = async () => (await row<{ shelf_uuid: string }>("SELECT shelf_uuid FROM copies WHERE uuid = ?", copy))?.shelf_uuid;

    expect((await move(privateShelf, 1)).status).toBeLessThan(400);
    expect(await onShelf()).toBe(privateShelf);
    expect((await move(publicShelf, 2)).status).toBeLessThan(400);
    expect(await onShelf()).toBe(publicShelf);

    const room = uuid();
    await exec("INSERT INTO rooms (uuid, paper_sha256, created_by, status, created_at) VALUES (?, ?, ?, 'called', ?)", room, digest, account.uuid, at);
    await exec("INSERT INTO room_participants (uuid, room_uuid, user_uuid, created_at) VALUES (?, ?, ?, ?)", uuid(), room, account.uuid, at);
    const refused = await move(privateShelf, 3);
    expect(refused.status).toBe(422);
    expect(await onShelf()).toBe(publicShelf);
  });

  it("keeps a shelf until it is emptied, and never the default one", async () => {
    const account = await register();
    const shelf = uuid(), board = uuid();
    await pushed(account, mutation([
      { table: "shelves", uuid: shelf, operation: "upsert", values: { name: "Full", color: "#123456", position: 2 } },
      { table: "boards", uuid: board, operation: "upsert", values: { name: "On the shelf", shelf_uuid: shelf } },
    ]));
    expect((await push(account, mutation([{ table: "shelves", uuid: shelf, base_revision: 1, operation: "delete", values: {} }]))).status).toBe(409);
    await pushed(account, mutation([{ table: "boards", uuid: board, base_revision: 1, operation: "delete", values: {} }]));
    expect((await push(account, mutation([{ table: "shelves", uuid: shelf, base_revision: 1, operation: "delete", values: {} }]))).status).toBeLessThan(400);
    expect((await push(account, mutation([{ table: "shelves", uuid: await defaultShelf(account), base_revision: 0, operation: "delete", values: {} }]))).status).toBe(409);
  });

  it("deletes a board's groups and cards with it", async () => {
    const account = await register();
    const board = uuid(), group = uuid(), item = uuid();
    await pushed(account, mutation([
      { table: "boards", uuid: board, operation: "upsert", values: { name: "Going" } },
      { table: "board_groups", uuid: group, operation: "upsert", values: { board_uuid: board, kind: "booklet", title: "Group" } },
      { table: "board_items", uuid: item, operation: "upsert", values: { board_uuid: board, group_uuid: group, kind: "comment", content: "Card" } },
    ]));
    const client = uuid();
    await pushed(account, mutation([{ table: "boards", uuid: board, base_revision: 1, operation: "delete", values: {} }], { client }));
    expect(await count("board_groups", "deleted_at IS NOT NULL")).toBe(1);
    expect(await count("board_items", "deleted_at IS NOT NULL")).toBe(1);
    // Every replica hears about all three tombstones.
    const pulled = await ok("GET", "/api/sync/pull?cursor=0", { headers: account.headers });
    const tombstones = pulled.changes.filter((c: any) => c.row.deleted_at !== null).map((c: any) => c.table).sort();
    expect(tombstones).toEqual(["board_groups", "board_items", "boards"]);
  });

  it("files every synchronized row under its owner", async () => {
    const account = await register();
    const me = await ok("GET", "/api/auth/me", { headers: account.headers });
    const snapshot = await ok("GET", "/api/sync/snapshot", { headers: account.headers });
    const owners = new Set(snapshot.rows.filter((r: any) => r.user_uuid).map((r: any) => r.user_uuid));
    expect(owners).toEqual(new Set([me.uuid]));
  });
});

describe("what synchronization stops remembering", () => {
  type Account = Awaited<ReturnType<typeof register>>;

  async function board(account: Account, name: string, client: string, sequence: number): Promise<string> {
    const board = uuid();
    await pushed(account, mutation([{ table: "boards", uuid: board, base_revision: 0, operation: "upsert", values: { name } }], { client, sequence }));
    return board;
  }

  // A cursor is acknowledged by the pull that comes back carrying it,
  // never by the pull that hands it out.
  async function caughtUp(account: Account, client: string): Promise<number> {
    let cursor = 0;
    for (;;) {
      const page = await ok("GET", `/api/sync/pull?cursor=${cursor}&client_uuid=${client}`, { headers: account.headers });
      if (page.cursor === cursor) return cursor;
      cursor = page.cursor;
    }
  }

  const sequences = async () => (await rows<{ sequence: number }>("SELECT sequence FROM _server_change_log ORDER BY sequence")).map((r) => r.sequence);

  it("keeps what a second replica has not taken", async () => {
    const account = await register();
    const mac = uuid(), laptop = uuid();
    await board(account, "First", mac, 1);
    const [first] = await sequences();
    const behind = await caughtUp(account, laptop);
    await board(account, "Second", mac, 2);
    const second = (await sequences()).at(-1)!;
    const ahead = await caughtUp(account, mac);
    expect(ahead).toBeGreaterThan(behind);
    expect(await sequences()).toEqual([first, second].filter((s) => s > behind));
  });

  it("lets the whole log go once its one replica has caught up", async () => {
    const account = await register();
    const client = uuid();
    await board(account, "First", client, 1);
    await board(account, "Second", client, 2);
    await caughtUp(account, client);
    expect(await sequences()).toEqual([]);
  });

  it("keeps the cursor growing after the log is emptied", async () => {
    const account = await register();
    const client = uuid();
    await board(account, "First", client, 1);
    const cursor = await caughtUp(account, client);
    expect(cursor).toBeGreaterThan(0);
    const later = await board(account, "After the prune", client, 2);
    const page = await ok("GET", `/api/sync/pull?cursor=${cursor}&client_uuid=${client}`, { headers: account.headers });
    expect(page.changes.map((c: any) => [c.table, c.row.uuid])).toEqual([["boards", later]]);
    expect(page.cursor).toBeGreaterThan(cursor);
  });

  it("keeps the whole log of an account with no replica", async () => {
    const account = await register();
    await pushed(account, mutation([{ table: "boards", uuid: uuid(), operation: "upsert", values: { name: "From nowhere named" } }]));
    expect(await count("_server_change_log")).toBe(1);
    expect(await count("_server_clients")).toBe(0);
  });

  it("lets go of a reply no client can still be retrying, and keeps one they may", async () => {
    const account = await register();
    const client = uuid();
    const payload = mutation([{ table: "boards", uuid: uuid(), base_revision: 0, operation: "upsert", values: { name: "Pushed once" } }], { client });
    const first = await pushed(account, payload);
    await ok("GET", `/api/sync/pull?cursor=0&client_uuid=${client}`, { headers: account.headers });
    expect(await pushed(account, payload)).toEqual(first);
    expect(await count("boards")).toBe(1);

    await exec("UPDATE applied_mutations SET created_at = ?", new Date(Date.now() - 91 * 24 * 3600 * 1000).toISOString());
    await board(account, "Today", client, 2);
    await ok("GET", `/api/sync/pull?cursor=0&client_uuid=${client}`, { headers: account.headers });
    expect(await count("applied_mutations")).toBe(1);
  });
});

describe("the client gate", () => {
  it("refuses a build for another schema on every sync route, and nothing else", async () => {
    const account = await register();
    for (const [method, path] of [["GET", "/api/sync/snapshot"], ["GET", "/api/sync/pull"], ["POST", "/api/sync/push"]] as const) {
      const refused = await call(method, path, { headers: { ...account.headers, [SCHEMA_HEADER]: OLDER },
        json: method === "POST" ? mutation([{ table: "boards", uuid: uuid(), operation: "upsert", values: { name: "Fine" } }]) : undefined });
      expect(refused.status, path).toBe(426);
      expect(await refused.json()).toMatchObject({ detail: { error: "client_incompatible", schema_version: schemaVersion() } });
    }
    expect(await count("boards")).toBe(0);
    expect((await call("GET", "/api/sync/snapshot", { headers: { ...account.headers, [SCHEMA_HEADER]: CURRENT } })).status).toBe(200);
    expect((await call("GET", "/api/auth/me", { headers: { ...account.headers, [SCHEMA_HEADER]: OLDER } })).status).toBe(200);
  });

  it("records the build each replica runs", async () => {
    const account = await register();
    const client = uuid();
    await ok("GET", `/api/sync/pull?client_uuid=${client}`, { headers: { ...account.headers, [SCHEMA_HEADER]: CURRENT, "User-Agent": "Papol macOS/0.5.1" } });
    await ok("GET", `/api/sync/pull?client_uuid=${client}`, { headers: { ...account.headers, "User-Agent": "curl/8.4.0" } });
    // The last build that announced one; a caller naming none leaves it.
    expect(await row("SELECT app_version FROM _server_clients WHERE client_uuid = ?", client)).toEqual({ app_version: "0.5.1" });
  });
});

// Cases of the original contract suite not asked here, and why:
//
// - test_identified_mutation_is_applied_once_and_replays_its_response,
//   test_reusing_a_mutation_id_for_different_content_is_rejected (the
//   /api/boards form), test_multipart_replay_ignores_random_transport_boundaries,
//   test_identified_mutation_requires_uuid_headers: the idempotency
//   middleware for routes other than the push. No shipped client sends the
//   headers it looked for; it is not carried over (migrations/0002).
// - test_dependent_board_replay_contract, test_board_files_are_private_immutable_resources,
//   test_online_add_to_nook_revives_a_removed_copy, test_desktop_board_deletion_disappears_from_the_web_nook,
//   test_server_only_actions_accept_desktop_sync_uuids, test_the_website_refuses_the_metadata_a_push_would_refuse,
//   test_viewer_reference_boundary_accepts_a_synced_paper_sha256,
//   test_metadata_reextraction_prefers_pdf_doi_over_stale_saved_doi,
//   test_closing_an_account_removes_its_private_sync_bookkeeping: about
//   routes not yet ported (boards, papers, the nook, references, the
//   account). They come with those routes.
