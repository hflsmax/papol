// The website: the frontend's document for clean routes, the viewer and
// the board under their own paths, and an API path that is not a page.
import { describe, expect, it } from "vitest";

import { call, uuid } from "./helpers";

async function html(path: string): Promise<string> {
  const response = await call("GET", path);
  expect(response.status, path).toBe(200);
  expect(response.headers.get("content-type"), path).toContain("text/html");
  return response.text();
}

describe("the website", () => {
  it("answers the frontend's document for the root and for any clean route", async () => {
    const root = await html("/");
    expect(root).toContain("<title>");
    expect(await html("/library")).toBe(root);
    expect(await html("/paper/abc123")).toBe(root);
  });

  it("serves the viewer and the board from their own builds", async () => {
    const viewer = await html("/viewer/");
    expect(viewer).not.toBe(await html("/"));
    const board = await html(`/boards/${uuid()}`);
    expect(board).not.toBe(viewer);
    const script = await call("GET", "/boards/assets/board.js");
    expect(script.status).toBe(200);
    expect(script.headers.get("content-type")).toContain("javascript");
  });

  it("does not turn an unknown API or upload path into a page", async () => {
    for (const path of ["/api/no-such-route", "/uploads/no-such-file.pdf"]) {
      const response = await call("GET", path);
      expect(response.status, path).toBe(404);
      expect(((await response.json()) as { detail: string }).detail).toBeTruthy();
    }
  });
});
