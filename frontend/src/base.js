// Vite supplies / in development and /papol/ in the production deployment.
// Keep browser URLs and API requests inside that mount without teaching the
// application routes themselves about where Papol happens to be hosted.
const configuredBase = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');

// The standalone board's asset base (/boards/ in development, relative in a
// build) is not the API mount. Derive Papol's actual prefix from its URL so
// /boards/<guid> calls /api, while /papol/boards/<guid> calls /papol/api.
const pathname = window.location.pathname;
const boardMarker = pathname.includes('/demo/boards/') ? '/demo/boards/' : '/boards/';
const boardAt = pathname.indexOf(boardMarker);
export const APP_BASE = boardAt >= 0
  ? pathname.slice(0, boardAt)
  : configuredBase;

export function appPath(path = '/') {
  const absolute = path.startsWith('/') ? path : `/${path}`;
  return `${APP_BASE}${absolute}` || '/';
}

export function stripAppBase(pathname) {
  if (!APP_BASE) return pathname || '/';
  if (pathname === APP_BASE) return '/';
  return pathname.startsWith(`${APP_BASE}/`)
    ? pathname.slice(APP_BASE.length)
    : pathname;
}
