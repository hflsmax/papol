// A sharable hands one user's reading of one paper to anyone with the
// link — and hands over nothing else in that user's nook. test_sharables.py,
// asked of the Worker.
import { beforeEach, describe, expect, it } from "vitest";

import { call, count, exec, ok, paperWithCopy, register, row, uuid, type Account, type Json } from "./helpers";

const SHARED = "a".repeat(64);
const OTHER = "b".repeat(64);
const name = (digest: string) => digest.slice(0, 32);

let ada: Account, grace: Account;
let marks = 0;

// An annotation written straight into the table, as the desktop would
// leave it, so that a user who keeps no copy can still have marked the page.
async function mark(user: Account, digest: string, kind: string, content: string, { page = null as number | null, body = {} as object, name = null as string | null } = {}) {
  const at = new Date(Date.now() - 60_000 + marks++ * 1000).toISOString();
  await exec("INSERT INTO annotations (uuid, kind, user_uuid, paper_sha256, page, content, name, body, created_at, updated_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
    uuid(), kind, user.uuid, digest, page, content, name, JSON.stringify(body), at, at);
}

async function privateShelf(user: Account): Promise<string> {
  return (await row<{ uuid: string }>("SELECT uuid FROM shelves WHERE user_uuid = ? AND is_public = 0", user.uuid))!.uuid;
}

beforeEach(async () => {
  ada = await register("user@example.com", "Ada");
  grace = await register("other@example.com", "Grace");
  const shelf = await privateShelf(ada);
  await paperWithCopy(ada, SHARED, "On sharing a reading", { shelfUuid: shelf });
  // Another PDF of the same work. A paper is its file, so this is a paper
  // of its own — and what Ada wrote on it is no part of the reading she shared.
  await paperWithCopy(ada, OTHER, "On sharing a reading", { shelfUuid: shelf });
  await mark(ada, SHARED, "note", "On the page", { page: 2, body: { anchor: { type: "point", x: 0.25, y: 0.5 } }, name: "Lemma 3" });
  await mark(ada, SHARED, "note", "About the paper");
  await mark(ada, OTHER, "note", "On the old PDF", { page: 1, body: { anchor: { type: "point", x: 0.1, y: 0.1 } } });
  await mark(grace, SHARED, "note", "Not yours", { page: 2, body: { anchor: { type: "point", x: 0.9, y: 0.9 } } });
  await mark(ada, SHARED, "ink", "", { page: 1, body: { points: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.2 }] } });
  await mark(grace, SHARED, "ink", "", { page: 1, body: { points: [{ x: 0.5, y: 0.5 }] } });
  await mark(ada, SHARED, "clip", "", { page: 1, body: { source: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, frame: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } } });
});

async function share(user: Account, includeAnnotations = true) {
  return ok("POST", `/api/papers/${name(SHARED)}/sharable`, { headers: user.headers, json: { include_annotations: includeAnnotations } });
}

async function opened(link: Json) {
  return call("GET", `/api/shared/${link.uuid}`);
}

async function graceKeepsItToo() {
  await exec("INSERT INTO copies (uuid, paper_sha256, user_uuid, is_author, created_at, updated_at, revision) VALUES (?, ?, ?, 0, ?, ?, 0)",
    uuid(), SHARED, grace.uuid, new Date().toISOString(), new Date().toISOString());
}

describe("the paper's own link", () => {
  it("carries the PDF alone, is the same link for everyone, names nobody, and is nobody's to take back", async () => {
    const lean = await share(ada, false);
    expect(lean.kind).toBe("lean");
    const reading = await (await opened(lean)).json() as Json;
    expect(reading).toMatchObject({ kind: "lean", user: null, annotations: [] });
    expect(reading.paper.sha256).toBe(SHARED);
    // The quiet link is what an unasked request gets.
    expect((await ok("POST", `/api/papers/${name(SHARED)}/sharable`, { headers: ada.headers })).kind).toBe("lean");

    // The paper's link and a reading of it are different links; having
    // handed over the first is no reason to be refused the second.
    const rich = await share(ada, true);
    expect(rich.kind).toBe("rich");
    expect(rich.uuid).not.toBe(lean.uuid);
    expect((await opened(rich)).status).toBe(200);
    expect((await opened(lean)).status).toBe(200);

    // The PDF's own address, not anyone's: two users handing the same
    // paper on hand on the same link.
    await graceKeepsItToo();
    expect((await share(grace, false)).uuid).toBe(lean.uuid);

    // Whoever asked for it first is not part of what it says, and nothing
    // reports it back to them: not on the paper page, not asked alone.
    await ok("DELETE", `/api/sharables/${rich.uuid}`, { headers: ada.headers });
    expect((await ok("GET", `/api/papers/${name(SHARED)}`, { headers: ada.headers })).sharable_uuid).toBeNull();
    expect((await call("GET", `/api/papers/${name(SHARED)}/sharable`, { headers: ada.headers })).json()).resolves.toBeNull();
    // Not theirs to revoke either.
    expect((await call("DELETE", `/api/sharables/${lean.uuid}`, { headers: ada.headers })).status).toBe(404);
    expect((await opened(lean)).status).toBe(200);
  });
});

