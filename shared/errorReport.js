import { BACKEND_BASE } from './appUrls.js';

export function diagnosticText(value) {
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
    `Automatic Papol ${environment.runtime === 'web' ? 'web' : 'macOS'} error report`,
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
