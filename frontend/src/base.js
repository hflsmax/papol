// Vite supplies / in development and /papol/ in the production deployment.
// Keep browser URLs and API requests inside that mount without teaching the
// application routes themselves about where Papol happens to be hosted.
export const APP_BASE = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');

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
