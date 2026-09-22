// One file model: every file is named by its content, written to the
// bucket by the client that has the bytes, read from the bucket's own
// address, and the Worker only ever records that it is there.
//
// Two kinds, two keys. A paper's PDF is `uploads/<sha256>.pdf`; a board
// file — a picture or a document on a card, made in a browser or in the
// desktop app — is `board_uploads/blobs/<sha256>`. A row records the key
// within its area (`<sha256>.pdf` on the paper, `blobs/<sha256>` on the
// card), which is what every file_path in the database has always held.
//
// Writing: the client hashes, asks `POST /api/files/upload-address` for
// where the bytes go, PUTs them there with the headers the answer lists,
// and then tells the route that records the row. The address is a
// presigned S3 PUT to R2 (aws4fetch; an R2 API token in the secrets),
// valid fifteen minutes, whose signature covers `x-amz-checksum-sha256`
// (so the bucket refuses bytes that do not hash to their name),
// `content-type` and `content-length`. Without the token — a local
// `wrangler dev`, whose R2 is a simulation — the address is the Worker's
// own door, `PUT /api/files/:kind/:sha256`, which holds the bytes to the
// same contract; the client cannot tell the two apart.
//
// Reading: with FILES_URL set, every file's address is the bucket's
// domain, cached at the edge with no Worker in the path, and the
// Worker's own routes answer a 301 to it. Without, the Worker serves the
// object itself. A key is a content digest or a uuid minted for one
// write, so whoever holds one holds the file: the bucket is public by
// key, board files included (docs/cloud-migration.md, phase 5, step 13).

import { AwsClient } from "aws4fetch";

import limits from "../../config/app_limits.json";

export const UPLOADS = "uploads/";
export const BOARD_FILES = "board_uploads/";
export const DIGEST = /^[0-9a-f]{64}$/;

// The account the bucket lives in: part of R2's S3 hostname.
const ACCOUNT_ID = "9315a859bb8887b2a0ca2cc576f57ae2";

export const ADDRESS_LIFETIME_S = 15 * 60;

export type Kind = "paper" | "board_file";
export const KINDS: readonly Kind[] = ["paper", "board_file"];

// A paper's PDF, by its key in the bucket.
export function paperKey(sha256: string): string {
  return `${UPLOADS}${sha256}.pdf`;
}

// A board file, as its card's file_path names it.
export function blobKey(sha256: string): string {
  return `blobs/${sha256}`;
}

// A board file, by its key in the bucket, from what its card records.
export function boardFileKey(filePath: string): string {
  return `${BOARD_FILES}${filePath}`;
}

// Where a file of a kind goes, and what its row records.
export function placed(kind: Kind, sha256: string): { key: string; file_path: string } {
  return kind === "paper"
    ? { key: paperKey(sha256), file_path: `${sha256}.pdf` }
    : { key: boardFileKey(blobKey(sha256)), file_path: blobKey(sha256) };
}

export function limitMb(kind: Kind): number {
  return kind === "paper" ? limits.files.paper_mb : limits.files.board_file_mb;
}

export async function stored(env: Env, key: string): Promise<boolean> {
  return (await env.FILES.head(key)) !== null;
}

// The bucket's own address for a key, or null when the Worker serves its
// files itself.
export function fileUrl(env: Env, key: string): string | null {
  const base = (env.FILES_URL || "").replace(/\/+$/, "");
  return base ? `${base}/${key}` : null;
}

// Where a file in the uploads area — a paper's PDF, a picture — is
// fetched from: the bucket, or the Worker's route to the same key.
export function uploadUrl(env: Env, path: string): string {
  return fileUrl(env, `${UPLOADS}${path}`) ?? `/${UPLOADS}${path}`;
}

// Where a card's file is fetched from: the bucket, or the Worker's route
// for that card, which serves the object itself.
export function boardFileUrl(env: Env, item: { uuid: string; file_path: string | null }): string | null {
  if (!item.file_path) return null;
  return fileUrl(env, boardFileKey(item.file_path)) ?? `/api/board-items/${item.uuid}/file`;
}

// ------------------------------------------------------------- addresses

export interface UploadAddress {
  url: string;
  headers: Record<string, string>;
}

export function configured(env: Env): boolean {
  return Boolean(env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.FILES_BUCKET);
}

export function checksumHeader(sha256: string): string {
  return btoa(String.fromCharCode(...sha256.match(/../g)!.map((pair) => parseInt(pair, 16))));
}

// A PUT for the bytes whose SHA-256 is `sha256` (hex) and whose length is
// `size`, to the key of their kind. The bucket's door when the Worker
// holds the token to sign for it; the Worker's own otherwise, which the
// caller's credential opens — it travels in the headers, as the
// checksum does, so the client sends one set of headers either way.
export async function uploadAddress(env: Env, request: Request, kind: Kind, sha256: string, size: number, mime: string): Promise<UploadAddress> {
  const headers: Record<string, string> = { "content-type": mime, "x-amz-checksum-sha256": checksumHeader(sha256) };
  if (!configured(env)) {
    return { url: `/api/files/${kind}/${sha256}`, headers: { ...headers, authorization: request.headers.get("authorization") ?? "" } };
  }
  const client = new AwsClient({ accessKeyId: env.R2_ACCESS_KEY_ID!, secretAccessKey: env.R2_SECRET_ACCESS_KEY!, service: "s3", region: "auto" });
  const url = new URL(`https://${ACCOUNT_ID}.r2.cloudflarestorage.com/${env.FILES_BUCKET}/${placed(kind, sha256).key}`);
  url.searchParams.set("X-Amz-Expires", String(ADDRESS_LIFETIME_S));
  // `allHeaders`: content-type and content-length are not signed by
  // default, and here they are the point. The client sets content-length
  // itself, from the body; it is among the signed headers and must match,
  // but is not for the page to set, so it is not listed.
  const signed = await client.sign(new Request(url, { method: "PUT", headers: { ...headers, "content-length": String(size) } }), { aws: { signQuery: true, allHeaders: true } });
  return { url: signed.url, headers };
}

export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
