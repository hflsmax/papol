// Defined terms: words a user pointed at a definition in a paper they
// keep. Theirs alone, one a term, removed one at a time.
import { describe, expect, it } from "vitest";

import { call, ok, paperWithCopy, register, rows, type Account } from "./helpers";

const DIGEST = "e".repeat(64);
// A paper answers to its name, half its digest.
const PAPER = DIGEST.slice(0, 32);
const box = { x: 0.1, y: 0.3, w: 0.8, h: 0.12 };
const termsOf = async (account: Account) => (await ok("GET", `/api/papers/${PAPER}/terms`, { headers: account.headers })).terms;
const define = (account: Account, json: unknown) => call("POST", `/api/papers/${PAPER}/terms`, { headers: account.headers, json });

describe("defined terms", () => {
  it("keeps a term with the definition it points at, and gives it back", async () => {
    const ada = await register();
    await paperWithCopy(ada, DIGEST, "Typed terms");
    expect(await termsOf(ada)).toEqual([]);
    const made = await ok("POST", `/api/papers/${PAPER}/terms`, {
      headers: ada.headers, json: { term: "  well-typed\n term ", label: "Definition 2.1", page: 3, box },
    });
    expect(made).toMatchObject({ term: "well-typed term", label: "Definition 2.1", page: 3, box });
    expect(await termsOf(ada)).toEqual([made]);
  });

  it("defining a term again points it at the other definition", async () => {
    const ada = await register();
    await paperWithCopy(ada, DIGEST, "Typed terms");
    const first = await (await define(ada, { term: "Redex", label: "Definition 1", page: 2, box })).json() as { uuid: string };
    const again = await (await define(ada, { term: "redex", label: "Definition 4", page: 5, box })).json() as { uuid: string };
    expect(again.uuid).toBe(first.uuid);
    expect(await termsOf(ada)).toMatchObject([{ term: "redex", label: "Definition 4", page: 5 }]);
  });

  it("is each user's own, and removed by them alone", async () => {
    const ada = await register(), grace = await register();
    await paperWithCopy(ada, DIGEST, "Typed terms");
    const made = await (await define(ada, { term: "redex", label: "Definition 1", page: 2, box })).json() as { uuid: string };
    expect(await termsOf(grace)).toEqual([]);
    // Someone who does not keep the paper defines nothing in it.
    expect((await define(grace, { term: "redex", label: "Definition 1", page: 2, box })).status).toBe(403);
    expect((await call("DELETE", `/api/terms/${made.uuid}`, { headers: grace.headers })).status).toBe(404);
    await ok("DELETE", `/api/terms/${made.uuid}`, { headers: ada.headers });
    expect(await termsOf(ada)).toEqual([]);
    expect(await rows("SELECT * FROM defined_terms")).toEqual([]);
  });

  it("refuses what is no term or no place, and a stranger", async () => {
    const ada = await register();
    await paperWithCopy(ada, DIGEST, "Typed terms");
    for (const bad of [
      { term: "", label: "Definition 1", page: 2, box },
      { term: "—", label: "Definition 1", page: 2, box },
      { term: "x".repeat(121), label: "Definition 1", page: 2, box },
      { term: "redex", label: "", page: 2, box },
      { term: "redex", label: "Definition 1", page: 0, box },
      { term: "redex", label: "Definition 1", page: 2, box: { ...box, w: 0 } },
      { term: "redex", label: "Definition 1", page: 2, box: { ...box, x: 1.2 } },
      { term: "redex", label: "Definition 1", page: 2 },
    ]) expect((await define(ada, bad)).status, JSON.stringify(bad)).toBe(422);
    expect(await rows("SELECT * FROM defined_terms")).toEqual([]);
    expect((await call("GET", `/api/papers/${PAPER}/terms`)).status).toBe(401);
    expect((await call("POST", `/api/papers/${PAPER}/terms`, { json: { term: "redex", label: "Definition 1", page: 2, box } })).status).toBe(401);
  });
});
