import { newestFirst } from './paperFormat.js';
import { paperName } from '../../shared/paperName.js';

// What Papol macOS's paper browser is showing, how that is written in a URL,
// and which papers it lists. Kept free of React and the page so it can be
// tested on its own (DESIGN.md, "Desktop shell").

// What a paper row carries while it is dragged towards a shelf.
export const PAPER_DRAG_TYPE = 'application/x-papol-paper';

const LISTING_KEY = 'papol.desktopListing';

// Sources: 'all', 'shelf:<uuid>', 'tag:<uuid>' and 'boards', all of them
// the user's own nook.
export function listingPath(listing) {
  if (listing === 'all') return '/';
  return `/?listing=${listing}`;
}

// search is the page's query string. A paper's own URL does not say which
// list it was picked from, so for a paper the list last shown stands in.
export function resolveListing(route, user, { search = '', lastShown = null } = {}) {
  if (route.page === 'nook' && route.section === 'boards') return 'boards';
  if (route.page === 'paper' && user) return lastShown || 'all';
  return new URLSearchParams(search).get('listing') || 'all';
}

// The list last shown lasts for the window's session.
export function rememberListing(listing) {
  try { sessionStorage.setItem(LISTING_KEY, listing); }
  catch { /* session storage may be disabled */ }
}

export function lastShownListing() {
  try { return sessionStorage.getItem(LISTING_KEY); }
  catch { return null; }
}

// The pages the browser stands in for. A signed-out user has no nook, so a
// paper sent to them opens as a plain page.
export function isBrowsing(route, user) {
  if (!user) return false;
  return route.page === 'paper' || route.page === 'home'
    || (route.page === 'nook' && route.uuid === user.uuid);
}

// The shelf or tag a listing names, if the nook still has it.
export function shelfOf(listing, nook) {
  return (nook?.shelves || []).find((shelf) => `shelf:${shelf.uuid}` === listing) || null;
}

export function tagOf(listing, nook) {
  return (nook?.tags || []).find((tag) => `tag:${tag.uuid}` === listing) || null;
}

// The papers a listing lists, newest first. A shelf or tag the nook no longer has lists the
// whole nook rather than nothing.
export function papersInListing(listing, { nook }) {
  if (listing === 'boards') return [];
  const shelf = shelfOf(listing, nook);
  const tag = tagOf(listing, nook);
  return (nook?.papers || [])
    .filter((paper) => (!shelf || paper.shelf_uuid === shelf.uuid)
      && (!tag || paper.tags.some((item) => item.uuid === tag.uuid)))
    .sort(newestFirst);
}

// Whether any of the fields contains the typed search, ignoring case.
export function matchesSearch(query, fields) {
  const wanted = query.trim().toLowerCase();
  return !wanted || fields.some((field) => (field || '').toLowerCase().includes(wanted));
}
