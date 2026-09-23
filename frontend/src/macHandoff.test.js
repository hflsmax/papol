import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BLUR_GRACE_MS, DETECTION_MS, RETIRED_KEY,
  attemptHandoff, deferDocument, documentIsDeferred, handoffAddress, handoffAddressAt,
  handoffCapableMac, handoffDocument, handoffIdentity, handoffOffer, writeFlag,
} from '../../shared/macHandoff.js';

const VIEWER = 'https://mc-pony.com/papol/viewer/?pdf=abc123';
const BOARD = 'https://mc-pony.com/papol/boards/b-42';

function store(initial = {}) {
  const held = new Map(Object.entries(initial));
  return {
    getItem: (key) => (held.has(key) ? held.get(key) : null),
    setItem: (key, value) => held.set(key, String(value)),
    removeItem: (key) => held.delete(key),
    held,
  };
}

// A store that refuses everything, the way Safari does in a locked-down
// private window.
function sealedStore() {
  return {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
    removeItem() { throw new Error('denied'); },
  };
}

test('a viewer showing a PDF is a paper to hand over', () => {
  assert.deepEqual(handoffDocument(VIEWER), { kind: 'paper', noun: 'this paper' });
});

test('a viewer showing a shared reading is a paper too', () => {
  const shared = 'https://mc-pony.com/papol/viewer/?share=11111111-1111-4111-8111-111111111111';
  assert.equal(handoffDocument(shared).kind, 'paper');
});

test('a viewer with no document names nothing', () => {
  assert.equal(handoffDocument('https://mc-pony.com/papol/viewer/'), null);
});

test('a board is a board, by path or by name', () => {
  assert.deepEqual(handoffDocument(BOARD), { kind: 'board', noun: 'this board' });
  assert.equal(handoffDocument('https://mc-pony.com/papol/boards/?board=b-42').kind, 'board');
});

test('the board app with no board is not a document', () => {
  assert.equal(handoffDocument('https://mc-pony.com/papol/boards/'), null);
  assert.equal(handoffDocument('https://mc-pony.com/papol/boards/index.html'), null);
});

test('the library is not a document window', () => {
  assert.equal(handoffDocument('https://mc-pony.com/papol/'), null);
  assert.equal(handoffDocument('https://mc-pony.com/papol/u/someone'), null);
});

test('an address that is not a web address is refused', () => {
  assert.equal(handoffDocument('papol://mc-pony.com/papol/viewer/?pdf=abc'), null);
  assert.equal(handoffDocument('file:///Users/someone/paper.pdf'), null);
  assert.equal(handoffDocument('not a url at all'), null);
  assert.equal(handoffDocument(''), null);
});

test('a development address is still a document', () => {
  assert.equal(handoffDocument('http://127.0.0.1:5173/viewer/?pdf=abc').kind, 'paper');
});

test('the handed-over address mirrors the one the user is at', () => {
  assert.equal(handoffAddress(VIEWER), 'papol://mc-pony.com/papol/viewer/?pdf=abc123');
});

test('a deployment prefix and a port are carried across whole', () => {
  assert.equal(
    handoffAddress('http://127.0.0.1:5173/viewer/?pdf=abc'),
    'papol://127.0.0.1:5173/viewer/?pdf=abc',
  );
});

test('the place in the document is carried, because arriving at page 1 is worse than not arriving', () => {
  const deep = `${VIEWER}&page=14&note=n-7&y=0.5&mark=m1&box=b2`;
  const address = handoffAddress(deep);
  assert.match(address, /pdf=abc123/);
  for (const part of ['page=14', 'note=n-7', 'y=0.5', 'mark=m1', 'box=b2']) {
    assert.match(address, new RegExp(part.replace('.', '\\.')));
  }
});

test('anything not naming the document or the place is dropped', () => {
  const address = handoffAddress(`${VIEWER}&token=secret&next=%2Fadmin&redirect=evil`);
  assert.equal(address, 'papol://mc-pony.com/papol/viewer/?pdf=abc123');
});

test('a document with no carried keys keeps no empty question mark', () => {
  assert.equal(handoffAddress(BOARD), 'papol://mc-pony.com/papol/boards/b-42');
});

test('nothing to hand over means no address', () => {
  assert.equal(handoffAddress('https://mc-pony.com/papol/'), null);
});

test('a document is identified so that Not now forgets one paper, not every paper', () => {
  assert.equal(handoffIdentity(VIEWER), 'pdf:abc123');
  assert.equal(handoffIdentity(BOARD), 'board:b-42');
  assert.equal(handoffIdentity('https://mc-pony.com/papol/boards/?board=b-9'), 'board:b-9');
  assert.equal(handoffIdentity('https://mc-pony.com/papol/viewer/?share=s-1'), 'pdf:s-1');
});

