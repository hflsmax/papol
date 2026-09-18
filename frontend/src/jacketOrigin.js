import { parseRoute } from './routes.js';

/**
 * Where a jacket was opened from, so its Back can lead there.
 *
 * A work is kept in two kinds of place — a nook, or the library — and Back
 * on its jacket means "return me to the one I found this in". The
 * browser's own history cannot be asked: the usual way onto a paper page is
 * back from the viewer, which is a separate application and a fresh
 * document load, so the entry arrives with no state and nothing behind it
 * that this app put there. That is how the page came to have no Back at all
 * exactly when it was most wanted.
 *
 * So the place is remembered for the tab, in sessionStorage, which outlives
 * both a reload and the trip through the viewer. Paths here are the app's
 * own — no base, no /demo — because `navigate` adds both.
 *
 * One memory serves both jackets. A reader is in one work at a time, and
 * where they were before it does not depend on whether the work turned out
 * to be a paper or a board.
 */

const KEY = 'papol.jacketOrigin';

/** The nook or library a path shows, or null if it shows neither. */
export function placeOf(pathname) {
  const route = parseRoute(pathname);
  // Home is the signed-in user's own nook, under its shortest name.
  if (route.page === 'home') return '/';
  if (route.page === 'nook') return `/u/${route.uuid}`;
  if (route.page === 'papers') return '/library';
  return null;
}

/** Whether a route is a work's jacket, of either kind. */
const isJacket = (route) => route.page === 'paper' || route.page === 'board';

/**
 * The origin to remember after moving from one path to another.
 *
 * Only a move *onto* a jacket changes it. From a nook or the library, that
 * place becomes the origin. From another jacket — a reference followed, a
 * related paper opened, a board opened from a paper — the trail keeps the
 * place it started from. From anywhere else (a seminar, the inbox) there is
 * no such place, and a stale one would be a wrong answer given confidently,
 * so it is forgotten and the default below applies.
 */
export function originAfterMove(origin, fromPathname, toPathname) {
  if (!isJacket(parseRoute(toPathname))) return origin;
  if (isJacket(parseRoute(fromPathname))) return origin;
  return placeOf(fromPathname);
}

/**
 * Where Back leads, and what to call it. With no remembered origin — a link
 * someone was sent, a bookmark — a signed-in user goes to their own nook,
 * which is home, and a visitor to the library, which is the only place a
 * visitor can find papers at all.
 */
export function jacketBackTarget({ origin = null, userUuid = null } = {}) {
  const path = origin || (userUuid ? '/' : '/library');
  if (path === '/library') return { path, label: 'Library' };
  const mine = path === '/' || (userUuid && path === `/u/${userUuid}`);
  return { path, label: mine ? 'My nook' : 'Nook' };
}

export function readJacketOrigin() {
  try {
    const stored = window.sessionStorage.getItem(KEY);
    // Only ever a place this module would have written.
    return stored && placeOf(stored) === stored ? stored : null;
  } catch {
    return null;
  }
}

export function writeJacketOrigin(origin) {
  try {
    if (origin) window.sessionStorage.setItem(KEY, origin);
    else window.sessionStorage.removeItem(KEY);
  } catch {
    // A tab that cannot remember still has the default to fall back on.
  }
}
