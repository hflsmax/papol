// A file by its digest, for a desktop build that asks the Worker rather
// than the bucket: the replica knows a card's or a paper's sha256 and
// nothing else, so this is the one route that finds the key from it.
//
// With FILES_URL set the answer is a 301 to the bucket's own address —
// a current build never asks, since it builds that address itself from
// `files_url` in the client requirements. Without, a local Worker serves
// the object.

import { currentUser } from "../auth";
import { one } from "../db";
import { boardFileKey, fileUrl, paperKey } from "../files";
import { refuse, type RouteContext } from "../http";

export async function getBlob({ request, env, params }: RouteContext): Promise<Response> {
  await currentUser(request, env);
  const sha256 = params.sha256;
  let key: string | null = null;
  let mime = "application/octet-stream";
  const item = await one<{ file_path: string | null; mime_type: string | null }>(
    env.DB, "SELECT file_path, mime_type FROM board_items WHERE sha256 = ? AND file_path IS NOT NULL LIMIT 1", sha256,
  );
  if (item?.file_path) {
    key = boardFileKey(item.file_path);
    mime = item.mime_type ?? mime;
  } else if (await one(env.DB, "SELECT 1 FROM papers WHERE sha256 = ?", sha256)) {
    key = paperKey(sha256);
    mime = "application/pdf";
  }
  if (!key) refuse(404, "Blob not found");
  const address = fileUrl(env, key);
  if (address) return new Response(null, { status: 301, headers: { location: address, "cache-control": "public, max-age=86400" } });
  const object = await env.FILES.get(key);
  if (!object) refuse(404, "Blob not found");
  return new Response(object.body, {
    headers: {
      "content-type": mime,
      "content-length": String(object.size),
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
