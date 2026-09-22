// Files: where the bytes go, for a paper and for a board file alike, and
// the Worker's own door when the bucket has no address to give.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import worker from "../src/index";
import { call, ok, register, sha256 } from "./helpers";

const BUCKET = "https://9315a859bb8887b2a0ca2cc576f57ae2.r2.cloudflarestorage.com";

// The digest again, in the base64 S3 wants.
const hexOf = (checksum: string) => [...atob(checksum)].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");

describe("the upload address", () => {
  const pdf = "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF";

  it("answers a stored digest with its file, and a new one with a signed PUT that binds the bytes, their size and their type", async () => {
    const account = await register();
    const digest = await sha256(pdf);
    const address = await ok("POST", "/api/files/upload-address", { headers: account.headers, json: { kind: "paper", sha256: digest, size: pdf.length, name: "Some-Paper.pdf" } });
    expect(address).toMatchObject({ stored: false, file_path: `${digest}.pdf`, headers: { "content-type": "application/pdf" } });
    const url = new URL(address.url);
    expect(url.origin).toBe(BUCKET);
    expect(url.pathname).toBe(`/papol-files/uploads/${digest}.pdf`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(url.searchParams.get("X-Amz-Credential")).toMatch(/^test-access-key\/\d{8}\/auto\/s3\/aws4_request$/);
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;content-type;host;x-amz-checksum-sha256");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(hexOf(address.headers["x-amz-checksum-sha256"])).toBe(digest);
    expect(Object.keys(address.headers).sort()).toEqual(["content-type", "x-amz-checksum-sha256"]);

    await env.FILES.put(`uploads/${digest}.pdf`, pdf);
    expect(await ok("POST", "/api/files/upload-address", { headers: account.headers, json: { kind: "paper", sha256: digest, size: pdf.length, name: "again.pdf" } }))
      .toEqual({ stored: true, file_path: `${digest}.pdf` });

    const refused = (json: unknown) => call("POST", "/api/files/upload-address", { headers: account.headers, json });
    expect((await refused({ kind: "paper", sha256: "not a digest", size: 1, name: "a.pdf" })).status).toBe(422);
    expect((await refused({ kind: "paper", sha256: digest, size: 1, name: "notes.txt" })).status).toBe(400);
    expect((await refused({ kind: "paper", sha256: digest, size: 201 * 1024 * 1024, name: "huge.pdf" })).status).toBe(413);
    expect((await refused({ kind: "picture", sha256: digest, size: 1, name: "a.png" })).status).toBe(422);
    expect((await refused({ sha256: digest, size: 1, name: "a.pdf" })).status).toBe(422);
    expect((await call("POST", "/api/files/upload-address", { json: { kind: "paper", sha256: digest, size: 1, name: "a.pdf" } })).status).toBe(401);
  });

  it("places a board file under its digest in the board files area, typed as the caller says, within its own limit", async () => {
    const account = await register();
    const image = "png bytes";
    const digest = await sha256(image);
    const address = await ok("POST", "/api/files/upload-address", { headers: account.headers, json: { kind: "board_file", sha256: digest, size: image.length, name: "diagram.png", mime: "image/png" } });
    expect(address).toMatchObject({ stored: false, file_path: `blobs/${digest}`, headers: { "content-type": "image/png" } });
    expect(new URL(address.url).pathname).toBe(`/papol-files/board_uploads/blobs/${digest}`);
    expect(hexOf(address.headers["x-amz-checksum-sha256"])).toBe(digest);
    // No type given: stored as bytes, whatever the name suggests.
    const untyped = await ok("POST", "/api/files/upload-address", { headers: account.headers, json: { kind: "board_file", sha256: digest, size: image.length, name: "notes.txt" } });
    expect(untyped.headers["content-type"]).toBe("application/octet-stream");
    expect((await call("POST", "/api/files/upload-address", { headers: account.headers, json: { kind: "board_file", sha256: digest, size: 26 * 1024 * 1024, name: "big.png" } })).status).toBe(413);

    await env.FILES.put(`board_uploads/blobs/${digest}`, image);
    expect(await ok("POST", "/api/files/upload-address", { headers: account.headers, json: { kind: "board_file", sha256: digest, size: image.length, name: "diagram.png" } }))
      .toEqual({ stored: true, file_path: `blobs/${digest}` });
  });
});

describe("the Worker's own door", () => {
  // A Worker without the bucket's token: a local `wrangler dev`.
  const local = { ...env, R2_ACCESS_KEY_ID: undefined, R2_SECRET_ACCESS_KEY: undefined } as unknown as Env;
  const ask = (method: string, path: string, init: { headers?: Record<string, string>; body?: BodyInit; json?: unknown } = {}) => {
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    let body = init.body;
    if (init.json !== undefined) { body = JSON.stringify(init.json); headers["content-type"] = "application/json"; }
    return worker.fetch(new Request(`https://papol.test${path}`, { method, headers, body }), local);
  };

  it("is the address given, with the caller's own credential among the headers, and holds the bytes to their name", async () => {
    const account = await register();
    const image = "clip bytes";
    const digest = await sha256(image);
    const answer = await ask("POST", "/api/files/upload-address", { headers: account.headers, json: { kind: "board_file", sha256: digest, size: image.length, name: "clip.png", mime: "image/png" } });
    expect(answer.status).toBe(200);
    const address = await answer.json() as any;
    expect(address).toEqual({
      stored: false, file_path: `blobs/${digest}`, url: `/api/files/board_file/${digest}`,
      headers: { "content-type": "image/png", "x-amz-checksum-sha256": address.headers["x-amz-checksum-sha256"], authorization: account.headers.Authorization },
    });
    expect(hexOf(address.headers["x-amz-checksum-sha256"])).toBe(digest);

    // The PUT exactly as the client would make it: the listed headers, the bytes.
    const put = await ask("PUT", address.url, { headers: address.headers, body: image });
    expect(put.status, await put.clone().text()).toBe(204);
    const object = await env.FILES.get(`board_uploads/blobs/${digest}`);
    expect(await object!.text()).toBe(image);
    expect(object!.httpMetadata?.contentType).toBe("image/png");
    // Again is nothing: the bytes are their name.
    expect((await ask("PUT", address.url, { headers: address.headers, body: image })).status).toBe(204);

    // The wrong bytes, the wrong name, no credential, a kind that is not one.
    expect((await ask("PUT", address.url, { headers: address.headers, body: "other bytes" })).status).toBe(422);
    expect((await ask("PUT", `/api/files/board_file/${"0".repeat(64)}`, { headers: address.headers, body: image })).status).toBe(422);
    expect((await ask("PUT", "/api/files/board_file/short", { headers: address.headers, body: image })).status).toBe(422);
    expect((await ask("PUT", address.url, { headers: { "content-type": "image/png" }, body: image })).status).toBe(401);
    expect((await ask("PUT", `/api/files/picture/${digest}`, { headers: address.headers, body: image })).status).toBe(404);

    // A paper through the same door lands under the paper's key, as a PDF.
    const pdf = "%PDF-1.4 local";
    const paper = await sha256(pdf);
    const paperAddress = await (await ask("POST", "/api/files/upload-address", { headers: account.headers, json: { kind: "paper", sha256: paper, size: pdf.length, name: "local.pdf" } })).json() as any;
    expect(paperAddress.url).toBe(`/api/files/paper/${paper}`);
    expect((await ask("PUT", paperAddress.url, { headers: paperAddress.headers, body: pdf })).status).toBe(204);
    expect((await env.FILES.get(`uploads/${paper}.pdf`))!.httpMetadata?.contentType).toBe("application/pdf");
  });

  it("is shut on a Worker that can sign for the bucket", async () => {
    const account = await register();
    const digest = await sha256("x");
    expect((await call("PUT", `/api/files/board_file/${digest}`, { headers: account.headers, body: "x" })).status).toBe(404);
  });
});
