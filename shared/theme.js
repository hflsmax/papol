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

// Wear the kept choice, and follow a choice made in another tab.
export function followTheme() {
  applyTheme();
  const onStorage = (event) => { if (event.key === THEME_KEY || event.key === null) applyTheme(); };
  globalThis.addEventListener?.('storage', onStorage);
  return () => globalThis.removeEventListener?.('storage', onStorage);
}
