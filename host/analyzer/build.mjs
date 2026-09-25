// One file out: dist/analyzer.js, which the host runs with a plain `node`.
//
// The shapes it answers in are imported straight from the Worker's source
// (cloudflare/src/papers/reading.ts), so there is one definition of them;
// esbuild inlines what it needs. The bundle is checked in: the host
// rebuilds with `git merge` and `nixos-rebuild switch`, with no npm and no
// network inside a Nix build, and a single-file bundle with no runtime
// dependencies is what the tests ran against. `npm run check` rebuilds and
// fails if the checked-in file is stale.
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));

await esbuild.build({
  entryPoints: [path.join(here, "src/server.ts")],
  outfile: path.join(here, "dist/analyzer.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  legalComments: "none",
  banner: { js: "// Built by `npm run build` in host/analyzer from src/ and cloudflare/src/papers/reading.ts. Do not edit." },
  // pdf.js, bundled through unpdf, asks for `canvas` and `path2d` only to
  // draw pages, which the rules never do.
  external: ["canvas", "path2d", "@napi-rs/canvas"],
});