describe("a reading's link", () => {
  it("opens this user's annotations on this paper and no others, for anyone, whatever shelf the paper sits on", async () => {
    // A user without a copy has no reading to share.
    expect((await call("POST", `/api/papers/${name(SHARED)}/sharable`, { headers: grace.headers, json: { include_annotations: true } })).status).toBe(403);

    const made = await share(ada);
    expect(made).toMatchObject({ kind: "rich", paper_sha256: SHARED });
    expect(made.uuid).not.toBe(SHARED);
    // Asking twice gives the same link back.
    expect((await share(ada)).uuid).toBe(made.uuid);
    // The paper page shows the user their own link; asked alone, the same answer.
    expect((await ok("GET", `/api/papers/${name(SHARED)}`, { headers: ada.headers })).sharable_uuid).toBe(made.uuid);
    expect((await ok("GET", `/api/papers/${name(SHARED)}/sharable`, { headers: ada.headers })).uuid).toBe(made.uuid);
    // Another user of the same paper is told nothing about it.
    await graceKeepsItToo();
    expect((await ok("GET", `/api/papers/${name(SHARED)}`, { headers: grace.headers })).sharable_uuid).toBeNull();
    expect((await call("GET", `/api/papers/${name(SHARED)}/sharable`, { headers: grace.headers })).json()).resolves.toBeNull();
    expect((await call("GET", "/api/papers/no-such-paper/sharable", { headers: grace.headers })).status).toBe(404);

    // The link needs no account.
    const response = await opened(made);
    expect(response.status).toBe(200);
    const reading = await response.json() as Json;
    expect(reading.user.display_name).toBe("Ada");
    expect(reading.paper).toMatchObject({ title: "On sharing a reading", sha256: SHARED, file_path: `${SHARED}.pdf` });
    // No uuid, and so no way to the paper's own page; no summary, which is private.
    expect(reading.paper).not.toHaveProperty("uuid");
    expect(reading.paper).not.toHaveProperty("summary");
    // One list, each saying its own kind, in the order they were made.
    const byKind: Record<string, any[]> = {};
    for (const row of reading.annotations) (byKind[row.kind] ??= []).push(row);
    expect(byKind.note.map((n) => n.content)).toEqual(["On the page", "About the paper"]);
    expect(byKind.note[0].body.anchor).toEqual({ type: "point", x: 0.25, y: 0.5 });
    expect(byKind.note[0].name).toBe("Lemma 3");
    expect(byKind.ink).toHaveLength(1);
    expect(byKind.clip).toHaveLength(1);

    // Sharing is not displaying: moving the paper between a public and a
    // private shelf leaves a link out in the open exactly as it was.
    const shelf = await privateShelf(ada);
    for (const displayed of [1, 0, 1]) {
      await exec("UPDATE shelves SET is_public = ? WHERE uuid = ?", displayed, shelf);
      const again = await (await opened(made)).json() as Json;
      expect(again).toMatchObject({ uuid: made.uuid, kind: "rich" });
      expect(again.annotations.length).toBeGreaterThan(0);
      expect(again.paper).not.toHaveProperty("uuid");
    }
  });

  it("closes when revoked, without pretending it never existed, and is not resurrected by sharing again", async () => {
    const first = await share(ada);
    expect((await call("DELETE", `/api/sharables/${first.uuid}`, { headers: ada.headers })).status).toBe(204);
    const gone = await opened(first);
    expect(gone.status).toBe(404);
    expect(((await gone.json()) as Json).detail).toBe("This reading is no longer shared");
    expect((await row("SELECT revoked_at FROM sharables WHERE uuid = ?", first.uuid))!.revoked_at).not.toBeNull();
    expect((await call("GET", `/api/papers/${name(SHARED)}/sharable`, { headers: ada.headers })).json()).resolves.toBeNull();

    const second = await share(ada);
    expect(second.uuid).not.toBe(first.uuid);
    expect((await opened(first)).status).toBe(404);
    expect((await opened(second)).status).toBe(200);

    // Only its maker may take a link back.
    expect((await call("DELETE", `/api/sharables/${second.uuid}`, { headers: grace.headers })).status).toBe(404);
    expect((await opened(second)).status).toBe(200);
  });

  it("turns lean when the paper leaves the nook, down either road, and stays lean when it comes back", async () => {
    const made = await share(ada);
    expect((await ok("DELETE", `/api/papers/${name(SHARED)}`, { headers: ada.headers })).message).toContain("removed");
    // The link still opens the PDF that was shared. What it no longer
    // carries is the reading, nor the user: the paper is nobody's.
    const response = await opened(made);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ kind: "lean", user: null, annotations: [], paper: { sha256: SHARED } });
    // The demotion is written down, so taking the paper back does not
    // silently hand the annotations back to whoever holds the link.
    await ok("POST", `/api/papers/${name(SHARED)}/add-to-nook`, { headers: ada.headers });
    expect((await (await opened(made)).json()) as Json).toMatchObject({ kind: "lean", annotations: [] });

    // Papol Desktop removes a paper by synchronizing a deleted copy, and
    // never calls the endpoint above. Both roads end up here.
    const synced = await share(ada);
    expect(synced.kind).toBe("rich");
    await exec("UPDATE copies SET deleted_at = ? WHERE user_uuid = ? AND paper_sha256 = ?", new Date().toISOString(), ada.uuid, SHARED);
    expect(((await (await opened(synced)).json()) as Json).kind).toBe("lean");
  });

  it("can drop its annotations instead of closing, which hands the link away", async () => {
    const made = await share(ada);
    // Only its maker may.
    expect((await call("POST", `/api/sharables/${made.uuid}/lean`, { headers: grace.headers })).status).toBe(404);
    const leaned = await ok("POST", `/api/sharables/${made.uuid}/lean`, { headers: ada.headers });
    expect(leaned).toMatchObject({ uuid: made.uuid, kind: "lean" });
    expect((await (await opened(made)).json()) as Json).toMatchObject({ kind: "lean", annotations: [] });
    // What is left carries the paper alone, which is nobody's: it leaves
    // the user's page, and is not theirs to enrich again or to revoke.
    expect((await ok("GET", `/api/papers/${name(SHARED)}`, { headers: ada.headers })).sharable_uuid).toBeNull();
    expect((await call("POST", `/api/sharables/${made.uuid}/lean`, { headers: ada.headers })).status).toBe(404);
    expect((await call("DELETE", `/api/sharables/${made.uuid}`, { headers: ada.headers })).status).toBe(404);
    expect((await opened(made)).status).toBe(200);
  });
});

