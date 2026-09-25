// Activity: spans of time with a paper or a board, sent as they grow,
// read back by their user alone, and summed on their own nook.
import { describe, expect, it } from "vitest";

import { call, count, defaultShelf, exec, ok, paperWithCopy, register, rows, uuid, type Account } from "./helpers";

const PAPER = "a".repeat(64);
const MINUTE = 60_000;

function span(kind: string, subject: string, startedMsAgo: number, lastingMs: number, seconds = Math.round(lastingMs / 1000), id = uuid()) {
  const started = Date.now() - startedMsAgo;
  return { uuid: id, kind, subject, started_at: new Date(started).toISOString(), ended_at: new Date(started + lastingMs).toISOString(), seconds };
}

function send(account: Account, spans: unknown[]) {
  return ok("POST", "/api/activity", { headers: account.headers, json: { spans } });
}

function range(account: Account, fromMsAgo: number, toMsAgo = 0) {
  const from = new Date(Date.now() - fromMsAgo).toISOString(), to = new Date(Date.now() - toMsAgo).toISOString();
  return ok("GET", `/api/activity?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { headers: account.headers });
}

describe("recording activity", () => {
  it("keeps a span, and lets it grow when sent again but never shrink", async () => {
    const ada = await register();
    await paperWithCopy(ada, PAPER, "Read closely", { shelfUuid: await defaultShelf(ada) });
    const first = span("reading", PAPER, 20 * MINUTE, 5 * MINUTE);
    expect(await send(ada, [first])).toEqual({ recorded: 1, skipped: 0 });
    const grown = { ...first, ended_at: new Date(Date.parse(first.started_at) + 9 * MINUTE).toISOString(), seconds: 540 };
    await send(ada, [grown]);
    // An older copy of the span, arriving late from another window.
    await send(ada, [first]);
    expect(await rows("SELECT kind, subject, seconds, ended_at FROM activity")).toEqual([{ kind: "reading", subject: PAPER, seconds: 540, ended_at: grown.ended_at }]);
  });

  it("lets go of what cannot be true, a paper Papol lacks, and a board that is someone else's", async () => {
    const ada = await register(), grace = await register();
    await paperWithCopy(ada, PAPER, "Held");
    const own = await ok("POST", "/api/boards", { headers: ada.headers, json: { name: "Mine" } });
    const theirs = await ok("POST", "/api/boards", { headers: grace.headers, json: { name: "Grace's" } });
    const answer = await send(ada, [
      span("reading", PAPER, 10 * MINUTE, MINUTE),
      span("board", own.uuid, 10 * MINUTE, MINUTE),
      span("board", theirs.uuid, 10 * MINUTE, MINUTE),
      span("reading", "b".repeat(64), 10 * MINUTE, MINUTE),
      span("reading", PAPER, 10 * MINUTE, MINUTE, 600),
      span("reading", PAPER, -10 * MINUTE, MINUTE),
      span("reading", PAPER, 10 * MINUTE, 3 * 60 * MINUTE),
      span("reading", PAPER, 90 * 24 * 60 * MINUTE, MINUTE),
      span("walking", PAPER, 10 * MINUTE, MINUTE),
      { ...span("reading", PAPER, 10 * MINUTE, MINUTE), uuid: "not-a-uuid" },
      "nonsense",
    ]);
    expect(answer).toEqual({ recorded: 2, skipped: 9 });
    expect((await call("POST", "/api/activity", { headers: ada.headers, json: { spans: "all of them" } })).status).toBe(400);
    expect((await call("POST", "/api/activity", { json: { spans: [] } })).status).toBe(401);
  });

  it("does not let one user's span be taken over by another sending its uuid", async () => {
    const ada = await register(), grace = await register();
    await paperWithCopy(ada, PAPER, "Held");
    const mine = span("reading", PAPER, 20 * MINUTE, 5 * MINUTE);
    await send(ada, [mine]);
    await send(grace, [{ ...mine, seconds: 300, ended_at: new Date(Date.parse(mine.started_at) + 10 * MINUTE).toISOString() }]);
    expect(await rows("SELECT user_uuid, seconds FROM activity")).toEqual([{ user_uuid: ada.uuid, seconds: 300 }]);
    expect((await range(grace, 60 * MINUTE)).spans).toEqual([]);
  });
});

describe("reading activity back", () => {
  it("answers the spans that touch the range, with what each paper and board is called", async () => {
    const ada = await register();
    await paperWithCopy(ada, PAPER, "Read closely", { shelfUuid: await defaultShelf(ada) });
    const board = await ok("POST", "/api/boards", { headers: ada.headers, json: { name: "Ideas" } });
    await send(ada, [
      span("reading", PAPER, 5 * 60 * MINUTE, 10 * MINUTE),
      span("reading", PAPER, 65 * MINUTE, 10 * MINUTE),
      span("board", board.uuid, 30 * MINUTE, 20 * MINUTE),
    ]);
    // The last hour, which the second span runs into.
    const hour = await range(ada, 60 * MINUTE);
    expect(hour.spans.map((s: any) => [s.kind, s.seconds])).toEqual([["reading", 600], ["board", 1200]]);
    expect(hour.papers).toEqual({ [PAPER]: { title: "Read closely", in_nook: true } });
    expect(hour.boards).toEqual({ [board.uuid]: { name: "Ideas", deleted: false } });
    expect(Date.parse(hour.first_at)).toBeLessThan(Date.now() - 4 * 60 * MINUTE);
    expect((await call("GET", "/api/activity?from=2026-01-01T00:00:00Z&to=2026-06-01T00:00:00Z", { headers: ada.headers })).status).toBe(400);
    expect((await call("GET", "/api/activity?from=later&to=sooner", { headers: ada.headers })).status).toBe(400);
  });
});

describe("effort on the nook", () => {
  it("is shown on each paper to its user, and to nobody else", async () => {
    const ada = await register(), grace = await register();
    await paperWithCopy(ada, PAPER, "Read closely", { shelfUuid: await defaultShelf(ada) });
    const board = await ok("POST", "/api/boards", { headers: ada.headers, json: { name: "Ideas" } });
    const later = span("reading", PAPER, 30 * MINUTE, 10 * MINUTE);
    await send(ada, [span("reading", PAPER, 3 * 60 * MINUTE, 20 * MINUTE), later, span("board", board.uuid, 60 * MINUTE, 5 * MINUTE)]);
    // Grace reading the same paper adds nothing to Ada's.
    await send(grace, [span("reading", PAPER, 30 * MINUTE, 10 * MINUTE)]);

    const own = await ok("GET", `/api/users/${ada.uuid}/nook`, { headers: ada.headers });
    expect(own.papers[0].effort).toEqual({ seconds: 1800, last_at: later.ended_at });
    const theirs = await ok("GET", `/api/users/${ada.uuid}/nook`, { headers: grace.headers });
    expect(theirs.papers[0].effort).toBeNull();
  });
});

describe("one paper's effort", () => {
  it("sums every span ever, and answers the recent ones, for its own user only", async () => {
    const ada = await register(), grace = await register();
    await paperWithCopy(ada, PAPER, "Read closely");
    const old = span("reading", PAPER, 50 * 24 * 60 * MINUTE, 20 * MINUTE);
    const recent = span("reading", PAPER, 30 * MINUTE, 10 * MINUTE);
    await send(ada, [old, recent]);
    await send(grace, [span("reading", PAPER, 30 * MINUTE, 5 * MINUTE)]);
    const mine = await ok("GET", `/api/activity/reading/${PAPER}`, { headers: ada.headers });
    expect(mine).toMatchObject({ kind: "reading", subject: PAPER, seconds: 1800, first_at: old.started_at, last_at: recent.ended_at });
    expect(mine.spans.map((s: any) => s.seconds)).toEqual([1200, 600]);
    const none = await ok("GET", `/api/activity/reading/${"c".repeat(64)}`, { headers: ada.headers });
    expect(none).toMatchObject({ seconds: 0, first_at: null, spans: [] });
    expect((await call("GET", `/api/activity/walking/${PAPER}`, { headers: ada.headers })).status).toBe(404);
    expect((await call("GET", "/api/activity/board/not-a-uuid", { headers: ada.headers })).status).toBe(404);
  });
});

describe("activity and the account", () => {
  it("is in the export, and goes when the account closes", async () => {
    const ada = await register("leaver@example.com", "Ada"), grace = await register();
    await exec("UPDATE users SET is_admin = 1 WHERE uuid = ?", grace.uuid);
    await paperWithCopy(ada, PAPER, "Read closely", { shelfUuid: await defaultShelf(ada) });
    await send(ada, [span("reading", PAPER, 30 * MINUTE, 10 * MINUTE)]);
    await send(grace, [span("reading", PAPER, 30 * MINUTE, 10 * MINUTE)]);

    const tar = new Uint8Array(await (await call("GET", "/api/auth/export", { headers: ada.headers })).arrayBuffer());
    const text = new TextDecoder().decode(tar);
    expect(text).toContain("activity.json");
    expect(text).toContain(`"title": "Read closely"`);

    const closed = await ok("DELETE", "/api/auth/account", { headers: ada.headers, json: { confirm_email: "leaver@example.com" } });
    expect(closed.removed).toMatchObject({ activity: 1 });
    expect(await count("activity")).toBe(1);
  });
});
