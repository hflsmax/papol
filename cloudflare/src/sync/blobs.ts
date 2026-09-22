// The desktop's content-addressed files.
//
// A board file the desktop made is named by its digest under the blobs
// prefix of the board files area; a paper's PDF is copied from there to
// the uploads area under its digest. The keys are the ones the bucket
// has always held, so every file already there is found.

import limits from "../../../config/app_limits.json";
import { currentUser } from "../auth";
import { one } from "../db";
import { refuse, type RouteContext } from "../http";

export const UPLOADS = "uploads/";
export const BOARD_FILES = "board_uploads/";

// Where a file in the uploads area — a paper's PDF, a picture — is
// fetched from. With FILES_URL set, the bucket's own address: the edge
// caches it and no Worker is in the path. Without, the Worker's route,
// which serves the object itself. Board files are never addressed this
// way: a bucket domain exposes every key, and theirs are private.
export function uploadUrl(env: Env, path: string): string {
  const base = (env.FILES_URL || "").replace(/\/+$/, "");
  return `${base}/${UPLOADS}${path}`;
}
const BLOBS = `${BOARD_FILES}blobs/`;
const BLOB_LIMIT = limits.files.offline_blob_mb * 1024 * 1024;
const DIGEST = /^[0-9a-f]{64}$/;

// What the board item's file_path says: the key within the board files
// area.
export function blobKey(sha256: string): string {
  return `blobs/${sha256}`;
}

export async function hasBlob(env: Env, sha256: unknown): Promise<boolean> {
  if (typeof sha256 !== "string" || !DIGEST.test(sha256)) return false;
  return (await env.FILES.head(`${BLOBS}${sha256}`)) !== null;
}

// Put the uploaded bytes where papers are read from. The blob has to have
// been sent already: a paper names its file, so a paper Papol cannot
// open is not one it can store.
export async function receivePaperFile(env: Env, digest: string): Promise<string> {
  if (!(await hasBlob(env, digest))) refuse(409, "Paper blob has not been uploaded");
  const key = `${UPLOADS}${digest}.pdf`;
  if (!(await env.FILES.head(key))) {
    const blob = await env.FILES.get(`${BLOBS}${digest}`);
    if (blob) await env.FILES.put(key, blob.body, { httpMetadata: { contentType: "application/pdf" } });
  }
  return `${digest}.pdf`;
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function headBlob({ request, env, params }: RouteContext): Promise<Response> {
  await currentUser(request, env);
  if (!(await hasBlob(env, params.sha256))) refuse(404, "Blob not found");
  return new Response(null, { status: 200 });
}

export async function putBlob({ request, env, params }: RouteContext): Promise<Response> {
  await currentUser(request, env);
  const sha256 = params.sha256;
  if (!DIGEST.test(sha256)) refuse(422, "Blob identifier must be lowercase SHA-256");
  const body = await request.arrayBuffer();
  if (body.byteLength > BLOB_LIMIT) refuse(413, `Offline files may be at most ${limits.files.offline_blob_mb} MB`);
  if ((await sha256Hex(body)) !== sha256) refuse(422, "Blob digest does not match its content");
  // Content-addressed, so a blob already here is this blob: nothing to do.
  if (!(await env.FILES.head(`${BLOBS}${sha256}`))) {
    const mime = (request.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim() || "application/octet-stream";
    await env.FILES.put(`${BLOBS}${sha256}`, body, { httpMetadata: { contentType: mime } });
  }
  return new Response(null, { status: 204 });
}

// A blob the user may read: a file on one of their boards, or the PDF of
// a paper they keep. Named by its bytes, so what this answers never changes.
export async function getBlob({ request, env, params }: RouteContext): Promise<Response> {
  const user = await currentUser(request, env);
  const sha256 = params.sha256;
  let key: string | null = null;
  let mime = "application/octet-stream";
  const item = await one<{ file_path: string | null; mime_type: string | null }>(
    env.DB,
    `SELECT i.file_path, i.mime_type FROM board_items i JOIN boards b ON b.uuid = i.board_uuid
     WHERE i.sha256 = ? AND b.user_uuid = ? AND i.deleted_at IS NULL LIMIT 1`,
    sha256, user.uuid,
  );
  if (item?.file_path) {
    key = `${BOARD_FILES}${item.file_path}`;
    mime = item.mime_type ?? mime;
  } else {
    const paper = await one<{ file_path: string | null }>(
      env.DB,
      `SELECT p.file_path FROM papers p JOIN copies c ON c.paper_sha256 = p.sha256
       WHERE p.sha256 = ? AND c.user_uuid = ? AND c.deleted_at IS NULL LIMIT 1`,
      sha256, user.uuid,
    );
    if (paper?.file_path) {
      key = `${UPLOADS}${paper.file_path}`;
      mime = "application/pdf";
    }
  }
  const object = key ? await env.FILES.get(key) : null;
  if (!object) refuse(404, "Blob not found");
  return new Response(object.body, {
    headers: {
      "content-type": mime,
      "content-length": String(object.size),
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
}
