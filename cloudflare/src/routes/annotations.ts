// Everything a user leaves on a paper: a note, a stroke of ink, a clipped
// view. Private to them, kept against the paper they were drawn on. The
// laser pointer leaves nothing here on purpose — it is a way of pointing
// while you talk, and a gesture that outlived the sentence would be litter.

import limits from "../../../config/app_limits.json";
import { currentUser, type User } from "../auth";
import { all, batch, newUuid, now, one, type Row } from "../db";
import { json, readJson, refuse, type Router } from "../http";
import { annotationOut, paperOr404, requireCopy } from "../papers/detail";
import { writeSynced } from "../sync/write";
import * as validate from "../validate";

async function ownAnnotation(env: Env, uuid: string, user: User): Promise<Row> {
  const row = await one<Row>(env.DB, "SELECT * FROM annotations WHERE uuid = ? AND user_uuid = ? AND deleted_at IS NULL", uuid, user.uuid);
  return row ?? refuse(404, "Annotation not found");
}

function bodyOf(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value === "string") {
    try { return JSON.parse(value || "{}"); } catch { return refuse(422, "body is not JSON"); }
  }
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return refuse(422, "body must be an object");
}

export function annotationRoutes(router: Router) {
  // Your annotations on this paper, oldest first — the order they have to
  // be drawn in for later ink to sit over earlier ink. A note written
  // about the paper and never placed on a page comes back with the rest.
  router.on("GET", "/api/papers/:name/annotations", async ({ request, env, params, url }) => {
    const user = await currentUser(request, env);
    const paper = await paperOr404(env.DB, params.name);
    await requireCopy(env.DB, paper.sha256, user);
    const kind = url.searchParams.get("kind");
    if (kind !== null && !(validate.ANNOTATION_KINDS as readonly string[]).includes(kind)) refuse(422, "Unknown annotation kind");
    const rows = await all<Row>(env.DB,
      `SELECT * FROM annotations WHERE user_uuid = ? AND paper_sha256 = ? AND deleted_at IS NULL ${kind ? "AND kind = ?" : ""} ORDER BY created_at, uuid`,
      user.uuid, paper.sha256, ...(kind ? [kind] : []));
    return json(rows.map(annotationOut));
  });

  router.on("POST", "/api/papers/:name/annotations", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const paper = await paperOr404(env.DB, params.name);
    await requireCopy(env.DB, paper.sha256, user);
    const data = await readJson<Row>(request);
    const body = bodyOf(data.body);
    const row = { kind: data.kind, page: data.page ?? null, group_uuid: data.group_uuid ?? null, content: data.content ?? "", name: data.name ?? null, body };
    validate.annotation(row);
    const at = now();
    const annotation = {
      uuid: newUuid(), kind: String(data.kind), user_uuid: user.uuid, paper_sha256: paper.sha256, page: row.page, group_uuid: row.group_uuid,
      content: String(row.content), name: row.name, body: JSON.stringify(validate.normalizedBody(String(data.kind), body)),
      created_at: at, updated_at: at, revision: 0, deleted_at: null,
    };
    await batch(env.DB, await writeSynced(env.DB, "annotations", annotation, user.uuid, true));
    return json(annotationOut(annotation));
  });

  // Change an annotation (its author only). Only what is sent changes, so
  // rewording a note never disturbs where it sits, and moving it never
  // disturbs the words. `body` is merged into the stored geometry — carrying
  // a stroke somewhere else says where its points are now, not what colour
  // it was drawn in — and the result is held to its kind's shape.
  router.on("PUT", "/api/annotations/:uuid", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const annotation = await ownAnnotation(env, params.uuid, user);
    const data = await readJson<Row>(request);
    const check = validate.checking();
    if (data.content !== undefined && data.content !== null) annotation.content = check.string("content", data.content, { max: limits.text.comment });
    if (data.name !== undefined && data.name !== null) annotation.name = check.string("name", data.name, { max: limits.text.annotation_name });
    if (data.page !== undefined && data.page !== null) annotation.page = check.integer("page", data.page, { min: 1 });
    check.done();
    if (data.body !== undefined && data.body !== null) {
      const merged = { ...bodyOf(annotation.body), ...bodyOf(data.body) };
      validate.annotation({ ...annotation, body: merged });
      annotation.body = JSON.stringify(validate.normalizedBody(String(annotation.kind), merged));
    }
    await batch(env.DB, await writeSynced(env.DB, "annotations", annotation, user.uuid, false));
    return json(annotationOut(annotation));
  });

  router.on("DELETE", "/api/annotations/:uuid", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const annotation = await ownAnnotation(env, params.uuid, user);
    annotation.deleted_at = now();
    await batch(env.DB, await writeSynced(env.DB, "annotations", annotation, user.uuid, false));
    return json({ message: "Annotation deleted" });
  });
}
