// Digs outside any project: what someone writes at a place on a page, or
// about a paper, when no project is on. Theirs alone.
import { describe, expect, it } from "vitest";

import { call, defaultShelf, ok, paperWithCopy, register } from "./helpers";

const PAPER = "e".repeat(64);
const name = PAPER.slice(0, 32);

describe("a dig of one's own", () => {
  it("is written at an anchor or on a paper, pinned for its owner, and seen by nobody else", async () => {
    const ada = await register(), grace = await register();
    await paperWithCopy(ada, PAPER, "Alone", { shelfUuid: await defaultShelf(ada) });
    // Grace keeps the same paper: a copy of her own.
    await ok("POST", `/api/papers/${name}/add-to-nook`, { headers: grace.headers, json: {} });
    const anchor = await ok("POST", `/api/papers/${name}/annotations`, { headers: ada.headers, json: { kind: "anchor", page: 3, body: { anchor: { x: 0.4, y: 0.25 } } } });
    const graces = await ok("POST", `/api/papers/${name}/annotations`, { headers: grace.headers, json: { kind: "anchor", page: 1, body: { anchor: { x: 0.4, y: 0.25 } } } });

    expect(await ok("GET", `/api/papers/${name}/digs`, { headers: ada.headers })).toEqual({ digs: {}, paper_digs: null });
    const empty = await ok("GET", `/api/digs?subject=annotation:${anchor.uuid}`, { headers: ada.headers });
    expect(empty).toMatchObject({ mine: null, digs: [], project: null, subject: { kind: "annotation", annotation_kind: "anchor", page: 3, down: 0.75, label: "An anchor on page 3" } });

    const dig = await ok("POST", "/api/digs", { headers: ada.headers, json: { subject: `annotation:${anchor.uuid}`, text: "Lemma 2 again" } });
    expect(dig).toMatchObject({ project: null, is_mine: true, text: "Lemma 2 again", posts: [], can_moderate: false, subject: { annotation_uuid: anchor.uuid } });
    expect((await call("POST", "/api/digs", { headers: ada.headers, json: { subject: `annotation:${anchor.uuid}`, text: "twice" } })).status).toBe(409);
    const onPaper = await ok("POST", "/api/digs", { headers: ada.headers, json: { subject: `paper:${PAPER}`, text: "Worth rereading" } });

    const pins = await ok("GET", `/api/papers/${name}/digs`, { headers: ada.headers });
    expect(pins.digs[anchor.uuid]).toMatchObject({ uuid: dig.uuid, mine: dig.uuid, dig_count: 1, post_count: 0, is_new: false, lead: { excerpt: "Lemma 2 again" } });
    expect(pins.paper_digs).toMatchObject({ uuid: onPaper.uuid, lead: { excerpt: "Worth rereading" } });
    expect((await ok("GET", `/api/digs?subject=paper:${PAPER}`, { headers: ada.headers })).mine).toBe(onPaper.uuid);

    // Its owner rewords and removes it; it has no posts and no phase.
    expect((await ok("PUT", `/api/digs/${dig.uuid}`, { headers: ada.headers, json: { text: "Lemma 2, twice" } })).text).toBe("Lemma 2, twice");
    expect((await call("POST", `/api/digs/${dig.uuid}/posts`, { headers: ada.headers, json: { body: "hi" } })).status).toBe(403);
    expect((await call("PUT", `/api/digs/${dig.uuid}/phase`, { headers: ada.headers, json: { phase: "gold" } })).status).toBe(403);

    // Nobody else reads, changes or removes it, or digs Ada's anchor as their own.
    expect(await ok("GET", `/api/papers/${name}/digs`, { headers: grace.headers })).toEqual({ digs: {}, paper_digs: null });
    for (const [method, json] of [["GET", undefined], ["PUT", { text: "mine now" }], ["DELETE", undefined]] as const) {
      expect((await call(method, `/api/digs/${dig.uuid}`, { headers: grace.headers, json })).status).toBe(404);
    }
    expect((await call("POST", "/api/digs", { headers: grace.headers, json: { subject: `annotation:${anchor.uuid}`, text: "?" } })).status).toBe(404);
    expect((await call("POST", "/api/digs", { headers: ada.headers, json: { subject: `annotation:${graces.uuid}`, text: "?" } })).status).toBe(404);
    // Only a paper in one's nook.
    expect((await call("POST", "/api/digs", { headers: ada.headers, json: { subject: `paper:${"f".repeat(64)}`, text: "?" } })).status).toBe(404);
    expect((await call("POST", "/api/digs", { headers: ada.headers, json: { subject: "card:x", text: "?" } })).status).toBe(422);

    expect((await call("DELETE", `/api/digs/${dig.uuid}`, { headers: ada.headers })).status).toBe(204);
    expect((await ok("GET", `/api/papers/${name}/digs`, { headers: ada.headers })).digs).toEqual({});
  });

  it("comes back with its anchor when a removed anchor is restored", async () => {
    const ada = await register(), grace = await register();
    await paperWithCopy(ada, PAPER, "Alone", { shelfUuid: await defaultShelf(ada) });
    const anchor = await ok("POST", `/api/papers/${name}/annotations`, { headers: ada.headers, json: { kind: "anchor", page: 2, body: { anchor: { x: 0.5, y: 0.5 } } } });
    const dig = await ok("POST", "/api/digs", { headers: ada.headers, json: { subject: `annotation:${anchor.uuid}`, text: "Here" } });
    // Nothing to restore while it stands.
    expect((await call("POST", `/api/annotations/${anchor.uuid}/restore`, { headers: ada.headers })).status).toBe(404);
    await ok("DELETE", `/api/annotations/${anchor.uuid}`, { headers: ada.headers });
    expect((await ok("GET", `/api/papers/${name}/annotations`, { headers: ada.headers }))).toEqual([]);
    // Only its owner brings it back.
    expect((await call("POST", `/api/annotations/${anchor.uuid}/restore`, { headers: grace.headers })).status).toBe(404);
    expect(await ok("POST", `/api/annotations/${anchor.uuid}/restore`, { headers: ada.headers })).toMatchObject({ uuid: anchor.uuid, kind: "anchor", page: 2 });
    expect((await ok("GET", `/api/papers/${name}/annotations`, { headers: ada.headers })).map((a: { uuid: string }) => a.uuid)).toEqual([anchor.uuid]);
    expect((await ok("GET", `/api/papers/${name}/digs`, { headers: ada.headers })).digs[anchor.uuid]).toMatchObject({ uuid: dig.uuid, digs: [{ uuid: dig.uuid, is_new: false }] });
  });
});
