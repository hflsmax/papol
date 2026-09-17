// Demo mode: a fictional Papol that lives entirely in the browser.
// httpClient.js routes every request here when the demo URL is active, so the real
// backend is never touched. Its working data can cross the full-page trip
// into the viewer and back, but an explicit refresh resets it. The URL
// remains the sole authority for whether demo mode is active.

import {
  demoPapers, demoNotes, demoPaperSha256, noteAsComment,
} from './demoWorld.js';
import { inDemo } from './appUrls.js';
import { PAPER_NAME_PATTERN, paperName } from './paperName.js';
import appLimits from './appLimits.js';

export function demoActive() {
  return inDemo();
}

export function enterDemo() {
  db = null;
}

export function exitDemo() {
  db = null;
}

// Every demo row is named by UUID, as every Papol row but a paper is — a
// paper is named by its file. Seeds name rows by kind and a small ordinal;
// rows made while playing get a random UUID.
const KIND_DIGITS = {
  user: 'a', tag: 'b', shelf: 'c', copy: 'd', room: 'e', participant: 'f',
  message: '1', availability: '2', notification: '3',
};
const demoUuid = (kind, ordinal) =>
  `00000000-0000-4000-8000-${KIND_DIGITS[kind]}${String(ordinal).padStart(11, '0')}`;
const newUuid = () => globalThis.crypto.randomUUID();
const tagUuids = (...ordinals) => ordinals.map((ordinal) => demoUuid('tag', ordinal));

const ME = demoUuid('user', 1);

function demoError(detail, status = 400) {
  const err = new Error(detail);
  err.status = status;
  return err;
}

// ---------- Seed world ----------

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

