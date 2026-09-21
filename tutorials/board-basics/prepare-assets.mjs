// The two images the recording drops onto the board, fetched fresh for
// the run and removed by record.mjs afterwards: neither is Papol's to
// keep in the repository.
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.dirname(new URL(import.meta.url).pathname);
const headers = { 'User-Agent': 'Papol tutorial asset preparation' };

async function download(url, file) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  writeFileSync(path.join(root, file), Buffer.from(await response.arrayBuffer()));
}

await download('https://commons.wikimedia.org/wiki/Special:Redirect/file/Utah_teapot_2.png?width=1200', 'utah-teapot.png');
await download('https://graphics.stanford.edu/data/3Dscanrep/stanford-bunny-cebal-ssh.jpg', 'stanford-bunny.jpg');
