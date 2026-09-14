import { backendUrl, normalizeBackendBase } from '../../shared/backendUrl.js';

const pathname = window.location.pathname;
const marker = pathname.includes('/demo/viewer') ? '/demo/viewer' : '/viewer';
const markerAt = pathname.indexOf(marker);

export const APP_BASE = markerAt > 0 ? pathname.slice(0, markerAt) : '';
export const appPath = (path) => `${APP_BASE}${path.startsWith('/') ? path : `/${path}`}`;

const environment = import.meta.env || {};
const configuredBackend = normalizeBackendBase(environment.VITE_PAPOL_BACKEND);
export const backendPath = (path) => {
  const absolute = path.startsWith('/') ? path : `/${path}`;
  return configuredBackend ? backendUrl(configuredBackend, absolute) : appPath(absolute);
};