function seed() {
  const users = [
    { uuid: ME, display_name: 'SpongeBob SquarePants', affiliation: 'MIT CSAIL', avatar_path: 'assets/demo/spongebob.png', email: 'spongebob@demo.papol', is_admin: false },
    { uuid: demoUuid('user', 2), display_name: 'Sandy Cheeks', affiliation: 'Carnegie Mellon University', avatar_path: 'assets/demo/sandy.png', email: 'sandy@demo.papol' },
    { uuid: demoUuid('user', 3), display_name: 'Patrick Star', affiliation: 'Stanford University', avatar_path: 'assets/demo/patrick.png', email: 'patrick@demo.papol' },
    { uuid: demoUuid('user', 4), display_name: 'Squidward Tentacles', affiliation: 'UC Berkeley', avatar_path: 'assets/demo/squidward.png', email: 'squidward@demo.papol' },
    { uuid: demoUuid('user', 5), display_name: 'Mr. Krabs', affiliation: 'Bikini Bottom University', avatar_path: 'assets/demo/krabs.png', email: 'krabs@demo.papol' },
    // Plankton keeps his address to himself — the opted-out case.
    { uuid: demoUuid('user', 6), display_name: 'Plankton', affiliation: 'Bikini State University', avatar_path: 'assets/demo/plankton.png', email: 'plankton@demo.papol', email_public: false },
  ];

  const papers = demoPapers.map(({ daysAgo: ago, ...p }) => ({
    ...p,
    created_at: daysAgo(ago),
  }));

  let cid = 1;
  // Seeds name a paper by its place in demoPapers, and a user by ordinal.
  const copy = (paper, user, extra = {}) => ({
    uuid: demoUuid('copy', cid++), paper_sha256: demoPaperSha256(paper), user_uuid: demoUuid('user', user), summary: null, thought: null, onDisplay: true, is_author: false,
    rating_expertise: null, rating_reading: null, rating_liking: null,
    tag_uuids: [], created_at: daysAgo(5), ...extra,
  });

  // SpongeBob's private filing system. These never appear in another
  // user's nook or on their copy of the same paper.
  const tags = [
    { uuid: demoUuid('tag', 1), name: 'foundations' },
    { uuid: demoUuid('tag', 2), name: 'transformers' },
    { uuid: demoUuid('tag', 3), name: 'to discuss' },
    { uuid: demoUuid('tag', 4), name: 'my work' },
    // Deliberately unused: opening a paper's tag picker demonstrates that
    // an existing tag can be attached without creating a new one.
    { uuid: demoUuid('tag', 5), name: 'reread' },
    { uuid: demoUuid('tag', 6), name: 'favourite' },
  ];
  const shelves = [
    { uuid: demoUuid('shelf', 1), name: 'Display', color: '#7ba26c', is_public: true, is_default: true, position: 0 },
    { uuid: demoUuid('shelf', 2), name: 'Personal', color: '#2b4a6f', is_public: false, is_default: false, position: 1 },
    { uuid: demoUuid('shelf', 3), name: 'Seminar picks', color: '#b3923d', is_public: true, is_default: false, position: 2 },
    { uuid: demoUuid('shelf', 4), name: 'Deep dives', color: '#6b3f5e', is_public: false, is_default: false, position: 3 },
  ];

  const copies = [
    copy(1, 1, { summary: '## What it proves\n\nConsensus survives traitors only when **more than two thirds** of the generals are loyal — the `3f+1` bound.\n\n- *Oral messages* (§4): needs `3f+1` generals and `f+1` rounds\n- *Signed messages* (§6): any number of traitors, since an order cannot be forged\n\n> No solution with fewer than 3m+1 generals can cope with m traitors.\n\nReread §4 — the induction on m is the part I keep re-deriving.', thought: 'Four generals, one traitor — suddenly the arithmetic makes sense.', rating_expertise: 3, rating_reading: 4, rating_liking: 5, tag_uuids: tagUuids(1, 3), created_at: daysAgo(28) }),
    copy(1, 2, { thought: 'The clearest impossibility argument I know.', rating_expertise: 4, rating_reading: 5, rating_liking: 5 }),
    copy(1, 3, { rating_expertise: 1, rating_reading: 2, rating_liking: 4 }),
    copy(2, 1, { summary: 'Self-attention replaces recurrence entirely: `softmax(QKᵀ/√d)·V`, eight heads in parallel.\n\n1. **Encoder** — six identical layers, attention then feed-forward\n2. **Decoder** — the same, plus masked attention over what it has already produced\n3. **Positional encodings** — sinusoids, and the part I still need to internalize\n\n*Open question*: why sinusoids rather than learned positions? They say it extrapolates to longer sequences, but the paper never shows it.', thought: 'Attention weights are just soft lookups; that finally clicked.', rating_expertise: 2, rating_reading: 3, rating_liking: 4, tag_uuids: tagUuids(2, 3), created_at: daysAgo(20) }),
    copy(2, 2, { thought: 'Everything since is a footnote to this architecture.', rating_expertise: 5, rating_reading: 5, rating_liking: 4 }),
    copy(3, 1, { onDisplay: false, summary: 'Working through how scale changes the few-shot regime before sharing a take.', tag_uuids: tagUuids(2), created_at: daysAgo(12) }),
    copy(3, 3, { thought: 'GPUs go brrr and suddenly vision works.', rating_expertise: 2, rating_reading: 3, rating_liking: 5 }),
    copy(3, 6, { thought: 'Scale beats cleverness; I find that deeply unfair.', rating_expertise: 4, rating_reading: 4, rating_liking: 4 }),
    copy(4, 4, { thought: 'Tables. It was always going to be tables.', rating_expertise: 3, rating_reading: 5, rating_liking: 5 }),
    copy(4, 2, { rating_expertise: 2, rating_reading: 3, rating_liking: 4 }),
    copy(5, 2, { thought: 'Entropy tells you the price of certainty.', rating_expertise: 3, rating_reading: 4, rating_liking: 5 }),
    copy(5, 6, { thought: 'All of information theory in one paper, and we are still mining it.', rating_expertise: 5, rating_reading: 5, rating_liking: 5 }),
    copy(6, 5, { thought: 'Secrets ye can trade in public — marvelous.', rating_expertise: 2, rating_reading: 4, rating_liking: 5 }),
    copy(6, 6, { thought: 'Came for the key exchange, stayed for the paranoia.', rating_expertise: 5, rating_reading: 5, rating_liking: 3 }),
    copy(7, 4, { thought: 'Eigenvectors run the internet and nobody noticed.', rating_expertise: 3, rating_reading: 4, rating_liking: 4 }),
    copy(7, 5, { thought: 'Turns out links are money.', rating_expertise: 1, rating_reading: 2, rating_liking: 5 }),
    copy(8, 4, { thought: 'Still the most elegant seven pages in our field.', rating_expertise: 4, rating_reading: 5, rating_liking: 5 }),
    copy(8, 6, { thought: 'Seven primitives and you get a civilization.', rating_expertise: 3, rating_reading: 3, rating_liking: 4 }),
    copy(9, 2, { thought: 'Call-by-name and call-by-value finally on one clean footing.', rating_expertise: 4, rating_reading: 4, rating_liking: 5 }),
    copy(9, 5, { rating_expertise: 2, rating_reading: 3, rating_liking: 4 }),
    copy(10, 1, { is_author: true, thought: 'Our secret formula holds even when one cook is a spy.', summary: '## Ours\n\nThe **3f+1 patty bound**: the formula survives while at most `f` of the `3f+1` cooks is a spy.\n\n- §5 — the main proof\n- §6 — the *karate chop lemma* (Sandy)\n- §7 — evaluation over one Friday dinner rush\n\n> Reviewer 2 wants a larger grill.', rating_expertise: 5, rating_reading: 5, rating_liking: 5, tag_uuids: tagUuids(3, 4), created_at: daysAgo(1) }),
    copy(10, 2, { is_author: true, thought: 'The karate chop lemma was the hard part.', rating_expertise: 5, rating_reading: 5, rating_liking: 4 }),
    copy(10, 6, { thought: 'I have grave concerns about the threat model.', rating_expertise: 4, rating_reading: 5, rating_liking: 1 }),
    // A private exploration: filed in Deep dives and absent from the
    // public nook even though the public one-line thought stays attached.
    copy(9, 1, { onDisplay: false, thought: 'Reading this in secret.', tag_uuids: tagUuids(1), created_at: daysAgo(0) }),
  ];
  for (const item of copies) item.shelf_uuid = demoUuid('shelf', item.onDisplay ? 1 : 2);
  // Spread SpongeBob's papers across the shelves so every shelf demonstrates
  // real membership, color, visibility, and counts.
  for (const item of copies.filter((copyItem) => copyItem.user_uuid === ME)) {
    if (item.paper_sha256 === demoPaperSha256(1) || item.paper_sha256 === demoPaperSha256(10)) item.shelf_uuid = demoUuid('shelf', 3);
    if (item.paper_sha256 === demoPaperSha256(9)) item.shelf_uuid = demoUuid('shelf', 4);
  }
  // The hint has done its work; a copy carries no visibility of its own.
  for (const item of copies) delete item.onDisplay;

  // SpongeBob's notes, as the API would return them. Bare anchors and his
  // Bare anchors are comments too, exactly as they are on the server.
  const comments = demoNotes.map((n) => noteAsComment(n, ME, daysAgo));

  const key = (p) => (p.doi ? 'doi:' + p.doi.trim().toLowerCase() : 'title:' + p.title.trim().toLowerCase());

  const rooms = [
    { uuid: demoUuid('room', 1), paper_key: key(papers[0]), paper_title: papers[0].title, created_by: demoUuid('user', 3),
      leader_uuid: demoUuid('user', 2), status: 'finished', scheduled_time: 'Two weeks ago, 4 pm', platform: 'Zoom',
      style: 'walkthrough', style_desc: null, created_at: daysAgo(16) },
    { uuid: demoUuid('room', 2), paper_key: key(papers[0]), paper_title: papers[0].title, created_by: demoUuid('user', 3),
      leader_uuid: demoUuid('user', 2), status: 'planning', scheduled_time: null, platform: null,
      style: null, style_desc: null, created_at: daysAgo(2) },
    { uuid: demoUuid('room', 3), paper_key: key(papers[6]), paper_title: papers[6].title, created_by: demoUuid('user', 4),
      leader_uuid: demoUuid('user', 4), status: 'scheduled', scheduled_time: 'Friday, 4:00 pm CET', platform: 'Zoom',
      style: 'questions', style_desc: null, created_at: daysAgo(4) },
    { uuid: demoUuid('room', 4), paper_key: key(papers[1]), paper_title: papers[1].title, created_by: demoUuid('user', 2),
      leader_uuid: null, status: 'open', scheduled_time: null, platform: null,
      style: null, style_desc: null, created_at: daysAgo(1) },
  ];

  let pid = 1;
  const part = (room, user) => ({
    uuid: demoUuid('participant', pid++), room_uuid: demoUuid('room', room), user_uuid: demoUuid('user', user),
    created_at: daysAgo(1),
  });
  const participants = [
    part(1, 2), part(1, 3), part(1, 1),
    part(2, 3), part(2, 2), part(2, 1),
    part(3, 4), part(3, 5),
    part(4, 2),
  ];

  const messages = [
    { uuid: demoUuid('message', 1), room_uuid: demoUuid('room', 2), user_uuid: demoUuid('user', 3), content: 'I mostly followed the story but lost the proof — can we walk it slowly?', created_at: daysAgo(2) },
    { uuid: demoUuid('message', 2), room_uuid: demoUuid('room', 2), user_uuid: demoUuid('user', 2), content: 'Sure! I will prepare the m=1 and m=2 cases on a whiteboard.', created_at: daysAgo(1) },
  ];

  const availabilities = [
    { uuid: demoUuid('availability', 1), room_uuid: demoUuid('room', 2), user_uuid: demoUuid('user', 2), availability: 'Weekday evenings; any time Friday', created_at: daysAgo(1) },
    { uuid: demoUuid('availability', 2), room_uuid: demoUuid('room', 2), user_uuid: demoUuid('user', 3), availability: 'After 3 pm most days', created_at: daysAgo(1) },
  ];

  const notifications = [
    { uuid: demoUuid('notification', 1), user_uuid: ME, room_uuid: demoUuid('room', 4), content: 'Sandy Cheeks called for a seminar on “Attention Is All You Need”. A user of the paper can answer to host.', read: false, created_at: daysAgo(1) },
    { uuid: demoUuid('notification', 2), user_uuid: ME, room_uuid: demoUuid('room', 2), content: 'Sandy Cheeks will host the seminar on “The Byzantine Generals Problem”. Share your availability in the cohort.', read: true, created_at: daysAgo(2) },
  ];

  return {
    users, papers, copies, comments, rooms, participants, messages,
    availabilities, notifications, tags, shelves,
  };
}

