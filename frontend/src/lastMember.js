import { DESKTOP } from '../../shared/desktopShell';

// What this browser keeps of the member last signed in here, so that when
// they come back the app opens as they left it while it checks with the
// server: who they are, and the pages they last opened as last seen. All
// of it goes at sign-out, or as soon as the server no longer knows the
// sign-in.
const MEMBER = 'papol.lastMember';
const PAGES = 'papol.lastPages';
// The most recently opened pages kept in the browser; older ones drop off.
const KEPT_PAGES = 30;

const read = (key) => {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
};
const write = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
};
const remove = (key) => {
  try { localStorage.removeItem(key); } catch { /* storage may be off */ }
};

export function lastMember() {
  const member = read(MEMBER);
  return member && typeof member.uuid === 'string' ? member : null;
}

export function rememberLastMember(user) {
  write(MEMBER, user);
}

// Pages seen in this tab, by what they show ("project:<uuid>", …). On the
// web the member's are kept in the browser too; the Mac app keeps its own.
const seen = new Map();

function storedPages() {
  const member = lastMember();
  const saved = read(PAGES);
  return member && saved?.uuid === member.uuid && Array.isArray(saved.pages) ? saved.pages : [];
}

// A page as last seen, to show at once while it is asked for again.
export function kept(key) {
  if (seen.has(key)) return seen.get(key);
  if (DESKTOP) return null;
  const found = storedPages().find(([k]) => k === key);
  return found ? found[1] : null;
}

export function keep(key, value) {
  seen.set(key, value);
  const member = lastMember();
  if (DESKTOP || !member) return;
  let pages = [[key, value], ...storedPages().filter(([k]) => k !== key)].slice(0, KEPT_PAGES);
  // When the browser has no room, the oldest pages give way.
  while (!write(PAGES, { uuid: member.uuid, pages }) && pages.length > 1) pages = pages.slice(0, -1);
}

export function forgetLastMember() {
  seen.clear();
  remove(MEMBER);
  remove(PAGES);
}
