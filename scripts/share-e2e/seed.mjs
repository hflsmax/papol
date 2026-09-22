// Seed a fresh sharing fixture: two users, a marked-up paper, both links.
//
// Run before `run.mjs`. Every run makes a new paper and a new recipient, so
// the suite can assert that the recipient has not got the paper yet — which
// it could not do twice against the same one.
//
//     node scripts/share-e2e/seed.mjs
//
// PAPOL_BASE         where Papol is (default http://127.0.0.1:5173, the
//                    frontend `./deploy.sh dev` serves, with the Worker
//                    behind it; in CI, the Worker on the assembled site)
// PAPOL_E2E_PDF      a PDF file to upload (default: a fresh page is
//                    written for this run)
// PAPOL_E2E_FIXTURE  where to write the fixture (default: a file in the
//                    temp dir)

import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { account, BASE, call, freshPdf, storePdf } from './papol.mjs';

const suffix = randomBytes(3).toString('hex');
const FIXTURE = process.env.PAPOL_E2E_FIXTURE || join(tmpdir(), 'papol-share-e2e.json');

const pdf = process.env.PAPOL_E2E_PDF
  ? readFileSync(process.env.PAPOL_E2E_PDF)
  : freshPdf(`A reading worth handing over ${suffix}`);

const sharer = await account('sharer@papol.test', 'Alice Sharer');
const user = await account(`user-${suffix}@papol.test`, 'Bob User');

// The bytes first, into the bucket under their digest; then the paper
// that names them.
const address = await storePdf(sharer.token, pdf, `e2e-${suffix}.pdf`);
const [uploadStatus, upload] = await call('POST', '/api/papers/uploaded', {
  token: sharer.token, body: { file_path: address.file_path, uploaded_name: `e2e-${suffix}.pdf` },
});
if (uploadStatus !== 202) throw new Error(`could not upload the PDF: ${JSON.stringify(upload)}`);

const title = `A Reading Worth Handing Over ${suffix}`;
const [status, paper] = await call('POST', '/api/papers', {
  token: sharer.token,
  body: { title, file_path: upload.file_path, authors: JSON.stringify(['A. Sharer']), year: 2026 },
});
if (status !== 200) throw new Error(`could not make a paper from ${upload.file_path}: ${JSON.stringify(paper)}`);
const paperSha256 = paper.sha256;
// The service answers to a paper's name, which is half its digest.
const paperName = paperSha256.slice(0, 32);

const annotate = async (body) => {
  const [code, out] = await call('POST', `/api/papers/${paperName}/annotations`, { token: sharer.token, body });
  if (code !== 200) throw new Error(`could not annotate: ${JSON.stringify(out)}`);
};
// A note and a stroke, so the suite can tell a rich link from a lean one by
// what reaches the page rather than by what the API says.
const note = `Alice's note ${suffix} — this should reach whoever follows the link`;
await annotate({
  kind: 'note', page: 1, content: note,
  body: { anchor: { type: 'point', x: 0.3, y: 0.4 } },
});
await annotate({
  kind: 'ink', page: 1,
  body: { points: [{ x: 0.15, y: 0.25 }, { x: 0.55, y: 0.28 }], color: '#b3923d', width: 0.006, opacity: 0.9, shape: 'round' },
});
// And a clip, so the sharer's own reading of the paper has one to draw.
await annotate({
  kind: 'clip', page: 1,
  body: { source: { x: 0.1, y: 0.1, w: 0.25, h: 0.15 }, frame: { x: 0.5, y: 0.45, w: 0.25, h: 0.15 }, floating: false },
});

const [, rich] = await call('POST', `/api/papers/${paperName}/sharable`, { token: sharer.token, body: { include_annotations: true } });
const [, lean] = await call('POST', `/api/papers/${paperName}/sharable`, { token: sharer.token, body: { include_annotations: false } });

writeFileSync(FIXTURE, JSON.stringify({
  base: BASE, title, note,
  sharer, user,
  paper_sha256: paperSha256, paper_name: paperName,
  rich: rich.uuid, lean: lean.uuid,
  rich_url: `${BASE}/viewer/?share=${rich.uuid}`,
  lean_url: `${BASE}/viewer/?share=${lean.uuid}`,
  nook_url: `${BASE}/viewer/?pdf=${paperSha256}`,
}, null, 1));

console.log(`seeded ${title}`);
console.log(`  rich ${rich.uuid.slice(0, 8)}  lean ${lean.uuid.slice(0, 8)}  recipient ${user.name}`);
console.log(`  fixture at ${FIXTURE}`);
