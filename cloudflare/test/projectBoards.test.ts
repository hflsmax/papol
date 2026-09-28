// A project's boards and digs: members make and edit boards
// together, and talk about anything the project holds, one discussion to
// a subject.
import { describe, expect, it } from "vitest";

import { call, defaultShelf, exec, ok, paperWithCopy, register, row, type Account } from "./helpers";

const A_PAPER = "c".repeat(64);

async function group() {
  const dana = await register(), ana = await register(), sam = await register();
  const project = await ok("POST", "/api/projects", { headers: dana.headers, json: { name: "Wavefronts" } });
  const { invite_code } = await ok("POST", `/api/projects/${project.uuid}/invite`, { headers: dana.headers });
  await ok("POST", `/api/project-invites/${invite_code}`, { headers: ana.headers });
  return { dana, ana, sam, project };
}

async function boardIn(account: Account, projectUuid: string, name = "Ideas") {
  return ok("POST", `/api/projects/${projectUuid}/boards`, { headers: account.headers, json: { name } });
}

describe("project boards", () => {
  it("lets every member edit a board and keeps it from anyone else", async () => {
    const { dana, ana, sam, project } = await group();
    const board = await boardIn(ana, project.uuid);
    expect(board.project).toEqual({ uuid: project.uuid, name: "Wavefronts" });
    expect(board.user_uuid).toBe(ana.uuid);
    expect(board.shelf_uuid).toBe(await defaultShelf(ana));

    const card = await ok("POST", `/api/boards/${board.uuid}/comments`, { headers: dana.headers, json: { content: "A killer app" } });
    expect((await ok("GET", `/api/boards/${board.uuid}`, { headers: dana.headers })).can_edit).toBe(true);
    await ok("PUT", `/api/board-items/${card.uuid}`, { headers: ana.headers, json: { content: "A killer app: live correction" } });
    // The change is logged to the board's maker, whose replica holds it.
    expect(await row("SELECT user_uuid FROM _server_change_log WHERE row_uuid = ? ORDER BY rowid DESC LIMIT 1", card.uuid))
      .toEqual({ user_uuid: ana.uuid });

    expect((await call("GET", `/api/boards/${board.uuid}`, { headers: sam.headers })).status).toBe(404);
    expect((await call("POST", `/api/boards/${board.uuid}/comments`, { headers: sam.headers, json: { content: "hi" } })).status).toBe(404);
    const library = await ok("GET", "/api/library/boards", { headers: sam.headers });
    expect(library.map((b: { uuid: string }) => b.uuid)).not.toContain(board.uuid);

    const seen = await ok("GET", `/api/projects/${project.uuid}`, { headers: dana.headers });
    expect(seen.boards.map((b: { uuid: string; item_count: number }) => [b.uuid, b.item_count])).toEqual([[board.uuid, 1]]);
    expect(seen.boards[0].owner.uuid).toBe(ana.uuid);
    expect(seen.boards[0].boxes).toHaveLength(1);
  });

  it("lets only its maker shelve it, and its maker or a keeper delete it", async () => {
    const { dana, ana, project } = await group();
    const board = await boardIn(ana, project.uuid);
    const other = await boardIn(dana, project.uuid, "Mine");
    expect((await call("PUT", `/api/boards/${board.uuid}`, { headers: dana.headers, json: { shelf_uuid: await defaultShelf(dana) } })).status).toBe(403);
    expect((await call("DELETE", `/api/boards/${other.uuid}`, { headers: ana.headers })).status).toBe(403);
    await ok("DELETE", `/api/boards/${board.uuid}`, { headers: dana.headers });
  });

  it("hands a closing member's boards to the project", async () => {
    const { dana, ana, project } = await group();
    const board = await boardIn(ana, project.uuid);
    await ok("POST", `/api/boards/${board.uuid}/comments`, { headers: ana.headers, json: { content: "Keep me" } });
    await ok("DELETE", "/api/auth/account", { headers: ana.headers, json: { confirm_email: ana.email } });
    const kept = await ok("GET", `/api/boards/${board.uuid}`, { headers: dana.headers });
    expect(kept.user_uuid).toBe(dana.uuid);
    expect(kept.items.map((i: { content: string }) => i.content)).toEqual(["Keep me"]);
  });
});