let db = null;
const STORAGE_KEY = 'papol.demoWorld';
const navigation = globalThis.window?.performance?.getEntriesByType?.('navigation')?.[0];
if (navigation?.type === 'reload') {
  globalThis.window?.sessionStorage?.removeItem(STORAGE_KEY);
}

function storedWorld() {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY));
    return value && Array.isArray(value.papers) && Array.isArray(value.copies)
      ? value
      : null;
  } catch {
    return null;
  }
}

function persistWorld() {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    // The demo remains usable in browsers where session storage is blocked;
    // it simply falls back to lasting until this document is replaced.
  }
}

const ensure = () => { if (!db) db = storedWorld() || seed(); return db; };
const myTags = () => ensure().tags || (ensure().tags = []);
const tagsOf = (copy) => myTags().filter((tag) => (copy?.tag_uuids || []).includes(tag.uuid));

// ---------- Helpers mirroring the backend ----------

// Mirrors the backend's UserPublic: the email rides along only when the
// user chose to show it.
const publicUser = (u) => ({
  uuid: u.uuid, display_name: u.display_name,
  affiliation: u.affiliation || null, avatar_path: u.avatar_path || null,
  email: u.email_public === false ? null : u.email || null,
});

// Mirrors UserPrivate: the signed-in user always sees their own email.
const privateUser = (u) => ({
  ...publicUser(u),
  email: u.email,
  email_public: u.email_public !== false,
  is_admin: false,
});

