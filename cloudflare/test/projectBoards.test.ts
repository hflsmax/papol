// A project's boards and discussions: members make and edit boards
// together, and write at length about a paper or a card, one discussion
// to a subject.
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

  it("discusses a card on a project board and marks it on the board", async () => {
    const { dana, ana, project } = await group();
    const board = await boardIn(dana, project.uuid);
    const card = await ok("POST", `/api/boards/${board.uuid}/comments`, { headers: dana.headers, json: { content: "Adaptive optics for retinal imaging" } });
    const opened = await ok("POST", `/api/projects/${project.uuid}/discussions`, { headers: ana.headers, json: { board_item_uuid: card.uuid, body: "Who has tried this?" } });
    expect(opened.subject).toMatchObject({ kind: "card", board_uuid: board.uuid, label: "Adaptive optics for retinal imaging" });
    const shown = await ok("GET", `/api/boards/${board.uuid}`, { headers: dana.headers });
    expect(shown.discussions).toEqual({ [card.uuid]: opened.uuid });
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
