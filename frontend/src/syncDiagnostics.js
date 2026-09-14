import { BACKEND_BASE } from '../../shared/appUrls.js';
import { diagnosticText } from '../../shared/errorReport.js';
export { unexpectedDesktopErrorReport } from '../../shared/errorReport.js';

// A blocked outbox record is one the coordinator has classified as permanent:
// retrying cannot fix it. Keep reports deliberately narrow. In particular, do
// not include account IDs, mutation bodies, filenames, document text, or the
// bearer credential.
export function unrecoverableSyncReport(status, environment = {}) {
  const blocked = Number(status?.blocked) || 0;
  const error = typeof status?.outbox_error === 'string' ? diagnosticText(status.outbox_error.trim()) : '';
  if (blocked < 1 || !error) return null;

  const lines = [
    'Automatic Papol Desktop error report',
    '',
    `Error: ${error}`,
    `Blocked changes: ${blocked}`,
    `Pending changes: ${Number(status?.pending) || 0}`,
    `Conflicts: ${Number(status?.conflicts) || 0}`,
    `Last successful sync: ${status?.last_synced_at || 'never'}`,
    `Backend: ${environment.backend || BACKEND_BASE || 'not configured'}`,
    `Surface: ${environment.surface || 'main'}`,
    `Platform: ${environment.platform || 'unknown'}`,
  ];

  return {
    // Used only to avoid reopening the prompt for the same blocked condition.
    signature: `${blocked}:${error}`,
    content: lines.join('\n').slice(0, 2000),
  };
}
