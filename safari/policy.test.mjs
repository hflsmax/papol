// node --test safari/
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const context = { URL };
context.globalThis = context;
vm.runInNewContext(readFileSync(new URL('./extension/policy.js', import.meta.url), 'utf8'), context);
const P = context.PapolPolicy;

test('PDFs are known by their name, and by the sites that serve them without one', () => {
  assert.equal(P.looksLikePdf('https://example.org/papers/paper.pdf'), true);
  assert.equal(P.looksLikePdf('https://example.org/papers/PAPER.PDF?download=1'), true);
  assert.equal(P.looksLikePdf('https://arxiv.org/pdf/1706.03762v7'), true);
  assert.equal(P.looksLikePdf('https://openreview.net/pdf?id=abc'), true);
  assert.equal(P.looksLikePdf('https://dl.acm.org/doi/pdf/10.1145/3290380'), true);
  assert.equal(P.looksLikePdf('https://link.springer.com/content/pdf/10.1007/978-3-540-78800-3_24.pdf'), true);
  assert.equal(P.looksLikePdf('https://arxiv.org/abs/1706.03762'), false);
  assert.equal(P.looksLikePdf('https://dl.acm.org/doi/epdf/10.1145/3290380'), false);
  assert.equal(P.looksLikePdf('https://example.org/pdf-tools.html'), false);
  assert.equal(P.looksLikePdf('file:///Users/me/paper.pdf'), false);
});

test('a PDF opens in the viewer by its address', () => {
  assert.equal(
    P.viewerUrl('https://arxiv.org/pdf/1706.03762#page=3'),
    'https://papol.io/viewer/?from=https%3A%2F%2Farxiv.org%2Fpdf%2F1706.03762%23page%3D3',
  );
  assert.equal(P.viewerUrl('https://x.org/a.pdf', 'http://127.0.0.1:5173'), 'http://127.0.0.1:5173/viewer/?from=https%3A%2F%2Fx.org%2Fa.pdf');
  assert.equal(P.fromOfViewer(P.viewerUrl('https://x.org/a.pdf')), 'https://x.org/a.pdf');
  assert.equal(P.fromOfViewer('https://papol.io/viewer/?pdf=abc'), null);
});

test('what opens in Papol, and what is left alone', () => {
  const go = (address, extra = {}) => P.shouldOpenInPapol({ address, settings: { enabled: true }, ...extra });
  assert.equal(go('https://example.org/a.pdf'), true);
  assert.equal(go('https://example.org/download?id=7'), false);
  assert.equal(go('https://example.org/download?id=7', { isPdf: true }), true);
  // Switched off in the toolbar.
  assert.equal(P.shouldOpenInPapol({ address: 'https://example.org/a.pdf', settings: { enabled: false } }), false);
  // Papol's own PDFs (a paper's download) are never sent back to Papol.
  assert.equal(go('https://papol.io/uploads/abc.pdf', { isPdf: true }), false);
  assert.equal(go('http://127.0.0.1:5173/uploads/abc.pdf', { isPdf: true }), false);
  // The PDF this tab just showed in Papol is let through: "Original", or Back.
  assert.equal(go('https://example.org/a.pdf', { passThrough: 'https://example.org/a.pdf' }), false);
  assert.equal(go('https://example.org/a.pdf#page=2', { passThrough: 'https://example.org/a.pdf' }), false);
  assert.equal(go('https://example.org/b.pdf', { passThrough: 'https://example.org/a.pdf' }), true);
  assert.equal(go('data:application/pdf;base64,JVBERi0=', { isPdf: true }), false);
});

test('the viewer may fetch only what the extension sent it, lately', () => {
  const now = 1_000_000_000;
  const handoffs = { 'https://example.org/a.pdf': now - 1000, 'https://example.org/old.pdf': now - P.HANDOFF_TTL_MS - 1 };
  assert.equal(P.mayFetch('https://example.org/a.pdf', handoffs, now), true);
  assert.equal(P.mayFetch('https://example.org/a.pdf#page=4', handoffs, now), true);
  assert.equal(P.mayFetch('https://example.org/old.pdf', handoffs, now), false);
  assert.equal(P.mayFetch('https://intranet.example/secret', handoffs, now), false);
  assert.deepEqual(Object.keys(P.freshHandoffs(handoffs, now)), ['https://example.org/a.pdf']);
});

test('a PDF is bytes that say so', () => {
  assert.equal(P.isPdfBytes(new TextEncoder().encode('%PDF-1.7\n')), true);
  assert.equal(P.isPdfBytes(new TextEncoder().encode('<html>')), false);
});
