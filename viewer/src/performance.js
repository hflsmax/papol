const PREFIX = 'papol-viewer:';

function entryName(name) {
  return `${PREFIX}${name}`;
}

export function markViewerPerformance(name, detail) {
  if (typeof performance === 'undefined' || typeof performance.mark !== 'function') return;
  const fullName = entryName(name);
  if (performance.getEntriesByName?.(fullName, 'mark').length) return;
  try {
    performance.mark(fullName, detail === undefined ? undefined : { detail });
  } catch {
    // Older embedded WebKit versions support marks but not mark details.
    performance.mark(fullName);
  }
}

export function measureViewerPerformance(name, start, end) {
  if (typeof performance === 'undefined' || typeof performance.measure !== 'function') return;
  const fullName = entryName(name);
  if (performance.getEntriesByName?.(fullName, 'measure').length) return;
  const startName = entryName(start);
  const endName = entryName(end);
  if (!performance.getEntriesByName?.(startName, 'mark').length ||
      !performance.getEntriesByName?.(endName, 'mark').length) return;
  performance.measure(fullName, startName, endName);
}
