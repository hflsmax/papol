// A stand-in for the host's helper beside GROBID (host/helper/), for the
// browser suite: the Worker under `wrangler dev` is pointed at it with
// GROBID_URL and GROBID_AUTH, and asks it what a PDF says of itself just
// as it asks the real one (cloudflare/src/papers/helper.ts).
//
//     node scripts/share-e2e/fake-helper.mjs
//
// It answers in the real helper's shapes, behind the credential nginx
// asks for in front of it, under the `/helper/` prefix nginx serves it at:
//
//   POST /helper/header   application/pdf → { title, authors, journal, year, doi, arxiv_id }
//   POST /helper/analyze  application/pdf → { references, citations, links }
//
// and the same under /helper/header-rules and /helper/analyze-rules, which
// a Worker with ANALYZER = "rules" (wrangler.toml, production's vars) asks.
//
// A local Worker has no bucket domain, so it sends the bytes themselves
// (helper.ts, `sent`); the stand-in takes only that, and a body that is
// not a PDF is refused as the real one refuses it. What it answers for a
// PDF is what the suite told it, by the PDF's digest:
//
//   POST /__plan  { sha256, header }        answer the title block with `header`
//   POST /__plan  { sha256, status, detail } fail, as a helper whose GROBID fell over
//   GET  /__seen                             every request it was sent, in order
//
// A PDF nobody planned for is one GROBID read no title block from — no
// title, no authors — so the upload keeps the title its filename gives,
// as it does with no helper at all. No DOI or arXiv id is ever answered
// unless planned: one would send the Worker to CrossRef.
//
// PAPOL_FAKE_HELPER_PORT  where it listens (default 8072, the real one's)
// PAPOL_FAKE_HELPER_AUTH  the "user:password" it wants (default papol:e2e)

import { createHash } from 'node:crypto';
import http from 'node:http';

const PORT = Number(process.env.PAPOL_FAKE_HELPER_PORT || 8072);
const AUTH = process.env.PAPOL_FAKE_HELPER_AUTH || 'papol:e2e';
const EXPECTED = `Basic ${Buffer.from(AUTH).toString('base64')}`;

const NOTHING_READ = { title: null, authors: [], journal: null, year: null, doi: null, arxiv_id: null };
const plans = new Map();
const seen = [];

function body(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function reply(response, status, value) {
  const json = JSON.stringify(value);
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(json) });
  response.end(json);
}

async function answer(request, response) {
  const path = (request.url || '/').split('?')[0];
  if (request.method === 'GET' && path === '/__seen') return reply(response, 200, seen);
  if (request.method === 'POST' && path === '/__plan') {
    const plan = JSON.parse((await body(request)).toString() || '{}');
    plans.set(plan.sha256, plan);
    return reply(response, 200, { planned: plan.sha256 });
  }
  if (request.method === 'GET' && path === '/helper/health') return reply(response, 200, { ok: true });
  if (!['/helper/header', '/helper/analyze', '/helper/header-rules', '/helper/analyze-rules'].includes(path)) return reply(response, 404, { detail: 'No such endpoint' });

  const bytes = await body(request);
  const type = String(request.headers['content-type'] || '').split(';')[0].trim();
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const record = {
    path, method: request.method, type, size: bytes.length, sha256,
    authorized: request.headers.authorization === EXPECTED,
    pdf: bytes.subarray(0, 5).toString('latin1') === '%PDF-',
  };
  seen.push(record);
  // nginx's answer to a wrong credential, before the helper sees anything.
  if (!record.authorized) return reply(response, 401, { detail: 'Unauthorized' });
  if (request.method !== 'POST') return reply(response, 405, { detail: 'POST a PDF here' });
  if (type !== 'application/pdf' || !record.pdf) return reply(response, 400, { detail: 'The body is not a PDF' });

  const plan = plans.get(sha256);
  if (plan?.status) return reply(response, plan.status, { detail: plan.detail || 'GROBID failed' });
  if (path.startsWith('/helper/analyze')) return reply(response, 200, { references: [], citations: [], links: [] });
  return reply(response, 200, { ...NOTHING_READ, ...(plan?.header || {}) });
}

const server = http.createServer((request, response) => {
  answer(request, response).catch((error) => reply(response, 500, { detail: `Unexpected: ${error.message}` }));
});
server.listen(PORT, '127.0.0.1', () => console.log(`fake helper on 127.0.0.1:${PORT}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