test('a Mac browser reading a paper is offered the app', () => {
  const offer = handoffOffer({ href: VIEWER, mac: true, session: store(), local: store() });
  assert.equal(offer.kind, 'paper');
  assert.equal(offer.label, 'Open this paper in Papol');
  assert.equal(offer.address, 'papol://mc-pony.com/papol/viewer/?pdf=abc123');
  assert.equal(offer.identity, 'pdf:abc123');
});

test('a board is named as a board in the offer', () => {
  const offer = handoffOffer({ href: BOARD, mac: true, session: store(), local: store() });
  assert.equal(offer.label, 'Open this board in Papol');
});

// US-7.30: the offer is not something a user has to earn by having used it
// before. There is no "have they handed off previously" input at all.
test('a browser that has never handed anything off is still offered', () => {
  const empty = store();
  const offer = handoffOffer({ href: VIEWER, mac: true, session: empty, local: empty });
  assert.ok(offer);
  assert.equal(empty.held.size, 0, 'deciding whether to offer writes nothing');
});

test('a shared reading from a stranger is offered like any other', () => {
  const shared = 'https://mc-pony.com/papol/viewer/?share=s-1';
  assert.ok(handoffOffer({ href: shared, mac: true, session: store(), local: store() }));
});

test('inside the Mac app there is nothing to hand over', () => {
  assert.equal(
    handoffOffer({ href: VIEWER, desktop: true, mac: true, session: store(), local: store() }),
    null,
  );
});

test('a browser that is not on a Mac is told nothing', () => {
  assert.equal(handoffOffer({ href: VIEWER, mac: false, session: store(), local: store() }), null);
});

test('Don’t ask again retires the offer for this browser', () => {
  const local = store({ [RETIRED_KEY]: '1' });
  assert.equal(handoffOffer({ href: VIEWER, mac: true, session: store(), local }), null);
});

test('Not now forgets this document and only this document', () => {
  const session = store();
  deferDocument(session, handoffIdentity(VIEWER));
  assert.equal(handoffOffer({ href: VIEWER, mac: true, session, local: store() }), null);
  assert.ok(handoffOffer({ href: BOARD, mac: true, session, local: store() }));
});

test('a flag round-trips and can be taken back', () => {
  const local = store();
  writeFlag(local, RETIRED_KEY, true);
  assert.equal(local.getItem(RETIRED_KEY), '1');
  writeFlag(local, RETIRED_KEY, false);
  assert.equal(local.getItem(RETIRED_KEY), null);
});

test('a browser that refuses storage still gets an offer and still dismisses', () => {
  const sealed = sealedStore();
  assert.ok(handoffOffer({ href: VIEWER, mac: true, session: sealed, local: sealed }));
  assert.doesNotThrow(() => writeFlag(sealed, RETIRED_KEY, true));
  assert.doesNotThrow(() => deferDocument(sealed, 'pdf:abc123'));
  assert.equal(documentIsDeferred(sealed, 'pdf:abc123'), false);
});

test('deferred documents do not grow without bound', () => {
  const session = store();
  for (let index = 0; index < 80; index += 1) deferDocument(session, `pdf:${index}`);
  const held = JSON.parse(session.getItem('papol.handoff.deferred'));
  assert.equal(held.length, 64);
  assert.equal(held.at(-1), 'pdf:79');
  assert.ok(documentIsDeferred(session, 'pdf:79'));
  assert.equal(documentIsDeferred(session, 'pdf:0'), false);
});

test('deferring the same document twice does not record it twice', () => {
  const session = store();
  deferDocument(session, 'pdf:abc');
  deferDocument(session, 'pdf:abc');
  assert.deepEqual(JSON.parse(session.getItem('papol.handoff.deferred')), ['pdf:abc']);
});

test('nonsense in storage is not allowed to break the offer', () => {
  const session = store({ 'papol.handoff.deferred': 'not json' });
  assert.ok(handoffOffer({ href: VIEWER, mac: true, session, local: store() }));
});