const userByUuid = (uuid) => ensure().users.find((u) => u.uuid === uuid);
const paperKey = (p) => (p.doi ? 'doi:' + p.doi.trim().toLowerCase() : 'title:' + p.title.trim().toLowerCase());
const paperCopies = (p) => ensure().copies.filter((c) => c.paper_sha256 === p.sha256);
const shelfOf = (c) => ensure().shelves.find((shelf) => shelf.uuid === c.shelf_uuid) || null;
// On display is the shelf's answer, and only ever the shelf's.
const onDisplay = (c) => !!(c && shelfOf(c)?.is_public);
const displayedCopies = (p) => paperCopies(p).filter(onDisplay);
const copyOf = (p, uid) => paperCopies(p).find((c) => c.user_uuid === uid) || null;
const roomParts = (r) => ensure().participants.filter((x) => x.room_uuid === r.uuid);

const userEntry = (c) => ({
  paper_sha256: c.paper_sha256, user: publicUser(userByUuid(c.user_uuid)),
  is_author: !!c.is_author,
  thought: c.thought,
  rating_expertise: c.rating_expertise, rating_reading: c.rating_reading,
  rating_liking: c.rating_liking,
});

const roomSummary = (r) => ({
  uuid: r.uuid, status: r.status, scheduled_time: r.scheduled_time,
  platform: r.platform, style: r.style, style_desc: r.style_desc,
  created_at: r.created_at,
  creator: publicUser(userByUuid(r.created_by)),
  leader: r.leader_uuid ? publicUser(userByUuid(r.leader_uuid)) : null,
  participant_count: roomParts(r).length,
  participants: roomParts(r).map((x) => publicUser(userByUuid(x.user_uuid))),
});

const paperRooms = (p) =>
  ensure().rooms.filter((r) => r.paper_key === paperKey(p))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

function paperDetail(p) {
  const mine = copyOf(p, ME);
  return {
    sha256: p.sha256, doi: p.doi, title: p.title, authors: p.authors,
    journal: p.journal, year: p.year, file_path: p.file_path,
    created_at: p.created_at,
    summary: mine ? mine.summary : null,
    thought: mine ? mine.thought : null,
    is_public: mine ? onDisplay(mine) : null,
    is_author: mine ? !!mine.is_author : null,
    rating_expertise: mine ? mine.rating_expertise : null,
    rating_reading: mine ? mine.rating_reading : null,
    rating_liking: mine ? mine.rating_liking : null,
    shelf_uuid: mine ? mine.shelf_uuid : null,
    tags: tagsOf(mine),
    notes: mine
      ? ensure().comments.filter((c) => c.paper_sha256 === p.sha256 && c.user_uuid === ME)
          .map((c) => ({ ...c, kind: 'note' }))
      : [],
    also_read_by: displayedCopies(p).map(userEntry),
    rooms: paperRooms(p).map(roomSummary),
    viewer_has_copy: onDisplay(mine),
    viewer_has_entry: !!mine,
  };
}

function roomStatusMap() {
  const m = {};
  for (const r of [...ensure().rooms].sort((a, b) => (a.created_at < b.created_at ? -1 : 1))) {
    m[r.paper_key] = r.status;
  }
  return m;
}

function paperListEntry(p, c, hidePrivate, statusMap) {
  return {
    sha256: p.sha256, doi: p.doi, title: p.title, authors: p.authors,
    journal: p.journal, year: p.year, file_path: p.file_path,
    created_at: c ? c.created_at : p.created_at,
    summary: c && !hidePrivate ? c.summary : null,
    thought: c ? c.thought : null,
    is_public: c ? onDisplay(c) : null,
    is_author: c ? !!c.is_author : null,
    rating_expertise: c ? c.rating_expertise : null,
    rating_reading: c ? c.rating_reading : null,
    rating_liking: c ? c.rating_liking : null,
    shelf_uuid: c ? c.shelf_uuid : null,
    tags: hidePrivate ? [] : tagsOf(c),
    room_status: statusMap[paperKey(p)] || null,
    users: displayedCopies(p).map(userEntry),
  };
}

