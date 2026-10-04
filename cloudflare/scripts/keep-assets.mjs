#!/usr/bin/env node
// Keep the files earlier builds named, so a page opened before a deploy
// still finds them after it.
//
// The apps load parts of themselves when first wanted (the viewer's search,
// the analyzer's rules), by names hashed from their content. A deploy
// replaces every file the Worker serves, so a tab opened on the build before
// asks for a name the site no longer has. Each assembled site therefore
// lists its hashed files in assets/built.json with when a build last had
// them; before a deploy, the files the live site lists that this build lacks
// are fetched from it and served again, until KEEP_DAYS after the last build
// that had them.
//
//   node keep-assets.mjs <site directory> <live base URL>
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

const KEEP_DAYS = 7;
// Where each app's build puts its hashed files, as the Worker serves them.
const HASHED = ["assets", "viewer/assets", "boards/assets"];
export const LIST = "assets/built.json";

async function filesUnder(root, dir) {
  const found = [];
  let entries;
  try {
    entries = await readdir(join(root, dir), { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return found;
    throw error;
  }
  for (const entry of entries) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) found.push(...(await filesUnder(root, path)));
    else if (path !== LIST) found.push(path);
  }
  return found;
}

// The live site's list, or null where it has none: a site deployed before
// this script answers the list's path with its own document, or a 404.
async function liveList(base) {
  const response = await fetch(new URL(LIST, base));
  const type = response.headers.get("content-type") ?? "";
  if (response.status === 404 || type.includes("text/html")) return null;
  if (!response.ok) throw new Error(`${LIST}: ${response.status}`);
  return response.json();
}

// What to keep of the live list, given this build's files and the time now.
export function toKeep(live, built, now) {
  const oldest = now - KEEP_DAYS * 24 * 60 * 60 * 1000;
  return Object.entries(live)
    .filter(([path, last]) => !built.has(path) && Date.parse(last) >= oldest)
    .map(([path, last]) => ({ path, last }));
}

export async function keepAssets(site, base, now = Date.now()) {
  const built = new Set((await Promise.all(HASHED.map((dir) => filesUnder(site, dir)))).flat());
  const list = Object.fromEntries([...built].map((path) => [path, new Date(now).toISOString()]));

  const live = await liveList(base);
  if (!live) console.log(`${base} lists no earlier build; keeping nothing`);
  const keep = live ? toKeep(live, built, now) : [];
  const lost = [];
  // A few at a time: the earlier builds share most files, so the ones to
  // fetch are the handful each deploy changed, times the builds of a week.
  for (let i = 0; i < keep.length; i += 16) {
    await Promise.all(keep.slice(i, i + 16).map(async ({ path, last }) => {
      const response = await fetch(new URL(path, base));
      const type = response.headers.get("content-type") ?? "";
      if (!response.ok || type.includes("text/html")) {
        lost.push(`${path} (${response.status})`);
        return;
      }
      const target = join(site, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, new Uint8Array(await response.arrayBuffer()));
      list[path] = last;
    }));
  }
  await mkdir(join(site, dirname(LIST)), { recursive: true });
  await writeFile(join(site, LIST), `${JSON.stringify(list, null, 1)}\n`);
  console.log(`Kept ${keep.length - lost.length} files of earlier builds in ${relative(process.cwd(), site) || "."}`);
  // A file the live list names but the live site does not serve is a tab
  // that will fail; the deploy goes on, but says so.
  for (const path of lost) console.log(`::warning::the live site lists ${path} but does not serve it`);
  return { kept: keep.length - lost.length, lost };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [site, base] = process.argv.slice(2);
  if (!site || !base) {
    console.error("usage: keep-assets.mjs <site directory> <live base URL>");
    process.exit(64);
  }
  await keepAssets(site, base.endsWith("/") ? base : `${base}/`);
}
