// Bundles a script under scripts/ as the analyzer itself is bundled, and runs
// it: corpus.ts by default, or the one named first (`lines`, …).
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import os from "node:os";
import * as esbuild from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = ["lines", "bib", "floats", "header"].includes(process.argv[2]) ? process.argv.splice(2, 1)[0] : "corpus";
const out = path.join(os.tmpdir(), `papol-corpus-${process.pid}.mjs`);
await esbuild.build({
  entryPoints: [path.join(here, `${script}.ts`)], outfile: out, bundle: true, platform: "node", format: "esm", target: "node22",
  nodePaths: [path.join(here, "..", "node_modules")], logLevel: "error",
});
await import(pathToFileURL(out).href);
