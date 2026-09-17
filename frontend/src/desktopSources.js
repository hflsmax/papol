import { newestFirst, seminarRank } from './paperFormat.js';
import { paperName } from '../../shared/paperName.js';

// What Papol macOS's paper browser is showing, how that is written in a URL,
// and which papers it lists. Kept free of React and the page so it can be
// tested on its own (DESIGN.md, "Desktop shell").

// What a paper row carries while it is dragged towards a shelf.
export const PAPER_DRAG_TYPE = 'application/x-papol-paper';

const SOURCE_KEY = 'papol.desktopSource';

// Sources: 'all', 'shelf:<uuid>', 'tag:<uuid>', 'boards' (the user's nook) and
// 'library' (every public paper).
export function sourcePath(source) {
  if (source === 'library') return '/library';
  if (source === 'all') return '/';
  return `/?source=${source}`;
}

// An import reviewed from the public library belongs to the user's nook once
// it is created. Select that nook source while opening the new paper itself.
export function paperCreatedNavigation(source, paperSha256) {
  return {
    source: source === 'library' ? 'all' : source,
    path: `/paper/${paperName(paperSha256)}`,
  };
}

// search is the page's query string. A paper's own URL does not say which
// list it was picked from, so for a paper the list last shown stands in.
export function resolveSource(route, user, { search = '', lastShown = null } = {}) {
  if (route.page === 'papers') return 'library';
  if (route.page === 'space' && route.section === 'boards') return 'boards';
  if (route.page === 'paper' && user) return lastShown || 'all';
  return new URLSearchParams(search).get('source') || 'all';
}

// The list last shown lasts for the window's session.
export function rememberSource(source) {
  try { sessionStorage.setItem(SOURCE_KEY, source); }
  catch { /* session storage may be disabled */ }
}

export function lastShownSource() {
  try { return sessionStorage.getItem(SOURCE_KEY); }
  catch { return null; }
}

// The pages the browser stands in for. A signed-out user has no nook and
// cannot list the library, so a paper sent to them opens as a plain page.
export function isBrowsing(route, user) {
  if (!user) return false;
  return route.page === 'papers' || route.page === 'paper' || route.page === 'home'
    || (route.page === 'space' && route.uuid === user.uuid);
}

// The shelf or tag a source names, if the nook still has it.
export function shelfOf(source, space) {
  return (space?.shelves || []).find((shelf) => `shelf:${shelf.uuid}` === source) || null;
}

export function tagOf(source, space) {
  return (space?.tags || []).find((tag) => `tag:${tag.uuid}` === source) || null;
}

// The papers a source lists, in its order: the nook newest first, the library
// with live seminars on top. A shelf or tag the nook no longer has lists the
// whole nook rather than nothing.
export function papersInSource(source, { space, library }) {
  if (source === 'boards') return [];
  if (source === 'library') {
    return [...(library || [])].sort((a, b) => seminarRank(a) - seminarRank(b) || newestFirst(a, b));
  }
  const shelf = shelfOf(source, space);
  const tag = tagOf(source, space);
  return (space?.papers || [])
    .filter((paper) => (!shelf || paper.shelf_uuid === shelf.uuid)
      && (!tag || (paper.tags || []).some((item) => item.uuid === tag.uuid)))
    .sort(newestFirst);
}

// Whether any of the fields contains the typed search, ignoring case.
export function matchesSearch(query, fields) {
  const wanted = query.trim().toLowerCase();
  return !wanted || fields.some((field) => (field || '').toLowerCase().includes(wanted));
}