function roomDetail(r) {
  const d = ensure();
  const paper = d.papers.find((p) => paperKey(p) === r.paper_key) || null;
  const mine = paper ? copyOf(paper, ME) : null;
  const hasCopy = onDisplay(mine);
  return {
    ...roomSummary(r),
    paper_title: r.paper_title,
    paper_sha256: paper ? paper.sha256 : null,
    messages: d.messages.filter((m) => m.room_uuid === r.uuid)
      .map((m) => ({ uuid: m.uuid, content: m.content, created_at: m.created_at, user: publicUser(userByUuid(m.user_uuid)) })),
    availabilities: d.availabilities.filter((a) => a.room_uuid === r.uuid)
      .map((a) => ({ uuid: a.uuid, availability: a.availability, created_at: a.created_at, user: publicUser(userByUuid(a.user_uuid)) })),
    viewer_can_lead:
      r.status === 'open' && hasCopy &&
      roomParts(r).some((x) => x.user_uuid === ME),
    viewer_is_participant: roomParts(r).some((x) => x.user_uuid === ME),
    viewer_has_copy: hasCopy,
    viewer_hidden_entry_sha256: mine && !onDisplay(mine) && paper ? paper.sha256 : null,
  };
}

const now = () => new Date().toISOString();

function ensureParticipant(r) {
  const d = ensure();
  if (!roomParts(r).some((x) => x.user_uuid === ME)) {
    d.participants.push({ uuid: newUuid(), room_uuid: r.uuid, user_uuid: ME, created_at: now() });
  }
}

function requireUserOf(room) {
  const d = ensure();
  const paper = d.papers.find((p) => paperKey(p) === room.paper_key);
  const mine = paper ? copyOf(paper, ME) : null;
  if (!onDisplay(mine)) {
    throw demoError('Add this paper to your nook, and keep it on display, to take part in the cohort', 403);
  }
}

// A request names a paper the way a link does: by the first half of its
// digest — one shape, so no route here has to ask which it was given.
const paperRoute = (rest = '') => new RegExp(`^/papers/(${PAPER_NAME_PATTERN})${rest}$`);

// The identity a name resolves to is the whole digest.
function findPaper(ref) {
  const name = paperName(ref);
  const p = ensure().papers.find((x) => paperName(x.sha256) === name);
  if (!p) throw demoError('Paper not found', 404);
  return p;
}

function inActiveCohort(k) {
  const d = ensure();
  return d.rooms.some(
    (r) => r.paper_key === k && r.status !== 'finished' &&
      roomParts(r).some((x) => x.user_uuid === ME)
  );
}

// ---------- The router ----------

