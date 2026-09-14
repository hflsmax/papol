import { BACKEND_BASE } from '../../shared/appUrls.js';

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

function diagnosticText(value) {
  return String(value || 'Unknown error')
    .replace(/\/Users\/[^/\s]+/g, '/Users/<redacted>')
    .replace(/(authorization:\s*bearer\s+)\S+/ig, '$1<redacted>')
    .slice(0, 2400);
}

export function unexpectedDesktopErrorReport(error, area, environment = {}) {
  const message = diagnosticText(error?.message || error);
  const stack = typeof error?.stack === 'string'
    ? diagnosticText(error.stack.split('\n').slice(0, 8).join('\n'))
    : null;
  const lines = [
    'Automatic Papol Desktop error report',
    '',
    `Area: ${area || 'application runtime'}`,
    `Error type: ${error?.name || typeof error}`,
    `Error: ${message}`,
    `Backend: ${environment.backend || BACKEND_BASE || 'not configured'}`,
    `Surface: ${environment.surface || 'main'}`,
    `Platform: ${environment.platform || 'unknown'}`,
    ...(stack ? ['', 'Stack:', stack] : []),
  ];
  return {
    signature: `${area}:${error?.name || typeof error}:${message}`,
    content: lines.join('\n').slice(0, 2000),
  };
}
