// Projects through the API: one person's, then a group's by invitation,
// what members see of each other's copies, and what stays when people go.
import { describe, expect, it } from "vitest";

import { call, defaultShelf, exec, ok, paperWithCopy, register, row, type Account } from "./helpers";

const A_PAPER = "a".repeat(64);
const B_PAPER = "b".repeat(64);

async function copyOf(account: Account, digest: string, title: string) {
  const existing = await row("SELECT 1 FROM papers WHERE sha256 = ?", digest);
  if (!existing) return paperWithCopy(account, digest, title, { shelfUuid: await defaultShelf(account) });
  const at = new Date().toISOString();
  const copyUuid = crypto.randomUUID();
  await exec("INSERT INTO copies (uuid, paper_sha256, user_uuid, shelf_uuid, is_author, created_at, updated_at, revision) VALUES (?, ?, ?, ?, 0, ?, ?, 0)",
    copyUuid, digest, account.uuid, await defaultShelf(account), at, at);
  return copyUuid;
}

async function start(account: Account, name = "Error dynamics"): Promise<{ uuid: string } & Record<string, any>> {
  return (await ok("POST", "/api/projects", { headers: account.headers, json: { name } })) as { uuid: string } & Record<string, any>;
}

async function invite(keeper: Account, project: { uuid: string }, ...joiners: Account[]) {
  const { invite_code } = await ok("POST", `/api/projects/${project.uuid}/invite`, { headers: keeper.headers });
  for (const joiner of joiners) await ok("POST", `/api/project-invites/${invite_code}`, { headers: joiner.headers });
  return invite_code as string;
}

describe("a project of one", () => {
  it("is started by its keeper, who adds papers they hold without moving their copy", async () => {
    const dana = await register();
    const project = await start(dana, "  Error   dynamics ");
    expect(project).toMatchObject({ name: "Error dynamics", is_member: true, is_keeper: true, papers: [] });
    expect(project.members.map((m: any) => [m.user.uuid, m.is_keeper])).toEqual([[dana.uuid, true]]);

    const copy = await copyOf(dana, A_PAPER, "Loss Curves");
    const shelf = (await row<{ shelf_uuid: string }>("SELECT shelf_uuid FROM copies WHERE uuid = ?", copy))!.shelf_uuid;
    const added = await ok("POST", `/api/projects/${project.uuid}/papers`, { headers: dana.headers, json: { paper_sha256: A_PAPER } });
    expect(added.papers.map((p: any) => [p.sha256, p.title, p.added_by.uuid, p.is_new, p.in_my_nook])).toEqual([[A_PAPER, "Loss Curves", dana.uuid, false, true]]);
    expect((await row<{ shelf_uuid: string }>("SELECT shelf_uuid FROM copies WHERE uuid = ?", copy))!.shelf_uuid).toBe(shelf);

    // Adding it again changes nothing; a paper Dana does not hold cannot be added.
    expect((await ok("POST", `/api/projects/${project.uuid}/papers`, { headers: dana.headers, json: { paper_sha256: A_PAPER } })).papers).toHaveLength(1);
    const unheld = await call("POST", `/api/projects/${project.uuid}/papers`, { headers: dana.headers, json: { paper_sha256: B_PAPER } });
    expect(unheld.status).toBe(400);
  });

  it("is listed to everyone by name and members, keepers marked, and opens only for members", async () => {
    const dana = await register();
    const project = await start(dana);
    await copyOf(dana, A_PAPER, "Loss Curves");
    await ok("POST", `/api/projects/${project.uuid}/papers`, { headers: dana.headers, json: { paper_sha256: A_PAPER } });

    const stranger = await register();
    const listed = (await ok("GET", "/api/projects", { headers: stranger.headers })).find((p: any) => p.uuid === project.uuid);
    expect(listed).toMatchObject({ name: "Error dynamics", is_member: false, new_count: 0 });
    expect(listed.members).toEqual([expect.objectContaining({ user: expect.objectContaining({ uuid: dana.uuid }), is_keeper: true })]);

    const opened = await ok("GET", `/api/projects/${project.uuid}`, { headers: stranger.headers });
    expect(opened.is_member).toBe(false);
    expect(opened.papers).toBeUndefined();
    expect(opened.invite_code).toBeUndefined();
    await copyOf(stranger, A_PAPER, "Loss Curves");
    expect((await call("POST", `/api/projects/${project.uuid}/papers`, { headers: stranger.headers, json: { paper_sha256: A_PAPER } })).status).toBe(403);
    expect((await call("POST", `/api/projects/${project.uuid}/invite`, { headers: stranger.headers })).status).toBe(403);

    const nook = await ok("GET", `/api/users/${dana.uuid}/nook`, { headers: stranger.headers });
    expect(nook.projects.map((p: any) => [p.name, p.is_member])).toEqual([["Error dynamics", false]]);
  });
});

