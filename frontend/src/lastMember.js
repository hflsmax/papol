// What this browser keeps of the member last signed in here, so that when
// they come back the app opens as they left it while it checks with the
// server: who they are, and their nook as last seen. Both go at sign-out,
// or as soon as the server no longer knows the sign-in.
const MEMBER = 'papol.lastMember';
const NOOK = 'papol.lastNook';

const read = (key) => {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
};
const write = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { try { localStorage.removeItem(key); } catch { /* storage may be off */ } }
};

export function lastMember() {
  const member = read(MEMBER);
  return member && typeof member.uuid === 'string' ? member : null;
}

export function rememberLastMember(user) {
  write(MEMBER, user);
}

export function savedNook(userUuid) {
  const saved = read(NOOK);
  return saved && saved.uuid === userUuid ? saved.nook : null;
}

export function saveNook(nook) {
  write(NOOK, { uuid: nook.user.uuid, nook });
}

export function forgetLastMember() {
  try {
    localStorage.removeItem(MEMBER);
    localStorage.removeItem(NOOK);
  } catch { /* storage may be off */ }
}
