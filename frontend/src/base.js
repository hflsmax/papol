import { backendUrl, normalizeBackendBase } from '../../shared/backendUrl.js';

// Vite supplies / in development and /papol/ in the production deployment.
// Keep browser URLs and API requests inside that mount without teaching the
// application routes themselves about where Papol happens to be hosted.
const viteEnvironment = import.meta.env || {};
const configuredBase = (viteEnvironment.BASE_URL || '/').replace(/\/$/, '');

// The standalone board's asset base (/boards/ in development, relative in a
// build) is not the API mount. Derive Papol's actual prefix from its URL so
// /boards/<uuid> calls /api, while /papol/boards/<uuid> calls /papol/api.
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

// Browser builds keep using Papol's own origin. The desktop build supplies a
// hosted backend here, while its pages and all of their runtime dependencies
// remain inside the application bundle.
const configuredBackend = normalizeBackendBase(viteEnvironment.VITE_PAPOL_BACKEND);
export const BACKEND_BASE = configuredBackend || APP_BASE;

export function backendPath(path = '/') {
  const absolute = path.startsWith('/') ? path : `/${path}`;
  return configuredBackend ? backendUrl(configuredBackend, absolute) : appPath(absolute);
}

export function stripAppBase(pathname) {
  if (!APP_BASE) return pathname || '/';
  if (pathname === APP_BASE) return '/';
  return pathname.startsWith(`${APP_BASE}/`)
    ? pathname.slice(APP_BASE.length)
    : pathname;
}

// The URL alone says whether this page is the demo.
export function inDemo() {
  const path = stripAppBase(window.location.pathname);
  return path === '/demo' || path.startsWith('/demo/');
}
