import test from 'node:test';
import assert from 'node:assert/strict';
import { isReportableUploadError } from '../../shared/uploadError.js';
import { unexpectedDesktopErrorReport } from '../../shared/errorReport.js';

test('upload refusals and connection failures can be corrected or retried', () => {
  for (const status of [400, 401, 403, 409, 413, 415, 422, 429, 501]) {
    assert.equal(isReportableUploadError({ status, message: 'Refused' }), false);
  }
  for (const message of ['Offline files may be at most 40 MB', 'Failed to fetch',
    'Load failed', 'Connection reset', 'No space left on device']) {
    assert.equal(isReportableUploadError(message), false, message);
  }
  assert.equal(isReportableUploadError({ reportable: false }), false);
});

test('unexpected native strings and server failures offer diagnostics', () => {
  for (const error of ['database disk image is malformed', 'Command blob_import not found',
    new TypeError('Cannot read properties of undefined'), { status: 500, message: 'PDF upload failed' }]) {
    assert.equal(isReportableUploadError(error), true);
  }
});

test('web upload reports identify the runtime correctly', () => {
  const report = unexpectedDesktopErrorReport(new Error('Upload failed'), 'importing a PDF', { runtime: 'web' });
  assert.match(report.content, /Papol web error report/);
  assert.match(report.content, /Area: importing a PDF/);
});
