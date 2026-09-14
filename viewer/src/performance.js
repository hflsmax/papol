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

function markTime(name) {
  return performance.getEntriesByName?.(entryName(name), 'mark')[0]?.startTime ?? null;
}

/** Durations that explain what was visible before the first PDF page arrived. */
export function viewerOpeningTimings(native = {}) {
  if (typeof performance === 'undefined') return [];
  const bootstrap = markTime('bootstrap');
  const shell = markTime('shell-committed');
  const requested = markTime('pdf-bytes-requested');
  const bytes = markTime('pdf-bytes-ready');
  const documentLoaded = markTime('document-loaded');
  const layout = markTime('layout-ready');
  const renderRequested = markTime('first-page-render-requested');
  const renderStarted = markTime('first-page-render-started');
  const canvasStarted = markTime('first-page-canvas-started');
  const painted = markTime('first-page-painted');
  const browserPaints = performance.getEntriesByType?.('paint') || [];
  const firstPaint = browserPaints.find((entry) => entry.name === 'first-paint')?.startTime ?? null;
  const firstContentfulPaint = browserPaints
    .find((entry) => entry.name === 'first-contentful-paint')?.startTime ?? null;
  const pairs = [
    ['navigation_to_first_paint', 0, firstPaint],
    ['navigation_to_first_contentful_paint', 0, firstContentfulPaint],
    ['navigation_to_bootstrap', 0, bootstrap],
    ['bootstrap_to_shell', bootstrap, shell],
    ['shell_to_pdf_request', shell, requested],
    ['pdf_bytes', requested, bytes],
    ['pdf_parse', bytes, documentLoaded],
    ['first_page_layout', documentLoaded, layout],
    ['layout_to_render_request', layout, renderRequested],
    ['first_page_queue', renderRequested, renderStarted],
    ['first_page_setup', renderStarted, canvasStarted],
    ['first_page_canvas', canvasStarted, painted],
    ['first_page_paint', layout, painted],
    ['navigation_to_first_page', 0, painted],
  ];
  const timings = pairs
    .filter(([, start, end]) => Number.isFinite(start) && Number.isFinite(end) && end >= start)
    .map(([phase, start, end]) => ({ phase, duration_ms: Math.round((end - start) * 10) / 10 }));
  if (Number.isFinite(native.nativeReadMs)) {
    timings.push({ phase: 'native_initial_read', duration_ms: native.nativeReadMs });
  }
  if (Number.isFinite(native.nativeHashMs)) {
    timings.push({ phase: 'native_initial_hash', duration_ms: native.nativeHashMs });
  }
  if (Number.isFinite(native.openedAtMs) && Number.isFinite(performance.timeOrigin)) {
    const beforeNavigation = performance.timeOrigin - native.openedAtMs;
    if (beforeNavigation >= 0) {
      timings.push({
        phase: 'native_before_navigation', duration_ms: Math.round(beforeNavigation * 10) / 10,
      });
    }
    if (Number.isFinite(painted)) {
      const total = performance.timeOrigin + painted - native.openedAtMs;
      if (total >= 0) {
        timings.push({ phase: 'open_to_first_page', duration_ms: Math.round(total * 10) / 10 });
      }
    }
  }
  return timings;
}

/** Run once when a named milestone is marked, including older WebKit. */
export function observeViewerPerformanceMark(name, callback) {
  const fullName = entryName(name);
  if (performance.getEntriesByName?.(fullName, 'mark').length) {
    queueMicrotask(callback);
    return () => {};
  }
  if (typeof PerformanceObserver !== 'function') return () => {};
  const observer = new PerformanceObserver((list) => {
    if (!list.getEntries().some((entry) => entry.name === fullName)) return;
    observer.disconnect();
    callback();
  });
  try {
    observer.observe({ type: 'mark', buffered: true });
  } catch {
    observer.observe({ entryTypes: ['mark'] });
  }
  return () => observer.disconnect();
}
