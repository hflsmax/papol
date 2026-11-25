// Terms a user defined in a paper they keep: words they selected, each
// pointed at a definition printed in the same paper. The viewer shows the
// definition wherever the words are read (viewer/src/definedTerms.js).
// Theirs alone: nobody else sees them.
//
// The definition is a place, its page and its box as screen-space
// fractions, and the name the paper gives it. One term a paper: defining
// it again points it somewhere else.

import limits from "../../../config/app_limits.json";
import { currentUser } from "../auth";
import { all, batch, newUuid, now, one, statement, type Row } from "../db";
import { json, readJson, refuse, type Router } from "../http";
import { paperOr404, requireCopy } from "../papers/detail";
import * as validate from "../validate";

const { term_length_max: TERM_MAX, label_length_max: LABEL_MAX, per_paper_max: PER_PAPER_MAX } = limits.defined_terms;

// A term as it is matched in the text: case and spacing aside.
export const termKey = (term: string) => term.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

const termOut = (row: Row) => ({
  uuid: row.uuid, term: row.term, label: row.label, page: row.page,
  box: { x: row.x, y: row.y, w: row.w, h: row.h }, created_at: row.created_at,
});

export function termRoutes(router: Router) {
  // The terms you defined in this paper, oldest first.
  router.on("GET", "/api/papers/:name/terms", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const paper = await paperOr404(env.DB, params.name);
    const rows = await all<Row>(env.DB,
      "SELECT * FROM defined_terms WHERE user_uuid = ? AND paper_sha256 = ? ORDER BY created_at, uuid", user.uuid, paper.sha256);
    return json({ terms: rows.map(termOut) });
  });

  // Define a term, or point one already defined at another definition.
  router.on("POST", "/api/papers/:name/terms", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const paper = await paperOr404(env.DB, params.name);
    await requireCopy(env.DB, paper.sha256, user);
    const data = await readJson<Row>(request);
    const check = validate.checking();
    const term = String(check.string("term", data.term, { max: TERM_MAX }) ?? "").replace(/\s+/g, " ").trim();
    const label = String(check.string("label", data.label, { max: LABEL_MAX }) ?? "").replace(/\s+/g, " ").trim();
    const page = check.integer("page", data.page, { min: 1 });
    const box = (data.box && typeof data.box === "object" ? data.box : {}) as Row;
    const x = check.number("box.x", box.x, { min: 0, max: 1 }), y = check.number("box.y", box.y, { min: 0, max: 1 });
    const w = check.number("box.w", box.w, { min: 0, max: 1, exclusiveMin: true }), h = check.number("box.h", box.h, { min: 0, max: 1, exclusiveMin: true });
    const key = termKey(term);
    if (!/[\p{L}\p{N}]/u.test(key)) check.fail("a term needs a letter or a digit");
    if (!label) check.fail("label is required");
    check.done();
    const held = await one<Row>(env.DB,
      "SELECT uuid FROM defined_terms WHERE user_uuid = ? AND paper_sha256 = ? AND term_key = ?", user.uuid, paper.sha256, key);
    if (!held) {
      const count = await one<{ n: number }>(env.DB,
        "SELECT count(*) AS n FROM defined_terms WHERE user_uuid = ? AND paper_sha256 = ?", user.uuid, paper.sha256);
      if ((count?.n ?? 0) >= PER_PAPER_MAX) refuse(400, `At most ${PER_PAPER_MAX} defined terms a paper`);
    }
    await batch(env.DB, [statement(env.DB,
      `INSERT INTO defined_terms (uuid, user_uuid, paper_sha256, term, term_key, label, page, x, y, w, h, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_uuid, paper_sha256, term_key) DO UPDATE SET
         term = excluded.term, label = excluded.label, page = excluded.page, x = excluded.x, y = excluded.y, w = excluded.w, h = excluded.h`,
      newUuid(), user.uuid, paper.sha256, term, key, label, page, x, y, w, h, now())]);
    const row = await one<Row>(env.DB,
      "SELECT * FROM defined_terms WHERE user_uuid = ? AND paper_sha256 = ? AND term_key = ?", user.uuid, paper.sha256, key);
    return json(termOut(row!));
  });

  router.on("DELETE", "/api/terms/:uuid", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const row = await one<Row>(env.DB, "SELECT uuid FROM defined_terms WHERE uuid = ? AND user_uuid = ?", params.uuid, user.uuid);
    if (!row) refuse(404, "Defined term not found");
    await batch(env.DB, [statement(env.DB, "DELETE FROM defined_terms WHERE uuid = ?", params.uuid)]);
    return json({ message: "Defined term removed" });
  });
}