describe("joining by invitation", () => {
  it("gives one link per project, lets anyone signed in join with it, and stops when revoked", async () => {
    const dana = await register(), ana = await register(), ben = await register();
    const project = await start(dana);
    const code = await invite(dana, project, ana);
    expect((await ok("POST", `/api/projects/${project.uuid}/invite`, { headers: dana.headers })).invite_code).toBe(code);

    const preview = await ok("GET", `/api/project-invites/${code}`, { headers: ben.headers });
    expect(preview).toMatchObject({ name: "Error dynamics", is_member: false });
    expect(preview.members).toHaveLength(2);

    // A member who is not a keeper cannot see or hand out the link.
    const asAna = await ok("GET", `/api/projects/${project.uuid}`, { headers: ana.headers });
    expect(asAna).toMatchObject({ is_member: true, is_keeper: false, invite_code: null });
    expect((await call("POST", `/api/projects/${project.uuid}/invite`, { headers: ana.headers })).status).toBe(403);

    await ok("DELETE", `/api/projects/${project.uuid}/invite`, { headers: dana.headers });
    expect((await call("POST", `/api/project-invites/${code}`, { headers: ben.headers })).status).toBe(404);
    expect((await ok("GET", `/api/projects/${project.uuid}`, { headers: ana.headers })).is_member).toBe(true);
    const fresh = await invite(dana, project, ben);
    expect(fresh).not.toBe(code);
    expect((await ok("GET", `/api/projects/${project.uuid}`, { headers: ben.headers })).members).toHaveLength(3);
  });
});

describe("what members see of each other", () => {
  it("shows every member's copy of a project paper, on any shelf, with only its public fields", async () => {
    const dana = await register(), ana = await register();
    const project = await start(dana);
    await invite(dana, project, ana);
    await copyOf(dana, A_PAPER, "Loss Curves");
    const anasCopy = await copyOf(ana, A_PAPER, "Loss Curves");
    // Ana keeps it on a private shelf, with a public thought and a private summary.
    await exec("UPDATE shelves SET is_public = 0 WHERE user_uuid = ?", ana.uuid);
    await exec("UPDATE copies SET thought = ?, summary = ?, thought_public = 1, summary_public = 0 WHERE uuid = ?", "The dip is the schedule", "My private summary", anasCopy);
    const outsider = await register();
    await copyOf(outsider, A_PAPER, "Loss Curves");

    const opened = await ok("POST", `/api/projects/${project.uuid}/papers`, { headers: dana.headers, json: { paper_sha256: A_PAPER } });
    const users = opened.papers[0].users;
    expect(users.map((u: any) => u.user.uuid).sort()).toEqual([dana.uuid, ana.uuid].sort());
    expect(users.find((u: any) => u.user.uuid === ana.uuid)).toMatchObject({ thought: "The dip is the schedule", summary: null });

    // The Library still names nobody for a copy on a private shelf.
    const library = await ok("GET", `/api/papers/${A_PAPER.slice(0, 32)}`, { headers: outsider.headers });
    expect(JSON.stringify(library)).not.toContain("The dip is the schedule");
  });
});

