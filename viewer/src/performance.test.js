import assert from 'node:assert/strict';
import test from 'node:test';
import { markViewerPerformance, viewerOpeningTimings } from './performance.js';

test('reports the local PDF opening path from navigation through first paint', () => {
  performance.clearMarks();
  const times = {
    bootstrap: 12,
    'shell-committed': 18,
    'pdf-bytes-requested': 20,
    'pdf-bytes-ready': 44,
    'document-loaded': 71,
    'layout-ready': 76,
    'first-page-render-requested': 80,
    'first-page-render-started': 83,
    'first-page-canvas-started': 87,
    'first-page-painted': 95,
  };
  for (const [name, startTime] of Object.entries(times)) {
    performance.mark(`papol-viewer:${name}`, { startTime });
  }

  const timings = viewerOpeningTimings({
    openedAtMs: performance.timeOrigin - 30,
    nativeReadMs: 8.2,
    nativeHashMs: 3.1,
  });
  const byPhase = Object.fromEntries(timings.map((timing) => [timing.phase, timing.duration_ms]));

  assert.equal(byPhase.navigation_to_bootstrap, 12);
  assert.equal(byPhase.pdf_bytes, 24);
  assert.equal(byPhase.pdf_parse, 27);
  assert.equal(byPhase.first_page_queue, 3);
  assert.equal(byPhase.first_page_canvas, 8);
  assert.equal(byPhase.navigation_to_first_page, 95);
  assert.equal(byPhase.native_initial_read, 8.2);
  assert.equal(byPhase.native_initial_hash, 3.1);
  assert.equal(byPhase.native_before_navigation, 30);
  assert.equal(byPhase.open_to_first_page, 125);
});

test('performance marks are written only once', () => {
  performance.clearMarks();
  markViewerPerformance('bootstrap');
  markViewerPerformance('bootstrap');
  assert.equal(performance.getEntriesByName('papol-viewer:bootstrap', 'mark').length, 1);
});
