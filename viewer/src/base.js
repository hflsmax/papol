const pathname = window.location.pathname;
const marker = pathname.includes('/demo/viewer') ? '/demo/viewer' : '/viewer';
const markerAt = pathname.indexOf(marker);

export const APP_BASE = markerAt > 0 ? pathname.slice(0, markerAt) : '';
export const appPath = (path) => `${APP_BASE}${path.startsWith('/') ? path : `/${path}`}`;
