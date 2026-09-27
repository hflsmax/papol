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

describe("discussions", () => {
  it("opens one discussion per paper, and lists it with what is new", async () => {
    const { dana, ana, sam, project } = await group();
    await paperWithCopy(dana, A_PAPER, "Error dynamics", { shelfUuid: await defaultShelf(dana) });
    await ok("POST", `/api/projects/${project.uuid}/papers`, { headers: dana.headers, json: { paper_sha256: A_PAPER } });

    const before = await ok("GET", `/api/projects/${project.uuid}/discussion?paper=${A_PAPER}`, { headers: ana.headers });
    expect(before).toMatchObject({ discussion_uuid: null, subject: { kind: "paper", label: "Error dynamics" } });

    const opened = await ok("POST", `/api/projects/${project.uuid}/discussions`, { headers: ana.headers, json: { paper_sha256: A_PAPER, body: "Figure 3 disagrees with the model in section 2." } });
    const again = await ok("POST", `/api/projects/${project.uuid}/discussions`, { headers: dana.headers, json: { paper_sha256: A_PAPER, body: "It assumes a static turbulence profile." } });
    expect(again.uuid).toBe(opened.uuid);
    expect(again.posts.map((p: { body: string }) => p.body)).toHaveLength(2);

    const listed = await ok("GET", `/api/projects/${project.uuid}`, { headers: ana.headers });
    expect(listed.discussions).toHaveLength(1);
    expect(listed.discussions[0]).toMatchObject({ post_count: 2, is_new: true, subject: { kind: "paper" } });
    expect(listed.discussions[0].last_post.excerpt).toBe("It assumes a static turbulence profile.");

    expect((await call("GET", `/api/discussions/${opened.uuid}`, { headers: sam.headers })).status).toBe(403);
    expect((await call("POST", `/api/projects/${project.uuid}/discussions`, { headers: ana.headers, json: { paper_sha256: "d".repeat(64), body: "x" } })).status).toBe(404);
  });

  // Digging into a drift: the new idea becomes a card on another member's
  // project board, its dig opens with the drifting post quoted, and the old
  // dig points to it. Lists show each as plain words.
  it("digs into a drift as a new card, and lists posts as plain words", async () => {
    const { dana, ana, project } = await group();
    const board = await boardIn(dana, project.uuid);
    const first = await ok("POST", `/api/projects/${project.uuid}/discussions`, { headers: dana.headers, json: { subject: "project", body: "Sparse attention might fix the lag." } });
    const card = await ok("POST", `/api/boards/${board.uuid}/comments`, { headers: ana.headers, json: { content: "Sparse attention" } });
    const dug = await ok("POST", `/api/projects/${project.uuid}/discussions`, { headers: ana.headers, json: { subject: `card:${card.uuid}`, body: "> Dana: Sparse attention might fix the lag.\n\nWho has **tried** it?" } });
    await ok("POST", `/api/discussions/${first.uuid}/posts`, { headers: ana.headers, json: { body: `Dug into [Sparse attention](/discussion/${dug.uuid})` } });

    const listed = await ok("GET", `/api/projects/${project.uuid}`, { headers: dana.headers });
    const excerpts = Object.fromEntries(listed.discussions.map((d: { subject: { key: string }; last_post: { excerpt: string } }) => [d.subject.key, d.last_post.excerpt]));
    expect(excerpts).toEqual({ project: "Dug into Sparse attention", [`card:${card.uuid}`]: "Who has tried it?" });
  });

  it("discusses a card on a project board and marks it on the board", async () => {
    const { dana, ana, project } = await group();
    const board = await boardIn(dana, project.uuid);
    const card = await ok("POST", `/api/boards/${board.uuid}/comments`, { headers: dana.headers, json: { content: "Adaptive optics for retinal imaging" } });
    const opened = await ok("POST", `/api/projects/${project.uuid}/discussions`, { headers: ana.headers, json: { board_item_uuid: card.uuid, body: "Who has tried this?" } });
    expect(opened.subject).toMatchObject({ kind: "card", board_uuid: board.uuid, label: "Adaptive optics for retinal imaging" });
    const shown = await ok("GET", `/api/boards/${board.uuid}`, { headers: dana.headers });
    expect(shown.discussions).toEqual({
      [`card:${card.uuid}`]: { uuid: opened.uuid, post_count: 1, is_new: true, voices: [expect.objectContaining({ uuid: ana.uuid })] },
    });
  });

  it("talks about the project, a board, and a member's thought on a paper", async () => {
    const { dana, ana, sam, project } = await group();
    await paperWithCopy(dana, A_PAPER, "Error dynamics", { shelfUuid: await defaultShelf(dana) });
    await ok("POST", `/api/projects/${project.uuid}/papers`, { headers: dana.headers, json: { paper_sha256: A_PAPER } });
    const board = await boardIn(dana, project.uuid, "Bench plan");

    const general = await ok("POST", `/api/projects/${project.uuid}/discussions`, { headers: ana.headers, json: { subject: "project", body: "Weekly sync on Friday?" } });
    expect(general.subject).toMatchObject({ key: "project", kind: "project", label: "Wavefronts" });
    const onBoard = await ok("POST", `/api/projects/${project.uuid}/discussions`, { headers: ana.headers, json: { subject: `board:${board.uuid}`, body: "Too many cards." } });
    expect(onBoard.subject).toMatchObject({ key: `board:${board.uuid}`, kind: "board", board_uuid: board.uuid, label: "Bench plan" });
    const take = `take:${A_PAPER}:${dana.uuid}`;
    const onTake = await ok("POST", `/api/projects/${project.uuid}/discussions`, { headers: ana.headers, json: { subject: take, body: "Why only 3/5?" } });
    expect(onTake.subject).toMatchObject({ key: take, kind: "take", paper_sha256: A_PAPER, user_uuid: dana.uuid });
    // A thought and its paper are two subjects.
    const onPaper = await ok("POST", `/api/projects/${project.uuid}/discussions`, { headers: ana.headers, json: { subject: `paper:${A_PAPER}`, body: "Section 3." } });
    expect(onPaper.uuid).not.toBe(onTake.uuid);

    const found = await ok("GET", `/api/projects/${project.uuid}/discussion?subject=${encodeURIComponent(take)}`, { headers: dana.headers });
    expect(found.discussion_uuid).toBe(onTake.uuid);
    const shown = await ok("GET", `/api/boards/${board.uuid}`, { headers: dana.headers });
    expect(Object.keys(shown.discussions)).toEqual([`board:${board.uuid}`]);

    // Only members, and only about what the project holds.
    expect((await call("POST", `/api/projects/${project.uuid}/discussions`, { headers: ana.headers, json: { subject: `take:${A_PAPER}:${sam.uuid}`, body: "x" } })).status).toBe(404);
    expect((await call("POST", `/api/projects/${project.uuid}/discussions`, { headers: ana.headers, json: { subject: "shelf:1", body: "x" } })).status).toBe(422);
    expect((await call("POST", `/api/projects/${project.uuid}/discussions`, { headers: sam.headers, json: { subject: "project", body: "x" } })).status).toBe(403);
  });

  it("lets a writer edit, and a writer or keeper take back; the last post closes it", async () => {
    const { dana, ana, project } = await group();
    await paperWithCopy(dana, A_PAPER, "Error dynamics", { shelfUuid: await defaultShelf(dana) });
    await ok("POST", `/api/projects/${project.uuid}/papers`, { headers: dana.headers, json: { paper_sha256: A_PAPER } });
    const opened = await ok("POST", `/api/projects/${project.uuid}/discussions`, { headers: ana.headers, json: { paper_sha256: A_PAPER, body: "First" } });
    const post = opened.posts[0].uuid;
    expect((await call("PUT", `/api/discussion-posts/${post}`, { headers: dana.headers, json: { body: "Nope" } })).status).toBe(403);
    const edited = await ok("PUT", `/api/discussion-posts/${post}`, { headers: ana.headers, json: { body: "First, at more length" } });
    expect(edited.posts[0]).toMatchObject({ body: "First, at more length", edited_at: expect.any(String) });
    await ok("DELETE", `/api/discussion-posts/${post}`, { headers: dana.headers });
    expect(await row("SELECT 1 FROM discussions WHERE uuid = ?", opened.uuid)).toBeNull();
  });
});