describe("taking a shared paper into your nook", () => {
  const nook = (link: Json, user: Account) => call("GET", `/api/shared/${link.uuid}/nook`, { headers: user.headers });
  const add = (link: Json, user: Account) => call("POST", `/api/shared/${link.uuid}/add-to-nook`, { headers: user.headers });

  it("brings the paper across and leaves the annotations with their author", async () => {
    const link = await share(ada);
    expect(await (await nook(link, grace)).json()).toBeNull();
    // Its own maker is told they have it already.
    expect(await (await nook(link, ada)).json()).toEqual({ sha256: SHARED });

    const added = await add(link, grace);
    expect(added.status).toBe(200);
    expect(await added.json()).toEqual({ sha256: SHARED });
    expect(await (await nook(link, grace)).json()).toEqual({ sha256: SHARED });
    expect(await count("copies", "user_uuid = ? AND paper_sha256 = ? AND deleted_at IS NULL", grace.uuid, SHARED)).toBe(1);
    // Nothing of the sharer's was duplicated under this user's name, and
    // the sharer still has every one of theirs.
    expect(await count("annotations", "user_uuid = ? AND paper_sha256 = ? AND deleted_at IS NULL", grace.uuid, SHARED)).toBe(2);
    expect(await count("annotations", "user_uuid = ? AND deleted_at IS NULL", ada.uuid)).toBe(5);

    // The paper cannot be kept twice.
    const again = await add(link, grace);
    expect(again.status).toBe(400);
    expect(((await again.json()) as Json).detail).toContain("already in your nook");
  });

  it("works from a lean link, from a paper nobody displays, and not from a revoked one", async () => {
    const lean = await share(ada, false);
    // Nobody owns a paper, so the ordinary add works on one nobody shows;
    // the link is then told the paper is already kept.
    expect((await call("POST", `/api/papers/${name(SHARED)}/add-to-nook`, { headers: grace.headers })).status).toBe(200);
    const byLink = await add(lean, grace);
    expect(byLink.status).toBe(400);
    expect(((await byLink.json()) as Json).detail).toContain("already in your nook");
    await ok("DELETE", `/api/papers/${name(SHARED)}`, { headers: grace.headers });
    // A lean link hands over the paper just the same.
    expect(await (await add(lean, grace)).json()).toEqual({ sha256: SHARED });

    const rich = await share(ada);
    await ok("DELETE", `/api/sharables/${rich.uuid}`, { headers: ada.headers });
    expect((await add(rich, grace)).status).toBe(404);
    expect((await nook(rich, grace)).status).toBe(404);
  });
});