async function routeDemoRequest(path, options = {}) {
  const d = ensure();
  const method = (options.method || 'GET').toUpperCase();
  const body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
  let m;

  // ----- auth -----
  if (path === '/auth/logout') return { message: 'Logged out' };
  if (path === '/auth/me') return privateUser(userByUuid(ME));
  if (path === '/auth/profile' && method === 'PUT') {
    const me = userByUuid(ME);
    if (body.display_name !== undefined) me.display_name = body.display_name || me.display_name;
    if (body.affiliation !== undefined) me.affiliation = body.affiliation || null;
    if (body.email_public !== undefined) me.email_public = !!body.email_public;
    return privateUser(me);
  }
  if (path === '/auth/avatar' || path === '/auth/password') {
    throw demoError('Not available in the demo — create a real account to set this up.');
  }
  // Nothing in the demo is really this user's, so there is nothing to
  // take away and nobody to delete.
  if (path === '/auth/account') {
    throw demoError(
      'The demo account is not yours to close — it resets on its own.'
    );
  }

  // ----- users -----
  if (path === '/users') {
    return d.users.map((u) => ({
      ...publicUser(u),
      paper_count: d.copies.filter((c) => c.user_uuid === u.uuid && onDisplay(c)).length,
    }));
  }
  if (path === '/tags' && method === 'GET') return [...myTags()].sort((a, b) => a.name.localeCompare(b.name));
  if (path === '/shelves' && method === 'GET') return d.shelves.map((shelf) => ({ ...shelf, paper_count: d.copies.filter((copy) => copy.user_uuid === ME && copy.shelf_uuid === shelf.uuid).length }));
  if ((m = path.match(/^\/users\/([0-9a-f-]{36})\/space$/))) {
    const u = userByUuid(m[1]);
    if (!u) throw demoError('User not found', 404);
    const own = u.uuid === ME;
    const statusMap = roomStatusMap();
    const list = d.copies
      .filter((c) => c.user_uuid === u.uuid && (own || onDisplay(c)))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .map((c) => paperListEntry(d.papers.find((p) => p.sha256 === c.paper_sha256), c, !own, statusMap));
    const stats = own
      ? {
          papers: d.copies.filter((c) => c.user_uuid === u.uuid).length,
          displayed: d.copies.filter((c) => c.user_uuid === u.uuid && onDisplay(c)).length,
          notes: d.comments.filter((c) => c.user_uuid === u.uuid).length,
          seminars: d.participants.filter((x) => x.user_uuid === u.uuid).length,
        }
      : null;
    return { user: publicUser(u), papers: list, stats, tags: own ? myTags() : [], shelves: d.shelves.filter((shelf) => own || shelf.is_public).map((shelf) => ({ ...shelf, paper_count: d.copies.filter((copy) => copy.user_uuid === u.uuid && copy.shelf_uuid === shelf.uuid).length })) };
  }

  if (path === '/shelves' && method === 'POST') {
    if (d.shelves.length >= appLimits.counts.shelves_per_nook) {
      throw demoError(`A nook can have at most ${appLimits.counts.shelves_per_nook} shelves`);
    }
    const shelf = { uuid: newUuid(), name: body.name, color: body.color, is_public: !!body.is_public, is_default: false, position: d.shelves.length };
    d.shelves.push(shelf);
    return { ...shelf, paper_count: 0 };
  }
  if ((m = path.match(/^\/shelves\/([0-9a-f-]{36})$/)) && method === 'PUT') {
    const shelf = d.shelves.find((item) => item.uuid === m[1]);
    if (!shelf) throw demoError('Shelf not found', 404);
    if (body.is_default) for (const item of d.shelves) item.is_default = item === shelf;
    Object.assign(shelf, body);
    return { ...shelf, paper_count: d.copies.filter((copy) => copy.user_uuid === ME && copy.shelf_uuid === shelf.uuid).length };
  }
  if ((m = path.match(/^\/shelves\/([0-9a-f-]{36})$/)) && method === 'DELETE') {
    const shelf = d.shelves.find((item) => item.uuid === m[1]);
    if (!shelf) throw demoError('Shelf not found', 404);
    const remaining = d.shelves.filter((item) => item !== shelf);
    if (!remaining.length) throw demoError('A nook must have at least one shelf');
    const destination = remaining.find((item) => item.is_default) || remaining[0];
    for (const copy of d.copies.filter((item) => item.user_uuid === ME && item.shelf_uuid === shelf.uuid)) {
      copy.shelf_uuid = destination.uuid;
    }
    if (shelf.is_default) destination.is_default = true;
    d.shelves = remaining;
    return null;
  }

  if (path === '/tags' && method === 'POST') {
    const name = body.name.trim().replace(/\s+/g, ' ');
    const existing = myTags().find((tag) => tag.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    const tag = { uuid: newUuid(), name };
    myTags().push(tag);
    return tag;
  }
  if ((m = path.match(/^\/tags\/([0-9a-f-]{36})$/)) && method === 'DELETE') {
    const tagUuid = m[1];
    if (!d.tags.some((tag) => tag.uuid === tagUuid)) throw demoError('Tag not found', 404);
    d.tags = d.tags.filter((tag) => tag.uuid !== tagUuid);
    for (const copy of d.copies.filter((item) => item.user_uuid === ME)) {
      copy.tag_uuids = copy.tag_uuids.filter((uuid) => uuid !== tagUuid);
    }
    return null;
  }

  // ----- boards -----
  // The demo world has no boards. Listing them is answered with an empty
  // list rather than the catch-all 404, so the Library still loads.
  if ((path === '/boards' || path === '/library/boards') && method === 'GET') return [];

  // ----- papers -----
  if (path === '/papers' && method === 'GET') {
    const statusMap = roomStatusMap();
    // Every paper. Nobody owns one, so no shelf decides whether it is in
    // the Library; display decides only whose names are shown against it.
    return d.papers
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .map((p) => paperListEntry(p, null, true, statusMap));
  }
  if (path === '/papers/extract') {
    throw demoError('Uploading papers is not available in the demo — create a real account to build your own nook.');
  }
  if ((m = path.match(paperRoute('/extract-metadata')))) {
    const paper = findPaper(m[1]);
    return {
      doi: paper.doi,
      title: paper.title,
      authors: paper.authors,
      journal: paper.journal,
      year: paper.year,
    };
  }
  if (path === '/papers' && method === 'POST') {
    throw demoError('Uploading papers is not available in the demo — create a real account to build your own nook.');
  }
  if ((m = path.match(paperRoute('/add-to-nook')))) {
    const paper = findPaper(m[1]);
    if (copyOf(paper, ME)) throw demoError('This paper is already in your nook');
    const defaultShelf = d.shelves.find((shelf) => shelf.is_default) || d.shelves[0];
    d.copies.push({ uuid: newUuid(), paper_sha256: paper.sha256, user_uuid: ME,
      summary: null, thought: null, is_author: false, rating_expertise: null,
      rating_reading: null, rating_liking: null,
      shelf_uuid: defaultShelf.uuid,
      created_at: now() });
    return paperDetail(paper);
  }
  if ((m = path.match(paperRoute('/annotations'))) && method === 'POST') {
    const paper = findPaper(m[1]);
    if (!copyOf(paper, ME)) throw demoError('Add this paper to your nook first', 403);
    const c = { uuid: newUuid(), kind: body.kind || 'note', paper_sha256: paper.sha256,
      user_uuid: ME, content: body.content || '', page: body.page ?? null,
      body: body.body || {}, created_at: now() };
    d.comments.push(c);
    return c;
  }
  if ((m = path.match(paperRoute('/annotations')))) {
    const paper = findPaper(m[1]);
    return ensure().comments
      .filter((c) => c.paper_sha256 === paper.sha256 && c.user_uuid === ME)
      .map((c) => ({ ...c, kind: c.kind || 'note', body: c.body || {} }));
  }
  if ((m = path.match(/^\/annotations\/([0-9a-f-]{36})$/)) && method === 'PUT') {
    const c = d.comments.find((x) => x.uuid === m[1] && x.user_uuid === ME);
    if (!c) throw demoError('Annotation not found', 404);
    if (body.content !== undefined) c.content = body.content;
    if (body.name !== undefined) c.name = body.name;
    if (body.page !== undefined) c.page = body.page;
    if (body.body !== undefined) c.body = { ...(c.body || {}), ...body.body };
    return { ...c, kind: c.kind || 'note', body: c.body || {} };
  }
  if ((m = path.match(/^\/annotations\/([0-9a-f-]{36})$/)) && method === 'DELETE') {
    const i = d.comments.findIndex((c) => c.uuid === m[1] && c.user_uuid === ME);
    if (i < 0) throw demoError('Annotation not found', 404);
    d.comments.splice(i, 1);
    return { message: 'Annotation deleted' };
  }
  if ((m = path.match(paperRoute('/room')))) {
    const paper = findPaper(m[1]);
    const mine = copyOf(paper, ME);
    if (!onDisplay(mine)) {
      throw demoError('Display this paper to call a seminar', 403);
    }
    const k = paperKey(paper);
    if (d.rooms.some((r) => r.paper_key === k && (r.status === 'open' || r.status === 'planning'))) {
      throw demoError('A seminar is already being organized for this paper');
    }
    const room = { uuid: newUuid(), paper_key: k, paper_title: paper.title,
      created_by: ME, leader_uuid: null, status: 'open', scheduled_time: null,
      platform: null, style: null, style_desc: null, created_at: now() };
    d.rooms.push(room);
    ensureParticipant(room);
    return roomSummary(room);
  }
  if ((m = path.match(paperRoute())) && method === 'PUT') {
    const paper = findPaper(m[1]);
    // `is_public` is answered by moving the copy's shelf, below — it is
    // asked for here but never written onto the copy.
    const stored = ['summary', 'thought', 'is_author', 'rating_expertise', 'rating_reading', 'rating_liking'];
    const personal = [...stored, 'is_public'];
    const metadata = ['title', 'authors', 'journal', 'year', 'doi'];
    if (personal.some((k) => k in body)) {
      const mine = copyOf(paper, ME);
      if (!mine) throw demoError('Add this paper to your nook first', 403);
      if (body.is_public === false && inActiveCohort(paperKey(paper))) {
        throw demoError('You are in a seminar cohort for this paper. Leave the cohort before hiding the paper.');
      }
      for (const k of stored) if (k in body) mine[k] = body[k];
      if ('is_public' in body) {
        const shelf = d.shelves.find((item) => item.is_public === body.is_public);
        if (!shelf) throw demoError(`Create a ${body.is_public ? 'public' : 'private'} shelf first`);
        mine.shelf_uuid = shelf.uuid;
      }
    }
    if ('tag_uuids' in body) {
      const mine = copyOf(paper, ME);
      if (!mine) throw demoError('Add this paper to your nook first', 403);
      mine.tag_uuids = body.tag_uuids;
    }
    if ('shelf_uuid' in body) {
      const mine = copyOf(paper, ME);
      const shelf = d.shelves.find((item) => item.uuid === body.shelf_uuid);
      if (!mine || !shelf) throw demoError('Shelf not found');
      mine.shelf_uuid = shelf.uuid;
    }
    for (const k of metadata) if (k in body) paper[k] = body[k];
    return paperDetail(paper);
  }
  if ((m = path.match(paperRoute())) && method === 'DELETE') {
    const paper = findPaper(m[1]);
    const mine = copyOf(paper, ME);
    if (!mine) throw demoError('Add this paper to your nook first', 403);
    d.copies = d.copies.filter((c) => c !== mine);
    d.comments = d.comments.filter((c) => !(c.paper_sha256 === paper.sha256 && c.user_uuid === ME));
    if (paperCopies(paper).length === 0) {
      d.papers = d.papers.filter((p) => p !== paper);
    }
    return { message: 'Paper removed from your nook' };
  }
  if ((m = path.match(paperRoute())) && method === 'GET') {
    return paperDetail(findPaper(m[1]));
  }

  // ----- rooms -----
  if ((m = path.match(/^\/rooms\/([0-9a-f-]{36})(\/(\w+))?$/))) {
    const room = d.rooms.find((r) => r.uuid === m[1]);
    if (!room) throw demoError('Cohort not found', 404);
    const action = m[3] || null;

    if (!action && method === 'GET') return roomDetail(room);
    if (action === 'lead') {
      if (room.status !== 'open') throw demoError('This seminar already has a host');
      requireUserOf(room);
      if (!roomParts(room).some((x) => x.user_uuid === ME)) {
        throw demoError('Join the cohort before answering to host');
      }
      room.leader_uuid = ME;
      room.status = 'planning';
      ensureParticipant(room);
      return roomDetail(room);
    }
    if (action === 'unhost') {
      if (room.leader_uuid !== ME) throw demoError('Only the host can step back', 403);
      if (room.status !== 'planning') throw demoError('Only a seminar in planning can lose its host');
      room.leader_uuid = null;
      room.status = 'open';
      return roomDetail(room);
    }
    if (action === 'uncall') {
      if (room.created_by !== ME) throw demoError('Only the caller can uncall this seminar', 403);
      if (room.status !== 'open' && room.status !== 'planning') {
        throw demoError('Only an active seminar can be uncalled');
      }
      if (roomParts(room).some((x) => x.user_uuid !== ME)) {
        throw demoError('A seminar can only be uncalled when no one else is in the cohort');
      }
      d.notifications = d.notifications.filter((x) => x.room_uuid !== room.uuid);
      d.participants = d.participants.filter((x) => x.room_uuid !== room.uuid);
      d.availabilities = d.availabilities.filter((x) => x.room_uuid !== room.uuid);
      d.messages = d.messages.filter((x) => x.room_uuid !== room.uuid);
      d.rooms = d.rooms.filter((x) => x !== room);
      return { message: 'Seminar uncalled' };
    }
    if (action === 'join') {
      requireUserOf(room);
      ensureParticipant(room);
      return roomDetail(room);
    }
    if (action === 'leave') {
      if (!roomParts(room).some((x) => x.user_uuid === ME)) throw demoError('You are not in this cohort');
      if (room.leader_uuid === ME && room.status !== 'finished') {
        const successor = body && body.successor_uuid;
        if (!successor) throw demoError('Appoint a cohort member to host before leaving');
        if (successor === ME || !roomParts(room).some((x) => x.user_uuid === successor)) {
          throw demoError('Choose another cohort member');
        }
        room.leader_uuid = successor;
      }
      d.participants = d.participants.filter((x) => !(x.room_uuid === room.uuid && x.user_uuid === ME));
      d.availabilities = d.availabilities.filter((x) => !(x.room_uuid === room.uuid && x.user_uuid === ME));
      return roomDetail(room);
    }
    if (action === 'messages') {
      requireUserOf(room);
      if (!roomParts(room).some((x) => x.user_uuid === ME)) {
        throw demoError('Join the cohort before posting a message');
      }
      d.messages.push({ uuid: newUuid(), room_uuid: room.uuid, user_uuid: ME,
        content: body.content.trim(), created_at: now() });
      return roomDetail(room);
    }
    if (action === 'availability') {
      if (room.status === 'scheduled') throw demoError('This seminar has already been scheduled');
      requireUserOf(room);
      if (!roomParts(room).some((x) => x.user_uuid === ME)) {
        throw demoError('Join the cohort before sharing availability');
      }
      const mine = d.availabilities.find((a) => a.room_uuid === room.uuid && a.user_uuid === ME);
      if (mine) mine.availability = body.availability;
      else d.availabilities.push({ uuid: newUuid(), room_uuid: room.uuid, user_uuid: ME,
        availability: body.availability, created_at: now() });
      return roomDetail(room);
    }
    if (action === 'announce') {
      if (room.leader_uuid !== ME) throw demoError('Only the host can announce', 403);
      if (room.status !== 'planning' && room.status !== 'scheduled') {
        throw demoError('This seminar is not being planned');
      }
      room.scheduled_time = body.scheduled_time;
      room.platform = body.platform;
      room.style = (body.style || '').trim();
      room.style_desc = (body.style_desc || '').trim() || null;
      room.status = 'scheduled';
      return roomDetail(room);
    }
    if (action === 'finish') {
      if (room.leader_uuid !== ME) throw demoError('Only the host can finish the seminar', 403);
      if (room.status !== 'scheduled') throw demoError('Schedule the seminar first');
      room.status = 'finished';
      return roomDetail(room);
    }
  }

  // ----- notifications -----
  if (path === '/notifications' && method === 'GET') {
    const mine = d.notifications.filter((n) => n.user_uuid === ME)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return {
      unread_count: mine.filter((n) => !n.read).length,
      notifications: mine.map(({ user_uuid, ...n }) => n),
    };
  }
  if ((m = path.match(/^\/notifications\/([0-9a-f-]{36})\/read$/))) {
    const n = d.notifications.find((x) => x.uuid === m[1] && x.user_uuid === ME);
    if (!n) throw demoError('Notification not found', 404);
    n.read = true;
    return { message: 'Notification marked read' };
  }
  if (path === '/notifications/read') {
    d.notifications.forEach((n) => { if (n.user_uuid === ME) n.read = true; });
    return { message: 'All notifications marked read' };
  }

  throw demoError('Not available in the demo', 404);
}

export async function demoRequest(path, options = {}) {
  const result = await routeDemoRequest(path, options);
  if ((options.method || 'GET').toUpperCase() !== 'GET') persistWorld();
  return result;
}
