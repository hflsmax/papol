// Who was last signed in on this browser, so a returning member's nook
// can be asked for while the sign-in is still being checked. Only the
// member's id is kept, and only until they sign out.
const KEY = 'papol.lastMember';

export function lastMember() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export function rememberLastMember(uuid) {
  try { localStorage.setItem(KEY, uuid); } catch { /* storage may be off */ }
}

export function forgetLastMember() {
  try { localStorage.removeItem(KEY); } catch { /* storage may be off */ }
}
