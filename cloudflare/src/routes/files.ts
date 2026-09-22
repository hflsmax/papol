// Files: where the bytes go, and the Worker's own door for them when the
// bucket has none to give (src/files.ts).

import * as files from "../files";
import { currentUser } from "../auth";
import { json, readJson, refuse, type Router } from "../http";
import type { Row } from "../db";
import * as validate from "../validate";

export function fileRoutes(router: Router) {
  // The client has hashed the file and says what it is: a paper's PDF or
  // a board file, its digest, size, name and type. It is told either that
  // the bucket holds those bytes already, or where to PUT them itself.
  // Nothing is stored or queued here; the route that records the row is
  // told afterwards that the bytes are in.
  router.on("POST", "/api/files/upload-address", async ({ request, env }) => {
    await currentUser(request, env);
    const data = await readJson<Row>(request);
    const check = validate.checking();
    const kind = check.oneOf("kind", data.kind, files.KINDS)!;
    const sha256 = check.string("sha256", data.sha256, { pattern: files.DIGEST })!;
    const size = check.integer("size", data.size, { min: 1 })!;
    const name = check.string("name", data.name, { max: validate.text.uploaded_filename })!;
    const mime = check.string("mime", data.mime, { max: validate.text.mime_type, optional: true });
    check.done();
    if (kind === "paper" && !name.toLowerCase().endsWith(".pdf")) refuse(400, "Only PDF files are allowed");
    if (size > files.limitMb(kind) * 1024 * 1024) refuse(413, `${kind === "paper" ? "PDF" : "Board"} files may be at most ${files.limitMb(kind)} MB`);
    const { key, file_path: filePath } = files.placed(kind, sha256);
    if (await files.stored(env, key)) return json({ stored: true, file_path: filePath });
    const contentType = kind === "paper" ? "application/pdf" : (mime?.split(";")[0].trim() || "application/octet-stream");
    return json({ stored: false, file_path: filePath, ...(await files.uploadAddress(env, request, kind, sha256, size, contentType)) });
  });

  // The Worker's own door: the address a local Worker gives, since its
  // R2 is a simulation no S3 token reaches. The same contract the bucket
  // holds a presigned PUT to — the bytes must hash to the name — and the
  // caller's own credential, which the address listed among the headers.
  // A Worker that can sign for the bucket has no such door.
  router.on("PUT", "/api/files/:kind/:sha256", async ({ request, env, params }) => {
    if (files.configured(env)) refuse(404, "Files go to the bucket");
    await currentUser(request, env);
    const kind = params.kind as files.Kind;
    if (!files.KINDS.includes(kind)) refuse(404, "No such kind of file");
    if (!files.DIGEST.test(params.sha256)) refuse(422, "The name must be the file's SHA-256, in lowercase hex");
    const body = await request.arrayBuffer();
    if (body.byteLength > files.limitMb(kind) * 1024 * 1024) refuse(413, `Files of this kind may be at most ${files.limitMb(kind)} MB`);
    if ((await files.sha256Hex(body)) !== params.sha256) refuse(422, "The bytes do not hash to their name");
    const { key } = files.placed(kind, params.sha256);
    if (!(await files.stored(env, key))) {
      const mime = kind === "paper" ? "application/pdf" : (request.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim() || "application/octet-stream";
      await env.FILES.put(key, body, { httpMetadata: { contentType: mime } });
    }
    return new Response(null, { status: 204 });
  });
}
