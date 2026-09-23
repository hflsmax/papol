import { IS_DESKTOP } from './appEnvironment.js';

const TOKEN_KEY = 'papol_token';
let memoryToken = null;

function storage() {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

// papol.io and dev.papol.io are one service twice — dev holds a copy of
// production's data, sessions included — but two origins, so each has a
// localStorage of its own. A cookie for the whole domain is what carries a
// session from one to the other: the site you sign in on writes it, and a
// site with no session of its own takes the one it finds there. Each site
// still keeps its own copy, because the two can disagree about a token (dev
// knows only the sessions its last refresh brought across), and one site
// refusing a token must not sign the user out of the other. The native app
// and any other host have no such neighbour and never write the cookie.
const SHARED_DOMAIN = 'papol.io';
const YEAR_S = 365 * 24 * 60 * 60;

function sharedDomain() {
  if (IS_DESKTOP || typeof document === 'undefined') return null;
  const host = globalThis.location?.hostname || '';
  return host === SHARED_DOMAIN || host.endsWith(`.${SHARED_DOMAIN}`) ? SHARED_DOMAIN : null;
}

function sharedToken() {
  if (!sharedDomain()) return null;
  const found = document.cookie.split('; ').find((part) => part.startsWith(`${TOKEN_KEY}=`));
  return found ? decodeURIComponent(found.slice(TOKEN_KEY.length + 1)) || null : null;
}

function writeSharedToken(token) {
  const domain = sharedDomain();
  if (!domain) return;
  const value = token ? encodeURIComponent(token) : '';
  const age = token ? YEAR_S : 0;
  document.cookie = `${TOKEN_KEY}=${value}; Domain=${domain}; Path=/; Max-Age=${age}; Secure; SameSite=Strict`;
}

export function currentCredential() {
  return memoryToken;
}

export async function hydrateCredential() {
  const local = storage();
  memoryToken = local?.getItem(TOKEN_KEY) || null;
  if (!memoryToken) {
    memoryToken = sharedToken();
    if (memoryToken) local?.setItem(TOKEN_KEY, memoryToken);
  } else if (!sharedToken()) {
    // A session from before the cookie existed, offered to the other site.
    writeSharedToken(memoryToken);
  }
  return memoryToken;
}

export async function storeCredential(token) {
  const dropped = memoryToken;
  memoryToken = token || null;
  const local = storage();
  if (token) {
    local?.setItem(TOKEN_KEY, token);
    writeSharedToken(token);
  } else {
    local?.removeItem(TOKEN_KEY);
    // Only the token being let go of: a newer one the other site put
    // there is that site's session, not this one's.
    if (dropped && sharedToken() === dropped) writeSharedToken(null);
  }
}
