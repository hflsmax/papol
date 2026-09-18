import { diagnosticText, environmentLines } from '../../shared/errorReport.js';

// A blocked outbox record is one the coordinator has classified as permanent:
// retrying cannot fix it. Keep reports deliberately narrow. In particular, do
// not include account IDs, mutation bodies, filenames, document text, or the
// bearer credential.
export function unrecoverableSyncReport(status, environment = {}) {
  const error = status.outbox_error ? diagnosticText(status.outbox_error.trim()) : '';
  if (status.blocked < 1 || !error) return null;

  const lines = [
    'Automatic Papol macOS error report',
    '',
    `Error: ${error}`,
    `Blocked changes: ${status.blocked}`,
    `Pending changes: ${status.pending}`,
    `Conflicts: ${status.conflicts}`,
    `Last successful sync: ${status.last_synced_at || 'never'}`,
    ...environmentLines(environment),
  ];

  return {
    // Used only to avoid reopening the prompt for the same blocked condition.
    signature: `${status.blocked}:${error}`,
    content: lines.join('\n').slice(0, 2000),
  };
}
