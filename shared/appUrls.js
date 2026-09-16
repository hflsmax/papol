import { backendUrl, normalizeBackendBase } from './backendUrl.js';

// All three web surfaces can be hosted at /, under a deployment prefix, or
// inside the desktop bundle. Derive the application root without making one
// surface import another surface's bootstrap module.
const viteEnvironment = import.meta.env || {};
const configuredBase = (viteEnvironment.BASE_URL || '/').replace(/\/$/, '');
const pathname = typeof window === 'undefined' ? '/' : window.location.pathname;
const surfaceMarkers = ['/demo/viewer', '/viewer', '/demo/boards', '/boards'];
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
export function homePath({ demo = false } = {}) {
  return appPath(demo ? '/demo' : '/');
}

export function stripAppBase(value) {
  if (!APP_BASE) return value || '/';
  if (value === APP_BASE) return '/';
  return value.startsWith(`${APP_BASE}/`) ? value.slice(APP_BASE.length) : value;
}

export function inDemo() {
  if (typeof window === 'undefined') return false;
  const path = stripAppBase(window.location.pathname);
  return path === '/demo' || path.startsWith('/demo/');
}
