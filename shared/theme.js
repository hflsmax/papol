// Light or dark. A member chooses on each device (Preferences, Appearance):
// "system" follows the device's own setting, "light" and "dark" hold one.
// The choice is kept in this origin's localStorage, so the library, the
// viewer and the board, which share an origin, all wear it, and a change in
// one tab reaches the others. The tokens for each theme are in
// designTokens.js; this only sets data-theme on <html> when the choice is
// not "system". Each app's index.html sets it before the first paint, too,
// so a dark page never flashes light.
export const THEME_KEY = 'papol_theme';
export const THEMES = ['system', 'light', 'dark'];

const storage = () => {
  try { return globalThis.localStorage ?? null; } catch { return null; }
};

export function readTheme() {
  try {
    const kept = storage()?.getItem(THEME_KEY);
    return THEMES.includes(kept) ? kept : 'system';
  } catch { return 'system'; }
}

export function applyTheme(choice = readTheme()) {
  const root = globalThis.document?.documentElement;
  if (!root) return;
  if (choice === 'light' || choice === 'dark') root.dataset.theme = choice;
  else delete root.dataset.theme;
}

export function chooseTheme(choice) {
  const next = THEMES.includes(choice) ? choice : 'system';
  try {
    if (next === 'system') storage()?.removeItem(THEME_KEY);
    else storage()?.setItem(THEME_KEY, next);
  } catch { /* this tab still wears it */ }
  applyTheme(next);
  return next;
}

// Dark pages: the paper itself drawn light on dark, for reading at night.
// Apart from the theme, because a paper is printed black on white and most
// are best left so: off until a member turns it on, in the viewer's bar or
// in Preferences, and kept on this device as the theme is. It sets
// data-pdf-pages="dark" on <html>; the viewer's styles do the drawing.
export const PAGES_KEY = 'papol_pdf_pages';
const pagesListeners = new Set();

export function readDarkPages() {
  try { return storage()?.getItem(PAGES_KEY) === 'dark'; } catch { return false; }
}

export function applyDarkPages(dark = readDarkPages()) {
  const root = globalThis.document?.documentElement;
  if (root) {
    if (dark) root.dataset.pdfPages = 'dark';
    else delete root.dataset.pdfPages;
  }
  for (const listener of [...pagesListeners]) listener();
}

export function chooseDarkPages(dark) {
  const next = Boolean(dark);
  try {
    if (next) storage()?.setItem(PAGES_KEY, 'dark');
    else storage()?.removeItem(PAGES_KEY);
  } catch { /* this tab still wears it */ }
  applyDarkPages(next);
  return next;
}

// What is on show now, and a way to hear of a change (useSyncExternalStore).
export const darkPagesShown = () => globalThis.document?.documentElement?.dataset.pdfPages === 'dark';
export function subscribeDarkPages(listener) {
  pagesListeners.add(listener);
  return () => { pagesListeners.delete(listener); };
}

// Wear the kept choices, and follow a choice made in another tab.
export function followTheme() {
  applyTheme();
  applyDarkPages();
  const onStorage = (event) => {
    if (event.key === THEME_KEY || event.key === null) applyTheme();
    if (event.key === PAGES_KEY || event.key === null) applyDarkPages();
  };
  globalThis.addEventListener?.('storage', onStorage);
  return () => globalThis.removeEventListener?.('storage', onStorage);
}
