// The release checklist's viewer step, automated: open a shared reading of
// a real PDF, click a citation marker, and fail unless the reference card
// fills with the resolved work. The unit tests state what the source layer
// answers; nothing else watches a user actually click "[1]" and get an
// answer, and that is the click Papol exists for.
//
// The API is served by this script from the shapes the backend declares, so
// the check is hermetic: no backend, no GROBID, no network. What it proves
// is the viewer's own half — markers drawn from an analysis, a click turned
// into an item request, the answer rendered — which is the half a release
// can break silently.
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { distFile, runSmoke } from '../../scripts/smoke-harness.mjs';

const dist = resolve(process.env.PAPOL_SMOKE_DIST || 'dist');

// One page, one line, built here: the check must run from a bare checkout,
// on CI as on a laptop, and a fixture nobody can read is a fixture nobody
// maintains. The offsets are computed, not guessed, because pdf.js follows
// the xref table to every object.
function smokePdf() {
  const content = 'BT /F1 12 Tf 72 720 Td (A paper worth citing) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] '
      + '/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
    + offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
    + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

const pdfBytes = smokePdf();
const PDF_SHA256 = createHash('sha256').update(pdfBytes).digest('hex');

const SHARE = 'aa11bb22-cc33-4d44-8e55-ff6677889900';
const REFERENCE = '11112222-3333-4444-8555-666677778888';
const reference = {
  uuid: REFERENCE,
  key: 'b0',
  index: 0,
  raw: 'A. Author. The Cited Work. Journal of Smoke, 2020.',
  title: 'The Cited Work',
  year: 2020,
  page: 1,
  y: 0.8,
};
const shared = {
  uuid: SHARE,
  kind: 'rich',
  user: { uuid: '99998888-7777-4666-8555-444433332222', display_name: 'Smoke Sharer' },
  paper: {
    title: 'The Smoke Paper',
    authors: '["Ada Lovelace"]',
    journal: 'Journal of Smoke',
    year: 2026,
    doi: null,
    file_path: 'smoke.pdf',
    sha256: PDF_SHA256,
  },
  annotations: [],
  created_at: '2026-01-02T03:04:05',
};
const analysis = {
  paper_sha256: PDF_SHA256,
  status: 'ready',
  detail: null,
  references: [reference],
  citations: [
    { reference_uuid: REFERENCE, label: '[1]', page: 1, x: 0.2, y: 0.2, w: 0.08, h: 0.02, inferred: false },
  ],
  links: [],
};
const resolved = {
  ...reference,
  resolved_status: 'ok',
  resolution: {
    title: 'The Cited Work',
    authors: ['A. Author'],
    year: 2020,
    venue: 'Journal of Smoke',
    abstract: 'What the citation turned out to be.',
    citations: 12,
    url: 'https://example.org/cited-work',
  },
};

const json = (body) => ({ type: 'application/json', body: JSON.stringify(body) });

// Wait for a citation marker, click it, and wait for the card to show the
// resolved title. A boundary panel standing where the viewer should be is
// its own answer.
const probe = `<script>
  (() => {
    let clicked = false;
    const ready = () => {
      if (document.querySelector('.render-error')) {
        fetch('/__papol_smoke_ready?page=render-error', { method: 'POST' });
        return;
      }
      const marker = document.querySelector('.cite');
      if (marker && !clicked) {
        clicked = true;
        marker.click();
      }
      const title = document.querySelector('.ref-card .ref-title');
      if (title && title.textContent.includes('The Cited Work')) {
        fetch('/__papol_smoke_ready?page=viewer-citation', { method: 'POST' });
        return;
      }
      setTimeout(ready, 25);
    };
    ready();
  })();
</script>`;

await runSmoke(
  [{ path: `/papol/viewer/?share=${SHARE}`, page: 'viewer-citation' }],
  async (url) => {
    const { pathname } = url;
    if (pathname === `/papol/api/shared/${SHARE}`) return json(shared);
    if (pathname === `/papol/api/viewer-references/${PDF_SHA256}`) return json(analysis);
    if (pathname === `/papol/api/viewer-references/item/${REFERENCE}`) return json(resolved);
    if (pathname === '/papol/uploads/smoke.pdf') return { type: 'application/pdf', body: pdfBytes };
    if (pathname.startsWith('/papol/api/')) {
      // Everything else the viewer asks for is an extra a shared reading
      // works without; a JSON 404 keeps it from parsing HTML as an answer.
      return { status: 404, ...json({ detail: 'Not part of the viewer smoke' }) };
    }
    const relative = pathname.replace(/^\/papol\/viewer\/?/, '') || 'index.html';
    const file = await distFile(dist, relative);
    if (file && relative === 'index.html') {
      return { type: file.type, body: file.body.toString('utf8').replace('</body>', `${probe}</body>`) };
    }
    return file;
  },
);

console.log('Viewer browser smoke: a citation marker opened its reference card.');
