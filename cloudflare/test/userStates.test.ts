// User state: small things a user's devices keep for them, places and
// flags, the change made last winning whichever device sent it.
import { describe, expect, it } from "vitest";

import { call, ok, paperWithCopy, register, rows, type Account } from "./helpers";

const PAPER = "c".repeat(64);
const MINUTE = 60_000;

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const place = (page: number, madeMsAgo: number, extra: Record<string, unknown> = {}) =>
  ({ kind: "place", key: PAPER, value: { page, x: 0.5, y: 0.25, scale: 1.4 }, at: ago(madeMsAgo), ...extra });
const flag = (key: string, value: string | null, madeMsAgo: number) => ({ kind: "flag", key, value, at: ago(madeMsAgo) });

const send = (account: Account, changes: unknown) =>
  ok("POST", "/api/user-state", { headers: account.headers, json: { changes } });
const placeOf = async (account: Account, paper = PAPER) =>
  (await ok("GET", `/api/user-state/place/${paper}`, { headers: account.headers })).state;
const flagsOf = async (account: Account) =>
  (await ok("GET", "/api/user-state/flag", { headers: account.headers })).states;

describe("user state", () => {
  it("keeps a place and a flag, and gives each back", async () => {
    const ada = await register();
    await paperWithCopy(ada, PAPER, "Read closely");
    expect(await placeOf(ada)).toBeNull();
    expect(await flagsOf(ada)).toEqual([]);
    const sent = [place(7, MINUTE), flag("papol_learn_visibility", "seen", MINUTE)];
    expect(await send(ada, sent)).toEqual({ recorded: 2, skipped: 0 });
    expect(await placeOf(ada)).toEqual({ key: PAPER, value: sent[0].value, at: sent[0].at });
    expect(await flagsOf(ada)).toEqual([{ key: "papol_learn_visibility", value: "seen", at: sent[1].at }]);
  });

  it("keeps the change made last, not the one that arrived last", async () => {
    const ada = await register();
    await paperWithCopy(ada, PAPER, "Read closely");
    await send(ada, [place(9, MINUTE), flag("papol_link_return_pill", null, MINUTE)]);
    // From a device that was offline, sent late.
    await send(ada, [place(2, 10 * MINUTE), flag("papol_link_return_pill", "hidden", 10 * MINUTE)]);
    expect((await placeOf(ada)).value.page).toBe(9);
    expect((await flagsOf(ada))[0].value).toBeNull();
    await send(ada, [place(12, 0), flag("papol_link_return_pill", "hidden", 0)]);
    expect((await placeOf(ada)).value.page).toBe(12);
    expect((await flagsOf(ada))[0].value).toBe("hidden");
  });

  it("takes a time ahead of the clock as now", async () => {
    const ada = await register();
    await paperWithCopy(ada, PAPER, "Read closely");
    await send(ada, [place(3, -60 * MINUTE)]);
    expect(Date.parse((await placeOf(ada)).at)).toBeLessThanOrEqual(Date.now());
    await new Promise((resolve) => setTimeout(resolve, 5));
    await send(ada, [place(5, 0)]);
    expect((await placeOf(ada)).value.page).toBe(5);
  });

  it("is each user's own", async () => {
    const ada = await register(), grace = await register();
    await paperWithCopy(ada, PAPER, "Read closely");
    await send(ada, [place(4, MINUTE), flag("papol_learn_visibility", "seen", MINUTE)]);
    expect(await placeOf(grace)).toBeNull();
    expect(await flagsOf(grace)).toEqual([]);
  });

  it("lets go of what cannot be true, and refuses a stranger", async () => {
    const ada = await register();
    await paperWithCopy(ada, PAPER, "Read closely");
    const answer = await send(ada, [
      place(0, 0), place(1.5, 0), place(2, 0, { value: { page: 2, x: 1.2, y: 0.5, scale: 1 } }),
      place(2, 0, { value: { page: 2, x: 0.5, y: 0.5, scale: 0 } }), place(2, 0, { at: "yesterday" }),
      place(2, 90 * 24 * 60 * MINUTE), place(2, 0, { key: "d".repeat(64) }), place(2, 0, { key: "not-a-paper" }),
      flag("papol_learn_visibility", "x".repeat(40), 0), flag("has space", "seen", 0), flag("papol_x", "", 0),
      { kind: "weather", key: "today", value: "sun", at: ago(0) }, "nonsense",
    ]);
    expect(answer).toEqual({ recorded: 0, skipped: 13 });
    expect(await rows("SELECT * FROM user_states")).toEqual([]);
    expect((await call("POST", "/api/user-state", { headers: ada.headers, json: { changes: "all" } })).status).toBe(400);
    expect((await call("POST", "/api/user-state", { json: { changes: [] } })).status).toBe(401);
    expect((await call("GET", "/api/user-state/flag")).status).toBe(401);
  });
});
