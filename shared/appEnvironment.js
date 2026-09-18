// One runtime contract for every Papol UI. Tauri injects this object before
// application modules execute; hosted pages derive the equivalent web value.
// This describes behavior only. Tauri capabilities remain the security
// boundary for native functionality.
function webSurface() {
  if (typeof window === 'undefined') return 'desk';
  if (/\/(?:demo\/)?viewer(?:\/|$)/.test(window.location.pathname)) return 'viewer';
  if (/\/(?:demo\/)?boards(?:\/|$)/.test(window.location.pathname)) return 'board';
  return 'desk';
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
// What this Papol calls itself when it signs in. The installed application
// ships for macOS; everything else reaches the server as a page.
export const CLIENT_PLATFORM = IS_DESKTOP ? 'macos' : 'web';
export const UI_SURFACE = APP_ENV.surface;