describe("papers on boards", () => {
  it("lists the boards that carry a card from each paper, placed not staged", async () => {
    const { dana, project } = await group();
    await paperWithCopy(dana, A_PAPER, "Error dynamics", { shelfUuid: await defaultShelf(dana) });
    await ok("POST", `/api/projects/${project.uuid}/papers`, { headers: dana.headers, json: { paper_sha256: A_PAPER } });
    const board = await boardIn(dana, project.uuid);
    const waiting = await boardIn(dana, project.uuid, "Later");
    const source_url = `https://papol.io/viewer/?pdf=${A_PAPER.slice(0, 32)}&page=2`;
    const staged = await ok("POST", `/api/boards/${board.uuid}/staging`, { headers: dana.headers, json: { excerpt_text: "The loop lags.", source_url, source_label: "Error dynamics" } });
    await ok("POST", `/api/board-items/${staged.uuid}/place`, { headers: dana.headers, json: { x: 10, y: 10 } });
    await ok("POST", `/api/boards/${waiting.uuid}/staging`, { headers: dana.headers, json: { excerpt_text: "Not yet.", source_url, source_label: "Error dynamics" } });

    const listed = await ok("GET", `/api/projects/${project.uuid}`, { headers: dana.headers });
    expect(listed.papers[0].board_uuids).toEqual([board.uuid]);
  });
});

