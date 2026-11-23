// Reading places: where a user left a paper, kept for them across the
// website and the Mac, the newest by when it was read.
import { describe, expect, it } from "vitest";

import { call, ok, paperWithCopy, register, rows, type Account } from "./helpers";

const PAPER = "c".repeat(64);
const MINUTE = 60_000;

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const place = (page: number, readMsAgo: number, extra: Record<string, unknown> = {}) =>
  ({ page, x: 0.5, y: 0.25, scale: 1.4, read_at: ago(readMsAgo), ...extra });

const put = (account: Account, body: unknown, paper = PAPER) =>
  call("PUT", `/api/reading-places/${paper}`, { headers: account.headers, json: body });
const get = async (account: Account, paper = PAPER) =>
  (await ok("GET", `/api/reading-places/${paper}`, { headers: account.headers })).place;

describe("reading places", () => {
  it("is nothing until a place is sent, then the place", async () => {
    const ada = await register();
    await paperWithCopy(ada, PAPER, "Read closely");
    expect(await get(ada)).toBeNull();
    const sent = place(7, MINUTE);
    expect((await put(ada, sent)).status).toBe(200);
    expect(await get(ada)).toEqual(sent);
  });

  it("keeps the newest by when it was read, not by when it arrived", async () => {
    const ada = await register();
    await paperWithCopy(ada, PAPER, "Read closely");
    await put(ada, place(9, MINUTE));
    // A place from a window that was offline, sent late.
    const late = await (await put(ada, place(2, 10 * MINUTE))).json() as { place: { page: number } };
    expect(late.place.page).toBe(9);
    await put(ada, place(12, 0));
    expect((await get(ada)).page).toBe(12);
  });

  it("is each user's own", async () => {
    const ada = await register(), grace = await register();
    await paperWithCopy(ada, PAPER, "Read closely");
    await put(ada, place(4, MINUTE));
    expect(await get(grace)).toBeNull();
    await put(grace, place(8, 0));
    expect((await get(ada)).page).toBe(4);
  });

  it("takes a time ahead of the clock as now", async () => {
    const ada = await register();
    await paperWithCopy(ada, PAPER, "Read closely");
    await put(ada, place(3, -60 * MINUTE));
    expect(Date.parse((await get(ada)).read_at)).toBeLessThanOrEqual(Date.now());
    // So reading done a moment later elsewhere still counts.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await put(ada, place(5, 0));
    expect((await get(ada)).page).toBe(5);
  });

  it("refuses what cannot be a place, a paper Papol lacks, and a stranger", async () => {
    const ada = await register();
    await paperWithCopy(ada, PAPER, "Read closely");
    for (const wrong of [
      place(0, 0), place(1.5, 0), place(2, 0, { x: 1.2 }), place(2, 0, { y: -0.1 }),
      place(2, 0, { scale: 0 }), place(2, 0, { scale: "big" }), place(2, 0, { read_at: "yesterday" }), "page 4",
    ]) expect((await put(ada, wrong)).status).toBe(400);
    expect((await put(ada, place(2, 0), "d".repeat(64))).status).toBe(404);
    expect((await put(ada, place(2, 0), "not-a-paper")).status).toBe(404);
    expect((await call("GET", `/api/reading-places/${PAPER}`)).status).toBe(401);
    expect(await rows("SELECT page FROM reading_places")).toEqual([]);
  });
});
