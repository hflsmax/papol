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

// Where the library shows one thing. A board has no page of its own — its
// place in Papol is the row in a nook — so the way back to a board names it
// and the library reveals it there.
export function libraryPath(path, focus = {}) {
  const params = new URLSearchParams();
  if (focus.board) params.set('board', focus.board);
  const query = params.toString();
  if (!query) return path;
  return `${path}${path.includes('?') ? '&' : '?'}${query}`;
}

// Where leaving a board lands: the nook that holds it, showing the board.
// Which nook is the board's own business — a reader's own, or its owner's
// when the board is someone else's, since that is the only list it appears
// in. A board just deleted names nothing, and the library is simply itself.
export function boardHomePath(board, { demo = false } = {}) {
  const home = appPath(demo ? '/demo' : '/');
  if (!board) return home;
  const nook = board.can_edit ? home : appPath(`/u/${board.user_uuid}`);
  return libraryPath(nook, { board: board.uuid });
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