function fakeWindow() {
  const listeners = new Map();
  const timers = new Map();
  let next = 1;
  const view = {
    location: { href: VIEWER },
    document: {
      visibilityState: 'visible',
      focused: false,
      hasFocus() { return this.focused; },
      addEventListener: (name, fn) => listeners.set(`document:${name}`, fn),
      removeEventListener: (name) => listeners.delete(`document:${name}`),
    },
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => listeners.delete(name),
    setTimeout: (fn, ms) => {
      const id = next;
      next += 1;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    listeners,
    timers,
    fire: (name, ...args) => listeners.get(name)?.(...args),
    expire: () => [...timers.values()].forEach((timer) => timer.fn()),
  };
  return view;
}

test('asking the system to open the address does exactly that', async () => {
  const win = fakeWindow();
  const settled = attemptHandoff('papol://mc-pony.com/papol/viewer/?pdf=abc', { win });
  assert.equal(win.location.href, 'papol://mc-pony.com/papol/viewer/?pdf=abc');
  win.fire('pagehide');
  assert.equal(await settled, 'opened');
});

test('losing the page to the application counts as an answer', async () => {
  const win = fakeWindow();
  const settled = attemptHandoff('papol://x/viewer/?pdf=a', { win });
  win.document.visibilityState = 'hidden';
  win.fire('document:visibilitychange');
  assert.equal(await settled, 'opened');
});

test('a visibility change that is not a departure is not an answer', async () => {
  const win = fakeWindow();
  const settled = attemptHandoff('papol://x/viewer/?pdf=a', { win });
  win.fire('document:visibilitychange');
  assert.equal(win.timers.size, 1, 'still waiting');
  win.expire();
  assert.equal(await settled, 'unknown');
});

// US-7.34: silence is not a verdict about the user's computer, it is only
// the absence of evidence — which is why this resolves 'unknown', not 'no'.
test('nothing happening within the window is reported as unknown, not as absence', async () => {
  const win = fakeWindow();
  const settled = attemptHandoff('papol://x/viewer/?pdf=a', { win });
  win.expire();
  assert.equal(await settled, 'unknown');
});

test('the wait has a bound', async () => {
  const win = fakeWindow();
  attemptHandoff('papol://x/viewer/?pdf=a', { win });
  assert.equal([...win.timers.values()][0].ms, DETECTION_MS);
});

test('every listener and timer is given back once the question is settled', async () => {
  const win = fakeWindow();
  const settled = attemptHandoff('papol://x/viewer/?pdf=a', { win });
  assert.equal(win.listeners.size, 4);
  win.fire('pagehide');
  await settled;
  assert.equal(win.listeners.size, 0);
  assert.equal(win.timers.size, 0);
});

test('a second departure cannot settle the question twice', async () => {
  const win = fakeWindow();
  const settled = attemptHandoff('papol://x/viewer/?pdf=a', { win });
  win.fire('pagehide');
  assert.equal(await settled, 'opened');
  assert.doesNotThrow(() => win.fire('blur'));
});

test('a browser that refuses the address at all is an unknown, not a crash', async () => {
  const win = fakeWindow();
  Object.defineProperty(win.location, 'href', {
    set() { throw new Error('refused'); },
    get() { return VIEWER; },
  });
  assert.equal(await attemptHandoff('papol://x/viewer/?pdf=a', { win }), 'unknown');
});

// US-7.34. A browser asked for a scheme it does not know may answer with a
// panel attached to this window: the page keeps its pixels and loses its
// focus, which is exactly what an application arriving looks like. Reading
// that as success is a user with no Papol getting an error they did not
// ask for and losing the download offer that was the point of asking.
test('focus taken by something dismissable, and given back, is not a handoff', async () => {
  const win = fakeWindow();
  const settled = attemptHandoff('papol://x/viewer/?pdf=a', { win });
  win.fire('blur');
  assert.equal(win.timers.size, 1, 'still looking');
  win.fire('focus');
  win.document.focused = true;
  assert.equal(win.timers.size, 1, 'one more look after the focus comes back');
  win.expire();
  assert.equal(await settled, 'unknown');
});

// The two ends of the commonest path. Chrome and Safari both ask "Open
// Papol?" in a prompt of their own before handing a scheme to an
// application; the prompt takes the page's focus, and answering it gives
// the focus back for a moment. What follows is the whole answer.
test('handoff succeeds: the prompt answered with Open, then the app takes the page', async () => {
  const win = fakeWindow();
  const settled = attemptHandoff('papol://x/viewer/?pdf=a', { win });
  win.fire('blur'); // the browser's prompt
  win.fire('focus'); // Open pressed: the page has the focus for a moment
  win.document.focused = true;
  win.fire('blur'); // Papol comes to the front
  win.document.focused = false;
  win.expire();
  assert.equal(await settled, 'opened');
});

test('handoff succeeds: the prompt answered with Open, then the app hides the page', async () => {
  const win = fakeWindow();
  const settled = attemptHandoff('papol://x/viewer/?pdf=a', { win });
  win.fire('blur');
  win.fire('focus');
  win.document.visibilityState = 'hidden'; // Papol full screen over the browser
  win.fire('document:visibilitychange');
  assert.equal(await settled, 'opened');
});

test('handoff fails: the prompt or the no-application panel dismissed, and nothing else', async () => {
  const win = fakeWindow();
  const settled = attemptHandoff('papol://x/viewer/?pdf=a', { win });
  win.fire('blur'); // "Open Papol?" or "no application can open this link"
  win.fire('focus'); // Cancel, or OK: back to the reading
  win.document.focused = true;
  win.expire();
  assert.equal(await settled, 'unknown');
  assert.equal(win.listeners.size, 0);
  assert.equal(win.timers.size, 0);
});

test('focus taken and not given back is a handoff', async () => {
  const win = fakeWindow();
  const settled = attemptHandoff('papol://x/viewer/?pdf=a', { win });
  win.fire('blur');
  win.expire();
  assert.equal(await settled, 'opened');
});

test('a page that still holds the focus it never lost has seen nothing', async () => {
  const win = fakeWindow();
  win.document.focused = true;
  const settled = attemptHandoff('papol://x/viewer/?pdf=a', { win });
  win.expire();
  assert.equal(await settled, 'unknown');
});

test('losing the focus buys a longer look than losing nothing does', async () => {
  const win = fakeWindow();
  attemptHandoff('papol://x/viewer/?pdf=a', { win });
  assert.equal([...win.timers.values()][0].ms, DETECTION_MS);
  win.fire('blur');
  assert.equal(win.timers.size, 1, 'the first wait was given back');
  assert.equal([...win.timers.values()][0].ms, BLUR_GRACE_MS);
});

test('going hidden settles it at once, however the focus went', async () => {
  const win = fakeWindow();
  const settled = attemptHandoff('papol://x/viewer/?pdf=a', { win });
  win.fire('blur');
  win.document.visibilityState = 'hidden';
  win.fire('document:visibilitychange');
  assert.equal(await settled, 'opened');
});

test('focus returning before anything was ever lost settles nothing', async () => {
  const win = fakeWindow();
  const settled = attemptHandoff('papol://x/viewer/?pdf=a', { win });
  win.fire('focus');
  assert.equal(win.timers.size, 1, 'still waiting');
  win.expire();
  assert.equal(await settled, 'unknown');
});

// US-7.24: there is nothing to hand off to on a device that cannot install it.
test('a Mac is a computer a handoff could land on', () => {
  assert.equal(handoffCapableMac({ platform: 'MacIntel', maxTouchPoints: 0 }), true);
  assert.equal(handoffCapableMac({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }), true);
});

// iPadOS asks for the desktop site by default: same platform string, same
// user agent, no Papol for Mac to install. The fingers are the giveaway.
test('an iPad calling itself a Mac is still not offered a Mac application', () => {
  assert.equal(handoffCapableMac({ platform: 'MacIntel', maxTouchPoints: 5 }), false);
  assert.equal(
    handoffCapableMac({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17.0 Safari/605.1.15',
      maxTouchPoints: 5,
    }),
    false,
  );
});

test('nothing else is a Mac', () => {
  assert.equal(handoffCapableMac({ platform: 'Win32', maxTouchPoints: 0 }), false);
  assert.equal(handoffCapableMac({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' }), false);
  assert.equal(handoffCapableMac(null), false);
});

test('a handoff from the page the reader has moved to names that page', () => {
  assert.equal(
    handoffAddressAt(VIEWER, { page: 14, openingPage: 1 }),
    'papol://mc-pony.com/papol/viewer/?pdf=abc123&page=14',
  );
});

test('a reader still where the address opened keeps its finer place', () => {
  const noted = `${VIEWER}&note=n-7`;
  assert.equal(handoffAddressAt(noted, { page: 3, openingPage: 3 }), handoffAddress(noted));
});

test('a reader who moved on from a named note leaves the note behind', () => {
  const address = handoffAddressAt(`${VIEWER}&note=n-7&y=0.4`, { page: 9, openingPage: 3 });
  assert.equal(address, 'papol://mc-pony.com/papol/viewer/?pdf=abc123&page=9');
});

test('an address that names no place is given the page being read', () => {
  assert.equal(
    handoffAddressAt(VIEWER, { page: 5, openingPage: 5 }),
    'papol://mc-pony.com/papol/viewer/?pdf=abc123&page=5',
  );
});

test('without a page being read the address is handed off as it is', () => {
  assert.equal(handoffAddressAt(VIEWER, {}), handoffAddress(VIEWER));
  assert.equal(handoffAddressAt('https://mc-pony.com/papol/', { page: 2 }), null);
});
