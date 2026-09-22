// Links: handing one reading of one paper to anyone who holds the URL,
// taking it back, and what a holder may keep of it.

import { currentUser, type User } from "../auth";
import { one } from "../db";
import { json, readJson, refuse, type Router } from "../http";
import { copyOf, keepPaper, paperOr404 } from "../papers/detail";
import { LEAN, liveReadingLink, openSharable, revoke, RICH, shareReading, sharableOut, sharedReading, stripToThePaper, type Sharable } from "../papers/sharables";

async function ownSharable(env: Env, uuid: string, user: User): Promise<Sharable> {
  const sharable = await one<Sharable>(env.DB, "SELECT * FROM sharables WHERE uuid = ? AND user_uuid = ? AND revoked_at IS NULL", uuid, user.uuid);
  return sharable ?? refuse(404, "Sharable not found");
}

async function openOr404(env: Env, uuid: string): Promise<Sharable> {
  return (await openSharable(env.DB, uuid)) ?? refuse(404, "This reading is no longer shared");
}

export function sharableRoutes(router: Router) {
  // Hand out this paper, with or without this user's annotations on it.
  // With them, the answer is their own link, made once and found again on
  // every later ask. Without them, it is the paper's link — the same URL
  // whoever asks. Either ask may be made while the other link is out:
  // they are different links to different things.
  router.on("POST", "/api/papers/:name/sharable", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const paper = await paperOr404(env.DB, params.name);
    if (!(await copyOf(env.DB, paper.sha256, user))) refuse(403, "Add this paper to your nook first");
    const data = request.headers.get("content-length") === "0" || !request.body ? {} : await readJson<{ include_annotations?: unknown }>(request);
    return json(sharableOut(await shareReading(env.DB, user, paper.sha256, data.include_annotations ? RICH : LEAN)));
  });

  // The link this user already has out on this paper, asked for alone:
  // the desktop reads the paper from its replica, where no link can live.
  // Only ever a link carrying their annotations, as everywhere else.
  // Nothing to report is an answer rather than a refusal.
  router.on("GET", "/api/papers/:name/sharable", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const paper = await paperOr404(env.DB, params.name);
    if (!(await copyOf(env.DB, paper.sha256, user))) return json(null);
    const sharable = await liveReadingLink(env.DB, user.uuid, paper.sha256);
    return json(sharable ? sharableOut(sharable) : null);
  });

  // Drop this user's annotations from a link they have already handed
  // out. The link keeps working; what it opens is the paper alone.
  router.on("POST", "/api/sharables/:uuid/lean", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    return json(sharableOut(await stripToThePaper(env.DB, await ownSharable(env, params.uuid, user))));
  });

  // Take a link back. Anyone still holding it is told it is no longer
  // shared, rather than that it never existed. Only a link that is
  // someone's can be taken back, and only by them.
  router.on("DELETE", "/api/sharables/:uuid", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const sharable = await one<Sharable>(env.DB, "SELECT * FROM sharables WHERE uuid = ? AND user_uuid = ?", params.uuid, user.uuid);
    if (!sharable) refuse(404, "Sharable not found");
    await revoke(env.DB, sharable);
    return new Response(null, { status: 204 });
  });

  // The reading a link opens. Deliberately unauthenticated: the whole
  // point of the link is that it works for someone who is not a user here.
  router.on("GET", "/api/shared/:uuid", async ({ env, params }) => {
    return json(await sharedReading(env,await openOr404(env, params.uuid)));
  });

  // Whether whoever is reading this link already keeps the paper, so the
  // viewer can offer their own copy or the chance to make one.
  router.on("GET", "/api/shared/:uuid/nook", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const sharable = await openOr404(env, params.uuid);
    const copy = await copyOf(env.DB, sharable.paper_sha256, user);
    return json(copy ? { sha256: copy.paper_sha256 } : null);
  });

  // Take the shared paper into the user's own nook, clean. The link is
  // the authorization, the same as it is for reading. What lands carries
  // none of the sharer's annotations: the paper comes across, and what
  // was written on it stays with its author.
  router.on("POST", "/api/shared/:uuid/add-to-nook", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const sharable = await openOr404(env, params.uuid);
    const copy = await keepPaper(env.DB, user, sharable.paper_sha256);
    return json({ sha256: copy.paper_sha256 });
  });
}
