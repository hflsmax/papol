import { APP_ENV, IS_DESKTOP } from './appEnvironment.js';

// Papol Desktop loads bundled pages inside a Tauri window. Tauri injects the
// shared runtime environment before these modules execute. For working on
// the desktop layout in an ordinary browser, `?shell=desktop` opts the tab in
// (for the rest of the tab's session, across the viewer and boards) and
// `?shell=web` opts it back out.

const STORAGE_KEY = 'papol.shell';

function readOverride() {
  try {
    const requested = new URLSearchParams(window.location.search).get('shell');
    if (requested === 'desktop') window.sessionStorage.setItem(STORAGE_KEY, 'desktop');
    if (requested === 'web') window.sessionStorage.removeItem(STORAGE_KEY);
    return window.sessionStorage.getItem(STORAGE_KEY) === 'desktop';
  } catch {
    return false;
  }
}

export const DESKTOP = IS_DESKTOP || readOverride();

// On macOS the window's title bar is transparent and overlays the page, so
// the traffic lights sit on top of whatever is in the page's top-left corner.
export const MAC = /Mac/.test(navigator.platform || navigator.userAgent);
export const DOCUMENT_WINDOW = IS_DESKTOP && APP_ENV.documentWindow;

export function openDesktopDocumentWindow(href, features = '') {
  const absoluteUrl = new URL(href, window.location.href).href;
  if (DESKTOP && typeof window.__PAPOL_OPEN_DOCUMENT_WINDOW__ === 'function') {
    window.__PAPOL_OPEN_DOCUMENT_WINDOW__(absoluteUrl);
    return true;
  }
  window.open(href, '_blank', features);
  return true;
}

export function closeDesktopDocumentWindow() {
  if (!DOCUMENT_WINDOW) return false;
  if (typeof window.__PAPOL_CLOSE_DOCUMENT_WINDOW__ === 'function') {
    window.__PAPOL_CLOSE_DOCUMENT_WINDOW__();
  } else {
    window.close();
  }
  return true;
}

export function focusDesktopLibraryWindow(paperUuid) {
  if (!DESKTOP || typeof window.__PAPOL_FOCUS_LIBRARY_WINDOW__ !== 'function') return false;
  // This function is also used directly as a click handler by generic
  // Library buttons, so only an explicit UUID string is a selection request.
  window.__PAPOL_FOCUS_LIBRARY_WINDOW__(typeof paperUuid === 'string' ? paperUuid : undefined);
  return true;
}

if (DESKTOP) {
  document.documentElement.dataset.shell = 'desktop';
  if (MAC) document.documentElement.dataset.platform = 'mac';
}
