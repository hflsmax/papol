// One runtime contract for every Papol UI. Tauri injects this object before
// application modules execute; hosted pages derive the equivalent web value.
// This describes behavior only. Tauri capabilities remain the security
// boundary for native functionality.
function webSurface() {
  if (typeof window === 'undefined') return 'main';
  if (/\/(?:demo\/)?viewer(?:\/|$)/.test(window.location.pathname)) return 'viewer';
  if (/\/(?:demo\/)?boards(?:\/|$)/.test(window.location.pathname)) return 'board';
  return 'main';
}

const fallback = {
  runtime: 'web',
  surface: webSurface(),
  documentWindow: false,
};

const injected = typeof window !== 'undefined' ? window.__PAPOL_ENV__ : null;

export const APP_ENV = Object.freeze({
  ...fallback,
  ...(injected && typeof injected === 'object' ? injected : {}),
});

export const IS_DESKTOP = APP_ENV.runtime === 'desktop';
export const UI_SURFACE = APP_ENV.surface;
