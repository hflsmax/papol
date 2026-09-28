// A project's boards and discussions: members make and edit boards
// together, and talk about anything the project holds, one discussion to
// a subject.
import { describe, expect, it } from "vitest";

import { call, defaultShelf, ok, paperWithCopy, register, row, type Account } from "./helpers";

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
  it("holds one dig per person on a thing, which anyone in the project writes in, and lists it with what is new", async () => {
    const { dana, ana, sam, project } = await group();
    await paperWithCopy(dana, A_PAPER, "Error dynamics", { shelfUuid: await defaultShelf(dana) });
    await ok("POST", `/api/projects/${project.uuid}/papers`, { headers: dana.headers, json: { paper_sha256: A_PAPER } });

    const before = await ok("GET", `/api/projects/${project.uuid}/digs?subject=paper:${A_PAPER}`, { headers: ana.headers });
    expect(before).toMatchObject({ mine: null, digs: [], subject: { kind: "paper", label: "Error dynamics" } });

    const opened = await ok("POST", `/api/projects/${project.uuid}/digs`, { headers: ana.headers, json: { subject: `paper:${A_PAPER}`, body: "Figure 3 disagrees with the model in section 2." } });
    expect(opened).toMatchObject({ is_mine: true, owner: { uuid: ana.uuid } });
    const again = await ok("POST", `/api/projects/${project.uuid}/digs`, { headers: ana.headers, json: { subject: `paper:${A_PAPER}`, body: "And figure 4." } });
    expect(again.uuid).toBe(opened.uuid);
    // Dana writes in Ana's dig; her own dig on the paper is another.
    const answered = await ok("POST", `/api/digs/${opened.uuid}/posts`, { headers: dana.headers, json: { body: "It assumes a static turbulence profile." } });
    expect(answered).toMatchObject({ is_mine: false, owner: { uuid: ana.uuid } });
    expect(answered.posts.map((p: { body: string }) => p.body)).toHaveLength(3);
    const danas = await ok("POST", `/api/projects/${project.uuid}/digs`, { headers: dana.headers, json: { subject: `paper:${A_PAPER}`, body: "Worth a replication." } });
    expect(danas.uuid).not.toBe(opened.uuid);

    const listed = await ok("GET", `/api/projects/${project.uuid}`, { headers: ana.headers });
    expect(listed.discussions).toHaveLength(2);
    const anas = listed.discussions.find((d: { uuid: string }) => d.uuid === opened.uuid);
    expect(anas).toMatchObject({ post_count: 3, is_new: true, is_mine: true, owner: { uuid: ana.uuid }, subject: { kind: "paper" } });
    expect(anas.last_post.excerpt).toBe("It assumes a static turbulence profile.");
    const onPaper = await ok("GET", `/api/projects/${project.uuid}/digs?subject=paper:${A_PAPER}`, { headers: ana.headers });
    expect(onPaper.mine).toBe(opened.uuid);
    expect(onPaper.digs.map((d: { uuid: string }) => d.uuid).sort()).toEqual([opened.uuid, danas.uuid].sort());
    // What older builds ask still leads to the reader's own dig.
    expect((await ok("GET", `/api/projects/${project.uuid}/discussion?paper=${A_PAPER}`, { headers: dana.headers })).discussion_uuid).toBe(danas.uuid);

    expect((await call("GET", `/api/digs/${opened.uuid}`, { headers: sam.headers })).status).toBe(403);
    expect((await call("POST", `/api/digs/${opened.uuid}/posts`, { headers: sam.headers, json: { body: "x" } })).status).toBe(403);
    expect((await call("POST", `/api/projects/${project.uuid}/digs`, { headers: ana.headers, json: { subject: `paper:${"d".repeat(64)}`, body: "x" } })).status).toBe(404);
  });

  // Following a drift: the new idea becomes a card on another member's
  // project board, its dig opens with the drifting post quoted, and the old
  // dig points to it. Lists show each as plain words.
  it("digs into a drift as a new card, and lists posts as plain words", async () => {
    const { dana, ana, project } = await group();
    const board = await boardIn(dana, project.uuid);
    const first = await ok("POST", `/api/projects/${project.uuid}/digs`, { headers: dana.headers, json: { subject: `board:${board.uuid}`, body: "Sparse attention might fix the lag." } });
    const card = await ok("POST", `/api/boards/${board.uuid}/comments`, { headers: ana.headers, json: { content: "Sparse attention" } });
    const dug = await ok("POST", `/api/projects/${project.uuid}/digs`, { headers: ana.headers, json: { subject: `card:${card.uuid}`, body: "> Dana: Sparse attention might fix the lag.\n\nWho has **tried** it?" } });
    await ok("POST", `/api/digs/${first.uuid}/posts`, { headers: ana.headers, json: { body: `Dug into [Sparse attention](/discussion/${dug.uuid})` } });

    const listed = await ok("GET", `/api/projects/${project.uuid}`, { headers: dana.headers });
    const excerpts = Object.fromEntries(listed.discussions.map((d: { subject: { key: string }; last_post: { excerpt: string } }) => [d.subject.key, d.last_post.excerpt]));
    expect(excerpts).toEqual({ [`board:${board.uuid}`]: "Dug into Sparse attention", [`card:${card.uuid}`]: "Who has tried it?" });
  });

  it("digs a card on a project board and marks it on the board, every member's dig in one pin", async () => {
    const { dana, ana, project } = await group();
    const board = await boardIn(dana, project.uuid);
    const card = await ok("POST", `/api/boards/${board.uuid}/comments`, { headers: dana.headers, json: { content: "Adaptive optics for retinal imaging" } });
    const opened = await ok("POST", `/api/projects/${project.uuid}/digs`, { headers: ana.headers, json: { board_item_uuid: card.uuid, body: "Who has tried this?" } });
    expect(opened.subject).toMatchObject({ kind: "card", board_uuid: board.uuid, label: "Adaptive optics for retinal imaging" });
    const shown = await ok("GET", `/api/boards/${board.uuid}`, { headers: dana.headers });
    expect(shown.discussions).toEqual({
      [`card:${card.uuid}`]: { uuid: opened.uuid, mine: null, dig_count: 1, post_count: 1, unread: 1, is_new: true, voices: [expect.objectContaining({ uuid: ana.uuid })] },
    });
    const own = await ok("POST", `/api/projects/${project.uuid}/digs`, { headers: dana.headers, json: { subject: `card:${card.uuid}`, body: "Me." } });
    const again = await ok("GET", `/api/boards/${board.uuid}`, { headers: dana.headers });
    expect(again.discussions[`card:${card.uuid}`]).toMatchObject({ uuid: own.uuid, mine: own.uuid, dig_count: 2, post_count: 2, unread: 1 });
  });

  it("digs into a board and a member's thought on a paper, never the project itself", async () => {
    const { dana, ana, sam, project } = await group();
    await paperWithCopy(dana, A_PAPER, "Error dynamics", { shelfUuid: await defaultShelf(dana) });
    await ok("POST", `/api/projects/${project.uuid}/papers`, { headers: dana.headers, json: { paper_sha256: A_PAPER } });
    const board = await boardIn(dana, project.uuid, "Bench plan");

    expect((await call("POST", `/api/projects/${project.uuid}/digs`, { headers: ana.headers, json: { subject: "project", body: "Weekly sync on Friday?" } })).status).toBe(422);
    // Nor another dig, nor a post in one.
    const other = await ok("POST", `/api/projects/${project.uuid}/digs`, { headers: dana.headers, json: { subject: `paper:${A_PAPER}`, body: "Mine." } });
    expect((await call("POST", `/api/projects/${project.uuid}/digs`, { headers: ana.headers, json: { subject: `dig:${other.uuid}`, body: "x" } })).status).toBe(422);
    expect((await call("POST", `/api/projects/${project.uuid}/digs`, { headers: ana.headers, json: { subject: `post:${other.posts[0].uuid}`, body: "x" } })).status).toBe(422);
    const onBoard = await ok("POST", `/api/projects/${project.uuid}/digs`, { headers: ana.headers, json: { subject: `board:${board.uuid}`, body: "Too many cards." } });
    expect(onBoard.subject).toMatchObject({ key: `board:${board.uuid}`, kind: "board", board_uuid: board.uuid, label: "Bench plan" });
    const take = `take:${A_PAPER}:${dana.uuid}`;
    const onTake = await ok("POST", `/api/projects/${project.uuid}/digs`, { headers: ana.headers, json: { subject: take, body: "Why only 3/5?" } });
    expect(onTake.subject).toMatchObject({ key: take, kind: "take", paper_sha256: A_PAPER, user_uuid: dana.uuid });
    // A thought and its paper are two subjects.
    const onPaper = await ok("POST", `/api/projects/${project.uuid}/digs`, { headers: ana.headers, json: { subject: `paper:${A_PAPER}`, body: "Section 3." } });
    expect(onPaper.uuid).not.toBe(onTake.uuid);

    const found = await ok("GET", `/api/projects/${project.uuid}/digs?subject=${encodeURIComponent(take)}`, { headers: dana.headers });
    expect(found).toMatchObject({ mine: null, discussion_uuid: onTake.uuid });
    const shown = await ok("GET", `/api/boards/${board.uuid}`, { headers: dana.headers });
    expect(Object.keys(shown.discussions)).toEqual([`board:${board.uuid}`]);

    // Only members, and only about what the project holds.
    expect((await call("POST", `/api/projects/${project.uuid}/digs`, { headers: ana.headers, json: { subject: `take:${A_PAPER}:${sam.uuid}`, body: "x" } })).status).toBe(404);
    expect((await call("POST", `/api/projects/${project.uuid}/digs`, { headers: ana.headers, json: { subject: "shelf:1", body: "x" } })).status).toBe(422);
    expect((await call("POST", `/api/projects/${project.uuid}/digs`, { headers: sam.headers, json: { subject: `board:${board.uuid}`, body: "x" } })).status).toBe(403);
  });

  it("lets a writer edit, and a writer or keeper take back; the last post closes it", async () => {
    const { dana, ana, project } = await group();
    await paperWithCopy(dana, A_PAPER, "Error dynamics", { shelfUuid: await defaultShelf(dana) });
    await ok("POST", `/api/projects/${project.uuid}/papers`, { headers: dana.headers, json: { paper_sha256: A_PAPER } });
    const opened = await ok("POST", `/api/projects/${project.uuid}/digs`, { headers: ana.headers, json: { subject: `paper:${A_PAPER}`, body: "First" } });
    const post = opened.posts[0].uuid;
    expect((await call("PUT", `/api/dig-posts/${post}`, { headers: dana.headers, json: { body: "Nope" } })).status).toBe(403);
    const edited = await ok("PUT", `/api/dig-posts/${post}`, { headers: ana.headers, json: { body: "First, at more length" } });
    expect(edited.posts[0]).toMatchObject({ body: "First, at more length", edited_at: expect.any(String) });
    await ok("DELETE", `/api/dig-posts/${post}`, { headers: dana.headers });
    expect(await row("SELECT 1 FROM digs WHERE uuid = ?", opened.uuid)).toBeNull();
  });

  // The paths older Mac builds ask at lead to the same digs.
  it("answers at the old discussion paths", async () => {
    const { dana, ana, project } = await group();
    const board = await boardIn(dana, project.uuid);
    const opened = await ok("POST", `/api/projects/${project.uuid}/discussions`, { headers: ana.headers, json: { subject: `board:${board.uuid}`, body: "First" } });
    await ok("POST", `/api/discussions/${opened.uuid}/posts`, { headers: dana.headers, json: { body: "Second" } });
    const post = (await ok("GET", `/api/discussions/${opened.uuid}`, { headers: ana.headers })).posts[0].uuid;
    await ok("PUT", `/api/discussion-posts/${post}`, { headers: ana.headers, json: { body: "First!" } });
    const left = await ok("DELETE", `/api/discussion-posts/${post}`, { headers: ana.headers });
    expect(left.posts.map((p: { body: string }) => p.body)).toEqual(["Second"]);
  });
});