describe("what is new", () => {
  it("counts what others added since a member last opened the project", async () => {
    const dana = await register(), ana = await register();
    const project = await start(dana);
    await invite(dana, project, ana);
    await copyOf(ana, A_PAPER, "Loss Curves");
    await copyOf(dana, B_PAPER, "Warmup");
    await ok("POST", `/api/projects/${project.uuid}/papers`, { headers: ana.headers, json: { paper_sha256: A_PAPER } });
    await ok("POST", `/api/projects/${project.uuid}/papers`, { headers: dana.headers, json: { paper_sha256: B_PAPER } });

    const mine = (await ok("GET", "/api/projects", { headers: dana.headers })).find((p: any) => p.uuid === project.uuid);
    expect(mine.new_count).toBe(1);
    const opened = await ok("GET", `/api/projects/${project.uuid}`, { headers: dana.headers });
    expect(opened.papers.map((p: any) => [p.sha256, p.is_new])).toEqual(expect.arrayContaining([[A_PAPER, true], [B_PAPER, false]]));
    expect((await ok("GET", "/api/projects", { headers: dana.headers })).find((p: any) => p.uuid === project.uuid).new_count).toBe(0);
  });

  it("says, for a paper, which of my projects hold it", async () => {
    const dana = await register();
    const one = await start(dana, "One"), two = await start(dana, "Two");
    await copyOf(dana, A_PAPER, "Loss Curves");
    await ok("POST", `/api/projects/${one.uuid}/papers`, { headers: dana.headers, json: { paper_sha256: A_PAPER } });
    const listed = await ok("GET", `/api/projects?paper=${A_PAPER}`, { headers: dana.headers });
    expect(listed.filter((p: any) => [one.uuid, two.uuid].includes(p.uuid)).map((p: any) => [p.name, p.has_paper])).toEqual([["One", true], ["Two", false]]);
  });
});

describe("people going", () => {
  it("keeps a keeper while anyone is in it, and ends a project nobody is in", async () => {
    const dana = await register(), ana = await register();
    const project = await start(dana);
    await invite(dana, project, ana);
    const refused = await call("DELETE", `/api/projects/${project.uuid}/members/${dana.uuid}`, { headers: dana.headers });
    expect(refused.status).toBe(400);
    await ok("PUT", `/api/projects/${project.uuid}/members/${ana.uuid}`, { headers: dana.headers, json: { is_keeper: true } });
    await ok("DELETE", `/api/projects/${project.uuid}/members/${dana.uuid}`, { headers: dana.headers });
    expect((await ok("GET", `/api/projects/${project.uuid}`, { headers: dana.headers })).is_member).toBe(false);
    await ok("DELETE", `/api/projects/${project.uuid}/members/${ana.uuid}`, { headers: ana.headers });
    expect((await call("GET", `/api/projects/${project.uuid}`, { headers: ana.headers })).status).toBe(404);
  });

  it("leaves the papers someone added, and only the adder or a keeper takes one out", async () => {
    const dana = await register(), ana = await register(), ben = await register();
    const project = await start(dana);
    await invite(dana, project, ana, ben);
    await copyOf(ana, A_PAPER, "Loss Curves");
    await ok("POST", `/api/projects/${project.uuid}/papers`, { headers: ana.headers, json: { paper_sha256: A_PAPER } });
    expect((await call("DELETE", `/api/projects/${project.uuid}/papers/${A_PAPER}`, { headers: ben.headers })).status).toBe(403);
    await ok("DELETE", `/api/projects/${project.uuid}/members/${ana.uuid}`, { headers: ana.headers });
    const after = await ok("GET", `/api/projects/${project.uuid}`, { headers: dana.headers });
    expect(after.papers.map((p: any) => p.sha256)).toEqual([A_PAPER]);
    expect(after.papers[0].users).toEqual([]);
    await ok("DELETE", `/api/projects/${project.uuid}/papers/${A_PAPER}`, { headers: dana.headers });
    expect((await ok("GET", `/api/projects/${project.uuid}`, { headers: dana.headers })).papers).toEqual([]);
  });

  it("hands a closing keeper's project to the earliest member left", async () => {
    const dana = await register(), ana = await register(), ben = await register();
    const project = await start(dana);
    await invite(dana, project, ana, ben);
    await ok("DELETE", "/api/auth/account", { headers: dana.headers, json: { confirm_email: dana.email } });
    const seen = await ok("GET", `/api/projects/${project.uuid}`, { headers: ben.headers });
    expect(seen.members.map((m: any) => [m.user.uuid, m.is_keeper])).toEqual([[ana.uuid, true], [ben.uuid, false]]);
    const solo = await start(ben, "Alone");
    await ok("DELETE", "/api/auth/account", { headers: ben.headers, json: { confirm_email: ben.email } });
    expect(await row("SELECT deleted_at FROM projects WHERE uuid = ?", solo.uuid)).toEqual({ deleted_at: expect.any(String) });
  });
});
