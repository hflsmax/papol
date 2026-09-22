// A PDF goes from the browser straight to the bucket.
//
// Every byte that passes through the Worker costs it CPU (about 18 ms a
// megabyte, measured), and the Free plan gives an invocation about two
// seconds of it, so a Worker that received a PDF and put it in the bucket
// had a ceiling of a hundred megabytes and spent most of its budget on
// the copying. Now the browser hashes the file, asks for an address, and
// PUTs the bytes to R2's S3 door itself with a URL this module signs: the
// Worker sees the digest, the size and the name, never the file.
//
// The address is a presigned S3 PUT, valid for fifteen minutes, to the
// key the digest names. The signature covers the `x-amz-checksum-sha256`
// header, so the bucket itself refuses bytes that do not hash to the
// name they would be stored under, and `content-length`, so a file
// larger than the size the address was asked for is refused too. The
// browser sends the headers the answer lists, exactly.

import { AwsClient } from "aws4fetch";

import limits from "../../../config/app_limits.json";
import { UPLOADS } from "../sync/blobs";

// The account the buckets live in: part of R2's S3 hostname.
const ACCOUNT_ID = "9315a859bb8887b2a0ca2cc576f57ae2";

export const ADDRESS_LIFETIME_S = 15 * 60;

export const PAPER_LIMIT = limits.files.paper_mb * 1024 * 1024;

export const DIGEST = /^[0-9a-f]{64}$/;

export interface UploadAddress {
  url: string;
  headers: Record<string, string>;
}

export function configured(env: Env): boolean {
  return Boolean(env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.FILES_BUCKET);
}

// The key a paper's PDF is stored under.
export function paperKey(sha256: string): string {
  return `${UPLOADS}${sha256}.pdf`;
}

function base64(hex: string): string {
  return btoa(String.fromCharCode(...hex.match(/../g)!.map((pair) => parseInt(pair, 16))));
}

// A presigned PUT for the bytes whose SHA-256 is `sha256` (hex) and whose
// length is `size`, to the paper's key in the bucket.
export async function uploadAddress(env: Env, sha256: string, size: number): Promise<UploadAddress> {
  if (!configured(env)) throw new Error("Direct uploads are not configured");
  const client = new AwsClient({ accessKeyId: env.R2_ACCESS_KEY_ID!, secretAccessKey: env.R2_SECRET_ACCESS_KEY!, service: "s3", region: "auto" });
  const url = new URL(`https://${ACCOUNT_ID}.r2.cloudflarestorage.com/${env.FILES_BUCKET}/${paperKey(sha256)}`);
  url.searchParams.set("X-Amz-Expires", String(ADDRESS_LIFETIME_S));
  const headers = { "content-type": "application/pdf", "x-amz-checksum-sha256": base64(sha256), "content-length": String(size) };
  // `allHeaders`: content-type and content-length are not signed by
  // default, and here they are the point.
  const signed = await client.sign(new Request(url, { method: "PUT", headers }), { aws: { signQuery: true, allHeaders: true } });
  // The browser sets content-length itself, from the body; it is listed
  // among the signed headers and must match, but is not for the page to set.
  const { "content-length": _length, ...sent } = headers;
  return { url: signed.url, headers: sent };
}
