// Papol Desktop loads the hosted pages inside a Tauri window. The pages stay
// the same code; this module only tells them they are inside that window so
// their chrome can look like a native app's instead of a website's.
//
// Tauri defines `window.isTauri` in every page of its webview. For working on
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

export const DESKTOP = Boolean(window.isTauri || window.__TAURI_INTERNALS__) || readOverride();

// On macOS the window's title bar is transparent and overlays the page, so
// the traffic lights sit on top of whatever is in the page's top-left corner.
export const MAC = /Mac/.test(navigator.platform || navigator.userAgent);

if (DESKTOP) {
  document.documentElement.dataset.shell = 'desktop';
  if (MAC) document.documentElement.dataset.platform = 'mac';
}