describe("digs", () => {
  it("holds one dig per person on a thing, with its own text, which anyone in the project posts in", async () => {
    const { dana, ana, sam, project } = await group();
    await paperWithCopy(dana, A_PAPER, "Error dynamics", { shelfUuid: await defaultShelf(dana) });
    await ok("POST", `/api/projects/${project.uuid}/papers`, { headers: dana.headers, json: { paper_sha256: A_PAPER } });

    const before = await ok("GET", `/api/projects/${project.uuid}/digs?subject=paper:${A_PAPER}`, { headers: ana.headers });
    expect(before).toMatchObject({ mine: null, digs: [], subject: { kind: "paper", label: "Error dynamics" } });
    expect((await call("POST", `/api/projects/${project.uuid}/digs`, { headers: ana.headers, json: { subject: `paper:${A_PAPER}` } })).status).toBe(422);

    const dug = await ok("POST", `/api/projects/${project.uuid}/digs`, { headers: ana.headers, json: { subject: `paper:${A_PAPER}`, text: "Figure 3 disagrees with the model in section 2." } });
    expect(dug).toMatchObject({ is_mine: true, owner: { uuid: ana.uuid }, text: "Figure 3 disagrees with the model in section 2.", posts: [] });
    expect((await call("POST", `/api/projects/${project.uuid}/digs`, { headers: ana.headers, json: { subject: `paper:${A_PAPER}`, text: "Again" } })).status).toBe(409);
    // Dana posts in Ana's dig; her own dig on the paper is another.
    const answered = await ok("POST", `/api/digs/${dug.uuid}/posts`, { headers: dana.headers, json: { body: "It assumes a static turbulence profile." } });
    expect(answered).toMatchObject({ is_mine: false, owner: { uuid: ana.uuid } });
    expect(answered.posts.map((p: { body: string }) => p.body)).toEqual(["It assumes a static turbulence profile."]);
    const danas = await ok("POST", `/api/projects/${project.uuid}/digs`, { headers: dana.headers, json: { subject: `paper:${A_PAPER}`, text: "Worth a replication." } });
    expect(danas.uuid).not.toBe(dug.uuid);

    const listed = await ok("GET", `/api/projects/${project.uuid}`, { headers: ana.headers });
    expect(listed.digs).toHaveLength(2);
    const anas = listed.digs.find((d: { uuid: string }) => d.uuid === dug.uuid);
    expect(anas).toMatchObject({ post_count: 1, is_new: true, is_mine: true, owner: { uuid: ana.uuid }, excerpt: "Figure 3 disagrees with the model in section 2.", subject: { kind: "paper" } });
    expect(anas.last_post.excerpt).toBe("It assumes a static turbulence profile.");
    expect(listed.digs.find((d: { uuid: string }) => d.uuid === danas.uuid)).toMatchObject({ unread: 1, last_post: { excerpt: "Worth a replication.", user: { uuid: dana.uuid } } });
    const onPaper = await ok("GET", `/api/projects/${project.uuid}/digs?subject=paper:${A_PAPER}`, { headers: ana.headers });
    expect(onPaper.mine).toBe(dug.uuid);
    expect(onPaper.digs.map((d: { uuid: string }) => d.uuid).sort()).toEqual([dug.uuid, danas.uuid].sort());

    // Anyone in the project moves a dig through its phases, and only that
    // moves it. A dig that is not digging raises no news.
    expect(dug.phase).toBe("digging");
    expect((await ok("PUT", `/api/digs/${danas.uuid}/phase`, { headers: ana.headers, json: { phase: "stashed" } })).phase).toBe("stashed");
    await ok("POST", `/api/digs/${danas.uuid}/posts`, { headers: dana.headers, json: { body: "Still worth it." } });
    const stashed = (await ok("GET", `/api/projects/${project.uuid}`, { headers: ana.headers })).digs.find((d: { uuid: string }) => d.uuid === danas.uuid);
    expect(stashed).toMatchObject({ phase: "stashed", unread: 0, is_new: false });
    for (const phase of ["gold", "buried", "digging"]) {
      expect((await ok("PUT", `/api/digs/${danas.uuid}/phase`, { headers: dana.headers, json: { phase } })).phase).toBe(phase);
    }
    expect((await call("PUT", `/api/digs/${danas.uuid}/phase`, { headers: ana.headers, json: { phase: "done" } })).status).toBe(422);
    expect((await call("PUT", `/api/digs/${danas.uuid}/phase`, { headers: sam.headers, json: { phase: "gold" } })).status).toBe(403);

    expect((await call("GET", `/api/digs/${dug.uuid}`, { headers: sam.headers })).status).toBe(403);
    expect((await call("POST", `/api/digs/${dug.uuid}/posts`, { headers: sam.headers, json: { body: "x" } })).status).toBe(403);
    expect((await call("POST", `/api/projects/${project.uuid}/digs`, { headers: ana.headers, json: { subject: `paper:${"d".repeat(64)}`, text: "x" } })).status).toBe(404);
  });

  // Following a drift: the new idea becomes a card on another member's
  // project board, its dig opens with the drifting post quoted, and the old
  // dig points to it. Lists show each as plain words.
  it("digs into a drift as a new card, and lists posts as plain words", async () => {
    const { dana, ana, project } = await group();
    await paperWithCopy(dana, A_PAPER, "Error dynamics", { shelfUuid: await defaultShelf(dana) });
    await ok("POST", `/api/projects/${project.uuid}/papers`, { headers: dana.headers, json: { paper_sha256: A_PAPER } });
    const board = await boardIn(dana, project.uuid);
    const first = await ok("POST", `/api/projects/${project.uuid}/digs`, { headers: dana.headers, json: { subject: `paper:${A_PAPER}`, text: "Sparse attention might fix the lag." } });
    const card = await ok("POST", `/api/boards/${board.uuid}/comments`, { headers: ana.headers, json: { content: "Sparse attention" } });
    const dug = await ok("POST", `/api/projects/${project.uuid}/digs`, { headers: ana.headers, json: { subject: `card:${card.uuid}`, text: "> Dana: Sparse attention might fix the lag.\n\nWho has **tried** it?" } });
    await ok("POST", `/api/digs/${first.uuid}/posts`, { headers: ana.headers, json: { body: `Dug into [Sparse attention](/dig/${dug.uuid})` } });

    const listed = await ok("GET", `/api/projects/${project.uuid}`, { headers: dana.headers });
    const excerpts = Object.fromEntries(listed.digs.map((d: { subject: { key: string }; last_post: { excerpt: string } }) => [d.subject.key, d.last_post.excerpt]));
    expect(excerpts).toEqual({ [`paper:${A_PAPER}`]: "Dug into Sparse attention", [`card:${card.uuid}`]: "Who has tried it?" });
  });

  it("digs a card on a project board and marks it on the board, every member's dig in one pin", async () => {
    const { dana, ana, project } = await group();
    const board = await boardIn(dana, project.uuid);
    const card = await ok("POST", `/api/boards/${board.uuid}/comments`, { headers: dana.headers, json: { content: "Adaptive optics for retinal imaging" } });
    const dug = await ok("POST", `/api/projects/${project.uuid}/digs`, { headers: ana.headers, json: { subject: `card:${card.uuid}`, text: "Who has tried this?" } });
    expect(dug.subject).toMatchObject({ kind: "card", board_uuid: board.uuid, label: "Adaptive optics for retinal imaging" });
    const shown = await ok("GET", `/api/boards/${board.uuid}`, { headers: dana.headers });
    expect(shown.digs).toEqual({
      [`card:${card.uuid}`]: { uuid: dug.uuid, mine: null, dig_count: 1, post_count: 0, unread: 1, is_new: true, voices: [expect.objectContaining({ uuid: ana.uuid })] },
    });
    const own = await ok("POST", `/api/projects/${project.uuid}/digs`, { headers: dana.headers, json: { subject: `card:${card.uuid}`, text: "Me." } });
    await ok("POST", `/api/digs/${dug.uuid}/posts`, { headers: dana.headers, json: { body: "And me." } });
    const again = await ok("GET", `/api/boards/${board.uuid}`, { headers: dana.headers });
    expect(again.digs[`card:${card.uuid}`]).toMatchObject({ uuid: own.uuid, mine: own.uuid, dig_count: 2, post_count: 1, unread: 1 });
  });

  it("digs a paper and a card, never a thought, a board, the project itself, another dig or a post", async () => {
    const { dana, ana, sam, project } = await group();
    await paperWithCopy(dana, A_PAPER, "Error dynamics", { shelfUuid: await defaultShelf(dana) });
    await ok("POST", `/api/projects/${project.uuid}/papers`, { headers: dana.headers, json: { paper_sha256: A_PAPER } });
    const board = await boardIn(dana, project.uuid, "Bench plan");
    const nope = async (subject: string, account = ana) => (await call("POST", `/api/projects/${project.uuid}/digs`, { headers: account.headers, json: { subject, text: "x" } })).status;

    expect(await nope("project")).toBe(422);
    expect(await nope(`board:${board.uuid}`)).toBe(422);
    expect(await nope(`take:${A_PAPER}:${dana.uuid}`)).toBe(422);
    const other = await ok("POST", `/api/projects/${project.uuid}/digs`, { headers: dana.headers, json: { subject: `paper:${A_PAPER}`, text: "Mine." } });
    await ok("POST", `/api/digs/${other.uuid}/posts`, { headers: ana.headers, json: { body: "Yours." } });
    expect(await nope(`dig:${other.uuid}`)).toBe(422);
    expect(await nope(`post:${other.uuid}`)).toBe(422);
    expect(await nope("shelf:1")).toBe(422);
    expect(await nope(`paper:${A_PAPER}`, sam)).toBe(403);

    // Below the routes, the table itself holds a dig to one of the three.
    const insert = (subject: string, paper: string | null, card: string | null, annotation: string | null) => exec(
      `INSERT INTO digs (uuid, user_uuid, project_uuid, subject, paper_sha256, board_item_uuid, annotation_uuid, text, created_at, updated_at)
       VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, 'x', datetime('now'), datetime('now'))`,
      sam.uuid, project.uuid, subject, paper, card, annotation);
    await expect(insert(`dig:${other.uuid}`, null, null, null)).rejects.toThrow(/CHECK/);
    await expect(insert(`post:${other.uuid}`, A_PAPER, null, null)).rejects.toThrow(/CHECK/);
    await expect(insert(`board:${board.uuid}`, null, board.uuid, null)).rejects.toThrow(/CHECK/);
    await expect(insert(`paper:${A_PAPER}`, A_PAPER, board.uuid, null)).rejects.toThrow(/CHECK/);
  });

  it("lets its owner reword or remove a dig, a writer edit a post, and a writer or keeper take one back", async () => {
    const { dana, ana, project } = await group();
    await paperWithCopy(dana, A_PAPER, "Error dynamics", { shelfUuid: await defaultShelf(dana) });
    await ok("POST", `/api/projects/${project.uuid}/papers`, { headers: dana.headers, json: { paper_sha256: A_PAPER } });
    const dug = await ok("POST", `/api/projects/${project.uuid}/digs`, { headers: ana.headers, json: { subject: `paper:${A_PAPER}`, text: "First" } });
    expect((await call("PUT", `/api/digs/${dug.uuid}`, { headers: dana.headers, json: { text: "Nope" } })).status).toBe(403);
    expect(await ok("PUT", `/api/digs/${dug.uuid}`, { headers: ana.headers, json: { text: "First, at more length" } })).toMatchObject({ text: "First, at more length", edited_at: expect.any(String) });

    const post = (await ok("POST", `/api/digs/${dug.uuid}/posts`, { headers: ana.headers, json: { body: "More" } })).posts[0].uuid;
    expect((await call("PUT", `/api/dig-posts/${post}`, { headers: dana.headers, json: { body: "Nope" } })).status).toBe(403);
    expect((await ok("PUT", `/api/dig-posts/${post}`, { headers: ana.headers, json: { body: "More still" } })).posts[0]).toMatchObject({ body: "More still", edited_at: expect.any(String) });
    expect((await ok("DELETE", `/api/dig-posts/${post}`, { headers: dana.headers })).posts).toEqual([]);
    expect(await row("SELECT 1 FROM digs WHERE uuid = ?", dug.uuid)).not.toBeNull();

    const danas = await ok("POST", `/api/projects/${project.uuid}/digs`, { headers: dana.headers, json: { subject: `paper:${A_PAPER}`, text: "Hers" } });
    expect((await call("DELETE", `/api/digs/${danas.uuid}`, { headers: ana.headers })).status).toBe(403);
    expect((await call("DELETE", `/api/digs/${dug.uuid}`, { headers: ana.headers })).status).toBe(204);
    expect(await row("SELECT 1 FROM digs WHERE uuid = ?", dug.uuid)).toBeNull();
  });
});


