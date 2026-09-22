// Papers: uploading one, saving it with reviewed metadata, opening it,
// editing it, taking a copy and letting one go, and the PDF itself.

import limits from "../../../config/app_limits.json";
import { currentUser, type User } from "../auth";
import { inActiveCohort } from "../cohorts";
import { all, batch, newUuid, now, one, type Row } from "../db";
import { json, readJson, refuse, type Router } from "../http";
import { enqueue, wake } from "../jobs/queue";
import { copyOf, defaultShelf, keepPaper, paperDetail, paperOr404, requireCopy, type Copy, type Paper } from "../papers/detail";
import { KIND as EXTRACT, reextractedMetadata, type Identifier } from "../papers/extract";
import { Unavailable } from "../papers/bibliography";
import { ARXIV_ID_FORM, DOI_FORM } from "../papers/identifiers";
import { viewerPaper } from "../papers/sharables";
import * as uploads from "../papers/uploads";
import { UPLOADS } from "../sync/blobs";
import { writePaper, writeSynced } from "../sync/write";
import * as validate from "../validate";

const DIGEST = /^[0-9a-f]{64}$/;

// The identifier the browser read off the PDF's first pages, `{ doi }` or
// `{ arxiv_id }`, held to the forms the Worker's own reading produces.
function givenIdentifier(check: ReturnType<typeof validate.checking>, given: unknown): Identifier | null {
  if (given === null || given === undefined) return null;
  if (typeof given !== "object") { check.fail("identifier must be an object"); return null; }
  const { doi, arxiv_id: arxivId } = given as Record<string, unknown>;
  const identifier: Identifier = {};
  const foundDoi = check.string("identifier.doi", doi, { max: limits.text.paper_doi, pattern: DOI_FORM, optional: true });
  const foundArxiv = check.string("identifier.arxiv_id", arxivId, { max: 40, pattern: ARXIV_ID_FORM, optional: true });
  if (foundDoi) identifier.doi = foundDoi;
  if (foundArxiv) identifier.arxiv_id = foundArxiv;
  return foundDoi || foundArxiv ? identifier : null;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Store an uploaded PDF under its own content hash. Content-addressed:
// the same bytes always land on the same key, so an upload Papol already
// holds costs nothing and no two names ever refer to different files.
async function storePdf(env: Env, bytes: Uint8Array): Promise<{ fileName: string; digest: string }> {
  const digest = await sha256Hex(bytes);
  const fileName = `${digest}.pdf`;
  if (!(await env.FILES.head(`${UPLOADS}${fileName}`))) {
    await env.FILES.put(`${UPLOADS}${fileName}`, bytes, { httpMetadata: { contentType: "application/pdf" } });
  }
  return { fileName, digest };
}

async function ownTags(env: Env, user: User, tagUuids: unknown): Promise<string[]> {
  const wanted = [...new Set(Array.isArray(tagUuids) ? tagUuids.map(String) : [])];
  if (!wanted.length) return [];
  const owned = await all<{ uuid: string }>(env.DB,
    `SELECT uuid FROM tags WHERE user_uuid = ? AND deleted_at IS NULL AND uuid IN (${wanted.map(() => "?").join(",")})`, user.uuid, ...wanted);
  if (owned.length !== wanted.length) refuse(400, "One or more tags do not belong to you");
  return wanted;
}

// Replace a copy's tag links with versioned association rows: the links
// it has go on or come off, and new ones are made.
async function setCopyTags(env: Env, copy: Copy, tagUuids: string[]): Promise<D1PreparedStatement[]> {
  const statements: D1PreparedStatement[] = [];
  const links = await all<Row>(env.DB, "SELECT * FROM copy_tags WHERE copy_uuid = ?", copy.uuid);
  const wanted = new Set(tagUuids);
  const at = now();
  for (const link of links) {
    const keep = wanted.has(link.tag_uuid as string);
    const was = link.deleted_at === null;
    if (keep === was) continue;
    link.deleted_at = keep ? null : at;
    statements.push(...await writeSynced(env.DB, "copy_tags", link, copy.user_uuid, false));
  }
  const held = new Set(links.map((l) => l.tag_uuid as string));
  for (const tagUuid of wanted) {
    if (held.has(tagUuid)) continue;
    const link = { uuid: newUuid(), copy_uuid: copy.uuid, tag_uuid: tagUuid, user_uuid: copy.user_uuid, created_at: at, updated_at: at, revision: 0, deleted_at: null };
    statements.push(...await writeSynced(env.DB, "copy_tags", link, copy.user_uuid, true));
  }
  return statements;
}

async function ownShelf(env: Env, user: User, shelfUuid: unknown): Promise<Row | null> {
  if (shelfUuid === null || shelfUuid === undefined) return defaultShelf(env.DB, user);
  return one<Row>(env.DB, "SELECT * FROM shelves WHERE uuid = ? AND user_uuid = ?", String(shelfUuid), user.uuid);
}

const METADATA_FIELDS = ["title", "authors", "journal", "year", "doi"] as const;
const PERSONAL_FIELDS = ["summary", "thought", "rating_expertise", "rating_reading", "rating_liking", "is_public", "is_author"] as const;

export function paperRoutes(router: Router) {
  // Upload a PDF. It is stored now, under its digest; what it says about
  // itself is a job, and the form polls /api/jobs/{job} for the fields to
  // review. Nothing is saved to the database until the user saves the paper.
  router.on("POST", "/api/papers/extract", async ({ request, env }) => {
    const user = await currentUser(request, env);
    let data: FormData;
    try { data = await request.formData(); } catch { return refuse(422, "The request is not a form"); }
    const file = data.get("file");
    if (!(file instanceof File)) refuse(422, "file is required");
    if (!file.name.toLowerCase().endsWith(".pdf")) refuse(400, "Only PDF files are allowed");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { fileName, digest } = await storePdf(env, bytes);
    const job = enqueue(env.DB, EXTRACT, { file_path: fileName, uploaded_name: file.name }, { userUuid: user.uuid });
    await job.statement.run();
    await wake(env, [job.uuid]);
    return json({ job: job.uuid, file_path: fileName, sha256: digest }, { status: 202 });
  });

  // Where a PDF goes: the browser has hashed it and says so, and is told
  // either that the bucket holds those bytes already or where to PUT them
  // itself (src/papers/uploads.ts). Nothing is stored or queued here; the
  // upload tells /api/papers/uploaded when the bytes are in.
  router.on("POST", "/api/papers/upload-address", async ({ request, env }) => {
    await currentUser(request, env);
    const data = await readJson<Row>(request);
    const check = validate.checking();
    const sha256 = check.string("sha256", data.sha256, { pattern: uploads.DIGEST })!;
    const size = check.integer("size", data.size, { min: 1 })!;
    const name = check.string("name", data.name, { max: limits.text.uploaded_filename })!;
    check.done();
    if (!name.toLowerCase().endsWith(".pdf")) refuse(400, "Only PDF files are allowed");
    if (size > uploads.PAPER_LIMIT) refuse(413, `PDF files may be at most ${limits.files.paper_mb} MB`);
    const filePath = `${sha256}.pdf`;
    if (await env.FILES.head(uploads.paperKey(sha256))) return json({ stored: true, file_path: filePath });
    if (!uploads.configured(env)) refuse(503, "Direct uploads are not configured on this server");
    return json({ stored: false, file_path: filePath, ...(await uploads.uploadAddress(env, sha256, size)) });
  });

  // The PDF is in the bucket, by the browser's own hand: queue the reading
  // of it, as /api/papers/extract does once it has stored the bytes. The
  // browser may have read the paper's identifier off its first pages
  // already; passed along, the job asks the indexes about it directly.
  router.on("POST", "/api/papers/uploaded", async ({ request, env }) => {
    const user = await currentUser(request, env);
    const data = await readJson<Row>(request);
    const check = validate.checking();
    const filePath = check.string("file_path", data.file_path, { pattern: /^[0-9a-f]{64}\.pdf$/ })!;
    const uploadedName = check.string("uploaded_name", data.uploaded_name, { max: limits.text.uploaded_filename, optional: true }) ?? filePath;
    const identifier = givenIdentifier(check, data.identifier);
    check.done();
    if (!uploadedName.toLowerCase().endsWith(".pdf")) refuse(400, "Only PDF files are allowed");
    const digest = filePath.slice(0, 64);
    if (!(await env.FILES.head(uploads.paperKey(digest)))) refuse(404, "PDF file not found");
    const payload: Row = { file_path: filePath, uploaded_name: uploadedName };
    if (identifier) payload.identifier = identifier;
    const job = enqueue(env.DB, EXTRACT, payload, { userUuid: user.uuid });
    await job.statement.run();
    await wake(env, [job.uuid]);
    return json({ job: job.uuid, file_path: filePath, sha256: digest }, { status: 202 });
  });

  // Save a paper with user-edited metadata and an optional first note. A
  // paper is its PDF: an upload of bytes Papol already holds becomes a
  // new copy of that paper, and anything else is a paper of its own.
  router.on("POST", "/api/papers", async ({ request, env }) => {
    const user = await currentUser(request, env);
    const data = await readJson<Row>(request);
    const filePath = String(data.file_path ?? "");
    if (!/^[0-9a-f]{64}\.pdf$/.test(filePath) || !(await env.FILES.head(`${UPLOADS}${filePath}`))) refuse(400, "PDF file not found");
    const metadata = validate.paperMetadata(data);
    const check = validate.checking();
    const thought = check.string("thought", data.thought, { max: limits.text.paper_thought, optional: true });
    const summary = check.string("summary", data.summary, { optional: true });
    const initialComment = check.string("initial_comment", data.initial_comment, { optional: true });
    for (const field of ["rating_expertise", "rating_reading", "rating_liking"]) {
      check.integer(field, data[field], { min: limits.ratings.min, max: limits.ratings.max, optional: true });
    }
    check.done();
    const digest = filePath.slice(0, 64);
    let paper = await one<Paper>(env.DB, "SELECT * FROM papers WHERE sha256 = ? AND deleted_at IS NULL", digest);
    const isNew = !paper;
    const at = now();
    if (paper) {
      if (await copyOf(env.DB, paper.sha256, user)) refuse(400, "This paper is already in your nook");
      // The uploader reviewed the metadata; shared metadata takes the edit.
      Object.assign(paper, metadata);
    } else {
      paper = { sha256: digest, ...metadata, file_path: filePath, uploaded_by: user.uuid, created_at: at, updated_at: at, revision: 1, deleted_at: null,
        references_status: null, references_error: null, references_at: null } as Paper;
    }
    const tagUuids = await ownTags(env, user, data.tag_uuids);
    const shelf = await ownShelf(env, user, data.shelf_uuid);
    if (!shelf) refuse(400, "Shelf does not belong to you");
    const copy: Copy = {
      uuid: newUuid(), paper_sha256: paper.sha256, user_uuid: user.uuid, shelf_uuid: shelf.uuid as string,
      summary: summary ?? null, thought: thought ?? null, is_author: data.is_author ? 1 : 0,
      rating_expertise: data.rating_expertise ?? null, rating_reading: data.rating_reading ?? null, rating_liking: data.rating_liking ?? null,
      created_at: at, updated_at: at, revision: 0, deleted_at: null,
    };
    const statements = [await writePaper(env.DB, paper, isNew), ...await writeSynced(env.DB, "copies", copy, user.uuid, true)];
    statements.push(...await setCopyTags(env, copy, tagUuids));
    if (initialComment?.trim()) {
      const note = { uuid: newUuid(), kind: "note", user_uuid: user.uuid, paper_sha256: paper.sha256, page: null, group_uuid: null,
        content: initialComment.trim(), name: null, body: "{}", created_at: at, updated_at: at, revision: 0, deleted_at: null };
      statements.push(...await writeSynced(env.DB, "annotations", note, user.uuid, true));
    }
    await batch(env.DB, statements);
    return json(await paperDetail(env.DB, paper, user));
  });

  // Any signed-in user may open any paper: the Library holds every one,
  // and whose nook it sits in is nobody's business but theirs.
  router.on("GET", "/api/papers/:name", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    return json(await paperDetail(env.DB, await paperOr404(env.DB, params.name), user));
  });

  // Re-read a paper's PDF metadata for the edit form.
  router.on("POST", "/api/papers/:name/extract-metadata", async ({ request, env, params }) => {
    await currentUser(request, env);
    const paper = await paperOr404(env.DB, params.name);
    const object = DIGEST.test(paper.file_path.slice(0, 64)) || paper.file_path ? await env.FILES.get(`${UPLOADS}${paper.file_path}`) : null;
    if (!object) refuse(404, "PDF for this paper is missing");
    let found;
    try {
      found = await reextractedMetadata(env, new Uint8Array(await object.arrayBuffer()), paper.doi);
    } catch (error) {
      if (error instanceof Unavailable) refuse(503, "Metadata lookup failed");
      throw error;
    }
    if (!found) refuse(404, "Metadata was not found");
    return json(found);
  });

  // Update a paper. Personal fields apply to the viewer's own copy;
  // metadata lives on the one canonical paper, and any signed-in user may
  // edit it, for everyone.
  router.on("PUT", "/api/papers/:name", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const paper = await paperOr404(env.DB, params.name);
    const data = await readJson<Row>(request);
    const personal = Object.fromEntries(PERSONAL_FIELDS.filter((f) => f in data).map((f) => [f, data[f]]));
    const metadata = Object.fromEntries(METADATA_FIELDS.filter((f) => f in data).map((f) => [f, data[f]]));
    const statements: D1PreparedStatement[] = [];
    let copy: Copy | null = null;
    const touchCopy = async () => { copy = copy ?? await requireCopy(env.DB, paper.sha256, user); return copy; };

    if (Object.keys(personal).length) {
      const mine = await touchCopy();
      validate.copyFields(personal);
      const { is_public: wantedVisibility, ...rest } = personal;
      if (wantedVisibility === false && await inActiveCohort(env.DB, user.uuid, paper.sha256)) refuse(400, "Leave the seminar before hiding this paper");
      if (wantedVisibility !== undefined && wantedVisibility !== null) {
        // Visibility lives on the shelf: the copy moves to one that says so.
        const target = await one<Row>(env.DB, "SELECT uuid FROM shelves WHERE user_uuid = ? AND deleted_at IS NULL AND is_public = ? ORDER BY is_default DESC, position LIMIT 1",
          user.uuid, wantedVisibility ? 1 : 0);
        if (!target) refuse(400, `Create a ${wantedVisibility ? "public" : "private"} shelf first`);
        mine.shelf_uuid = target.uuid as string;
      }
      for (const [key, value] of Object.entries(rest)) mine[key] = key === "is_author" ? (value ? 1 : 0) : value;
    }
    if (data.tag_uuids !== undefined && data.tag_uuids !== null) {
      statements.push(...await setCopyTags(env, await touchCopy(), await ownTags(env, user, data.tag_uuids)));
    }
    if (data.shelf_uuid !== undefined && data.shelf_uuid !== null) {
      const mine = await touchCopy();
      const shelf = await one<Row>(env.DB, "SELECT * FROM shelves WHERE uuid = ? AND user_uuid = ?", String(data.shelf_uuid), user.uuid);
      if (!shelf) refuse(400, "Shelf does not belong to you");
      const current = mine.shelf_uuid ? await one<{ is_public: number }>(env.DB, "SELECT is_public FROM shelves WHERE uuid = ?", mine.shelf_uuid) : null;
      if (!shelf.is_public && current?.is_public && await inActiveCohort(env.DB, user.uuid, paper.sha256)) {
        refuse(400, "Leave the seminar before moving this paper to a private shelf");
      }
      mine.shelf_uuid = shelf.uuid as string;
    }
    if (copy) statements.push(...await writeSynced(env.DB, "copies", copy, user.uuid, false));
    if (Object.keys(metadata).length) {
      Object.assign(paper, metadata);
      if (typeof paper.title === "string") paper.title = paper.title.trim();
      // The same shape a replica's push is held to, asked of the paper
      // after the edit rather than of the edit.
      Object.assign(paper, validate.paperMetadata(paper));
      statements.push(await writePaper(env.DB, paper, false));
    }
    await batch(env.DB, statements);
    return json(await paperDetail(env.DB, paper, user));
  });

  // Remove the paper from the viewer's nook: their copy and their notes.
  // The paper and its file stay, and the paper stays in the Library. Ink
  // and clips are left where they are: leaving a nook is not a deletion,
  // and a user who adds the paper again finds their paint still on the page.
  router.on("DELETE", "/api/papers/:name", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const paper = await paperOr404(env.DB, params.name);
    const copy = await requireCopy(env.DB, paper.sha256, user);
    const at = now();
    copy.deleted_at = at;
    const statements = await writeSynced(env.DB, "copies", copy, user.uuid, false);
    for (const note of await all<Row>(env.DB, "SELECT * FROM annotations WHERE paper_sha256 = ? AND user_uuid = ? AND kind = 'note' AND deleted_at IS NULL", paper.sha256, user.uuid)) {
      note.deleted_at = at;
      statements.push(...await writeSynced(env.DB, "annotations", note, user.uuid, false));
    }
    await batch(env.DB, statements);
    return json({ message: "Paper removed from your nook" });
  });

  // Add the paper to the viewer's nook. Any signed-in user may: nobody
  // owns a paper, so no display stands between them and a copy of their own.
  router.on("POST", "/api/papers/:name/add-to-nook", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const paper = await paperOr404(env.DB, params.name);
    await keepPaper(env.DB, user, paper.sha256);
    return json(await paperDetail(env.DB, paper, user));
  });

  // Resolve the paper named by a viewer URL, which names its PDF, for a
  // user who keeps it. A shared reading is opened by /api/shared instead.
  router.on("GET", "/api/viewer/:digest", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const paper = await viewerPaper(env.DB, params.digest, user, null);
    return json(await paperDetail(env.DB, paper, user));
  });

  // A stored file by its key: a paper's PDF under its digest, an avatar
  // under a UUID in its own folder. Both names are minted once and never
  // reused, so what a URL here answers never changes and may be cached
  // for good.
  for (const [method, path, folder] of [["GET", "/uploads/:key", ""], ["HEAD", "/uploads/:key", ""], ["GET", "/uploads/avatars/:key", "avatars/"], ["HEAD", "/uploads/avatars/:key", "avatars/"]]) {
    router.on(method, path, async ({ env, params }) => {
      if (!/^[A-Za-z0-9._-]+$/.test(params.key)) refuse(404, "File not found");
      const object = await env.FILES.get(`${UPLOADS}${folder}${params.key}`);
      if (!object) refuse(404, "File not found");
      const headers: Record<string, string> = {
        "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
        "content-length": String(object.size),
        "cache-control": "public, max-age=31536000, immutable",
        "accept-ranges": "bytes",
      };
      if (object.httpEtag) headers.etag = object.httpEtag;
      return new Response(method === "HEAD" ? null : object.body, { headers });
    });
  }
}
