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
import { createHash, randomBytes } from 'node:crypto';

const BASE = (process.env.PAPOL_BASE || 'http://127.0.0.1:5173').replace(/\/$/, '');
const PASSWORD = 'papol-test-pw';
const suffix = randomBytes(3).toString('hex');
const FIXTURE = process.env.PAPOL_E2E_FIXTURE || join(tmpdir(), 'papol-share-e2e.json');

async function call(method, path, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(BASE + path, {
      method,
      headers,
      body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
  } catch (error) {
    console.error(`No Papol at ${BASE} (${error.cause?.code || error.message}). Start one with ./deploy.sh dev`);
    process.exit(2);
  }
  const text = await response.text();
  return [response.status, text.trim() ? JSON.parse(text) : null];
}

// Register, or sign in if this run has been made before.
async function account(email, name) {
  let [status, out] = await call('POST', '/api/auth/register', {
    body: { email, display_name: name, password: PASSWORD },
  });
  if (status !== 200) {
    [status, out] = await call('POST', '/api/auth/login', { body: { email, password: PASSWORD } });
    if (status !== 200) throw new Error(`could not sign ${email} in: ${JSON.stringify(out)}`);
  }
  return { token: out.token, uuid: out.user.uuid, name: out.user.display_name };
}

// One page with this run's suffix printed on it. New words are new bytes,
// and the digest of the bytes is the paper's identity — which is what makes
// the paper genuinely new each run rather than a reused one.
function freshPdf(text) {
  const stream = `BT /F1 18 Tf 72 720 Td (${text.replace(/[\\()]/g, (c) => `\\${c}`)}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

const pdf = process.env.PAPOL_E2E_PDF
  ? readFileSync(process.env.PAPOL_E2E_PDF)
  : freshPdf(`A reading worth handing over ${suffix}`);

const sharer = await account('sharer@papol.test', 'Alice Sharer');
const user = await account(`user-${suffix}@papol.test`, 'Bob User');

// The bytes first, into the bucket under their digest by the address the
// Worker gives (its own door, on a local one); then the paper that names them.
const digest = createHash('sha256').update(pdf).digest('hex');
const [addressStatus, address] = await call('POST', '/api/files/upload-address', {
  token: sharer.token, body: { kind: 'paper', sha256: digest, size: pdf.length, name: `e2e-${suffix}.pdf` },
});
if (addressStatus !== 200) throw new Error(`could not get an address for the PDF: ${JSON.stringify(address)}`);
if (!address.stored) {
  const put = await fetch(/^https?:/.test(address.url) ? address.url : BASE + address.url, { method: 'PUT', headers: address.headers, body: pdf });
  if (!put.ok) throw new Error(`could not store the PDF: the bucket answered ${put.status}`);
}
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
