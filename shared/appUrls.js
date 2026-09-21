// A configured backend is a directory URL, never a filename. Keeping the
// trailing slash means URL resolution preserves a mounted deployment such as
// https://papol.io/ instead of silently falling back to the origin.
export function normalizeBackendBase(value) {
  const source = String(value || '').trim();
  return source ? `${source.replace(/\/+$/, '')}/` : '';
}

export function backendUrl(base, path = '/') {
  const normalized = normalizeBackendBase(base);
  if (!normalized) return null;
  return new URL(String(path).replace(/^\/+/, ''), normalized).toString();
}

// All three web surfaces can be hosted at /, under a deployment prefix, or
// inside the desktop bundle. Derive the application root without making one
// surface import another surface's bootstrap module.
const viteEnvironment = import.meta.env || {};
const configuredBase = (viteEnvironment.BASE_URL || '/').replace(/\/$/, '');
const pathname = typeof window === 'undefined' ? '/' : window.location.pathname;
const surfaceMarkers = ['/viewer', '/boards'];
const marker = surfaceMarkers.find((candidate) => pathname.includes(candidate));
const markerAt = marker ? pathname.indexOf(marker) : -1;

export const APP_BASE = markerAt >= 0 ? pathname.slice(0, markerAt) : configuredBase;

export function appPath(path = '/') {
  const absolute = path.startsWith('/') ? path : `/${path}`;
  return `${APP_BASE}${absolute}` || '/';
}

const configuredBackend = normalizeBackendBase(viteEnvironment.VITE_PAPOL_BACKEND);
export const BACKEND_BASE = configuredBackend || APP_BASE;

export function backendPath(path = '/') {
  const absolute = path.startsWith('/') ? path : `/${path}`;
  return configuredBackend ? backendUrl(configuredBackend, absolute) : appPath(absolute);
}

// Where the home button leads, from a board as from a document: Papol
// itself. It names nothing it is leaving behind — no board, no nook, no
// paper — because a home button that points back at the thing you just
// closed is a back button wearing a house.
export function homePath() {
  return appPath('/');
}

// A board's **jacket** — its one screen in the Library, where its name, its
// description and the way in are kept. Singular, as a paper's is: the plural
// `/boards/<uuid>` is the canvas, which is a different application.
export function boardJacketPath(uuid) {
  return appPath(`/board/${uuid}`);
}

export function stripAppBase(value) {
  if (!APP_BASE) return value || '/';
  if (value === APP_BASE) return '/';
  return value.startsWith(`${APP_BASE}/`) ? value.slice(APP_BASE.length) : value;
}
