import test from 'node:test';
import assert from 'node:assert/strict';

const {
  unexpectedDesktopErrorReport, unrecoverableSyncReport,
} = await import('./syncDiagnostics.js');
const {
  diagnosticLogExcerpt, feedbackWithDiagnosticLog,
} = await import('../../shared/diagnosticLog.js');

test('only permanent blocked sync failures produce a diagnostic report', () => {
  assert.equal(unrecoverableSyncReport({ pending: 1, error: 'network unavailable' }), null);
  assert.equal(unrecoverableSyncReport({ blocked: 1, pending: 1 }), null);

  const report = unrecoverableSyncReport({
    blocked: 1,
    pending: 0,
    conflicts: 2,
    last_synced_at: '2026-09-14T07:03:27Z',
    outbox_error: 'Sync server returned 413 Payload Too Large',
  }, {
    backend: 'https://example.test/papol/',
    surface: 'main',
    platform: 'MacIntel',
  });

  assert.match(report.content, /413 Payload Too Large/);
  assert.match(report.content, /Blocked changes: 1/);
  assert.match(report.content, /Conflicts: 2/);
  assert.match(report.content, /Backend: https:\/\/example\.test\/papol\//);
  assert.doesNotMatch(report.content, /account|token|mutation|filename/i);
});

test('feedback includes only a bounded tail of recent structured events', () => {
  const excerpt = diagnosticLogExcerpt([
    { event: 'old', message: 'x'.repeat(80) },
    { event: 'new', status: 413 },
  ], 60);
  assert.doesNotMatch(excerpt, /old/);
  assert.match(excerpt, /new/);
  const content = feedbackWithDiagnosticLog('What happened', excerpt, 100);
  assert.match(content, /^What happened/);
  assert.match(content, /diagnostic events/);
  assert.ok(content.length <= 100);
});

test('unexpected runtime reports include a redacted bounded stack', () => {
  const error = new TypeError('failed under /Users/alice/Documents');
  error.stack = 'TypeError: failed\n    at /Users/alice/src/App.jsx:10\n    at second';
  const report = unexpectedDesktopErrorReport(error, 'local account startup', {
    platform: 'MacIntel',
  });

  assert.match(report.content, /Area: local account startup/);
  assert.match(report.content, /Error type: TypeError/);
  assert.match(report.content, /\/Users\/<redacted>\/src\/App\.jsx:10/);
  assert.doesNotMatch(report.content, /alice/);
});
