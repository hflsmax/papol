// Demo mode: a fictional Papol that lives entirely in the browser.
// api.js routes every request here when the demo URL is active, so the real
// backend is never touched. Its working data can cross the full-page trip
// into the viewer and back, but an explicit refresh resets it. The URL
// remains the sole authority for whether demo mode is active.

import { demoPapers, demoNotes, demoEditionFor, noteAsComment } from '../../shared/demoWorld';
import { stripAppBase } from './base';

export function demoActive() {
  const path = stripAppBase(window.location.pathname);
  return (
    path.includes('/demo/viewer') ||
    path === '/demo' ||
    path.startsWith('/demo/')
  );
}

export function enterDemo() {
  db = null;
}

export function exitDemo() {
  db = null;
}

const ME = 1;

function demoError(detail, status = 400) {
  const err = new Error(detail);
  err.status = status;
  return err;
}

// ---------- Seed world ----------

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

function seed() {
  const users = [
    { id: ME, display_name: 'SpongeBob SquarePants', affiliation: 'MIT CSAIL', avatar_path: 'assets/demo/spongebob.png', email: 'spongebob@demo.papol', is_admin: false },
    { id: 2, display_name: 'Sandy Cheeks', affiliation: 'Carnegie Mellon University', avatar_path: 'assets/demo/sandy.png', email: 'sandy@demo.papol' },
    { id: 3, display_name: 'Patrick Star', affiliation: 'Stanford University', avatar_path: 'assets/demo/patrick.png', email: 'patrick@demo.papol' },
    { id: 4, display_name: 'Squidward Tentacles', affiliation: 'UC Berkeley', avatar_path: 'assets/demo/squidward.png', email: 'squidward@demo.papol' },
    { id: 5, display_name: 'Mr. Krabs', affiliation: 'Bikini Bottom University', avatar_path: 'assets/demo/krabs.png', email: 'krabs@demo.papol' },
    // Plankton keeps his address to himself — the opted-out case.
    { id: 6, display_name: 'Plankton', affiliation: 'Bikini State University', avatar_path: 'assets/demo/plankton.png', email: 'plankton@demo.papol', email_public: false },
  ];

  const papers = demoPapers.map(({ daysAgo: ago, ...p }) => ({
    ...p,
    created_at: daysAgo(ago),
  }));

  let cid = 1;
  const copy = (paper_id, user_id, extra = {}) => ({
    id: cid++, paper_id, user_id, summary: null, thought: null, marketed: true, is_author: false,
    rating_expertise: null, rating_reading: null, rating_liking: null,
    tag_ids: [], created_at: daysAgo(5), ...extra,
  });

  // SpongeBob's private filing system. These never appear in another
  // reader's nook or on their copy of the same paper.
  const tags = [
    { id: 1, name: 'foundations' },
    { id: 2, name: 'transformers' },
    { id: 3, name: 'to discuss' },
    { id: 4, name: 'my work' },
    // Deliberately unused: opening a paper's tag picker demonstrates that
    // an existing tag can be attached without creating a new one.
    { id: 5, name: 'reread' },
    { id: 6, name: 'favourite' },
  ];
  const shelves = [
    { id: 1, name: 'Display', color: '#7ba26c', is_public: true, is_default: true, position: 0 },
    { id: 2, name: 'Personal', color: '#2b4a6f', is_public: false, is_default: false, position: 1 },
    { id: 3, name: 'Seminar picks', color: '#b3923d', is_public: true, is_default: false, position: 2 },
    { id: 4, name: 'Deep dives', color: '#6b3f5e', is_public: false, is_default: false, position: 3 },
  ];

  const copies = [
    copy(1, ME, { summary: '## What it proves\n\nConsensus survives traitors only when **more than two thirds** of the generals are loyal — the `3f+1` bound.\n\n- *Oral messages* (§4): needs `3f+1` generals and `f+1` rounds\n- *Signed messages* (§6): any number of traitors, since an order cannot be forged\n\n> No solution with fewer than 3m+1 generals can cope with m traitors.\n\nReread §4 — the induction on m is the part I keep re-deriving.', thought: 'Four generals, one traitor — suddenly the arithmetic makes sense.', rating_expertise: 3, rating_reading: 4, rating_liking: 5, tag_ids: [1, 3], created_at: daysAgo(28) }),
    copy(1, 2, { thought: 'The clearest impossibility argument I know.', rating_expertise: 4, rating_reading: 5, rating_liking: 5 }),
    copy(1, 3, { rating_expertise: 1, rating_reading: 2, rating_liking: 4 }),
    copy(2, ME, { summary: 'Self-attention replaces recurrence entirely: `softmax(QKᵀ/√d)·V`, eight heads in parallel.\n\n1. **Encoder** — six identical layers, attention then feed-forward\n2. **Decoder** — the same, plus masked attention over what it has already produced\n3. **Positional encodings** — sinusoids, and the part I still need to internalize\n\n*Open question*: why sinusoids rather than learned positions? They say it extrapolates to longer sequences, but the paper never shows it.', thought: 'Attention weights are just soft lookups; that finally clicked.', rating_expertise: 2, rating_reading: 3, rating_liking: 4, tag_ids: [2, 3], created_at: daysAgo(20) }),
    copy(2, 2, { thought: 'Everything since is a footnote to this architecture.', rating_expertise: 5, rating_reading: 5, rating_liking: 4 }),
    copy(3, ME, { marketed: false, summary: 'Working through how scale changes the few-shot regime before sharing a take.', tag_ids: [2], created_at: daysAgo(12) }),
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
    copy(10, ME, { is_author: true, thought: 'Our secret formula holds even when one cook is a spy.', summary: '## Ours\n\nThe **3f+1 patty bound**: the formula survives while at most `f` of the `3f+1` cooks is a spy.\n\n- §5 — the main proof\n- §6 — the *karate chop lemma* (Sandy)\n- §7 — evaluation over one Friday dinner rush\n\n> Reviewer 2 wants a larger grill.', rating_expertise: 5, rating_reading: 5, rating_liking: 5, tag_ids: [3, 4], created_at: daysAgo(1) }),
    copy(10, 2, { is_author: true, thought: 'The karate chop lemma was the hard part.', rating_expertise: 5, rating_reading: 5, rating_liking: 4 }),
    copy(10, 6, { thought: 'I have grave concerns about the threat model.', rating_expertise: 4, rating_reading: 5, rating_liking: 1 }),
    // A private exploration: filed in Deep dives and absent from the
    // public nook even though the public one-line thought stays attached.
    copy(9, ME, { marketed: false, thought: 'Reading this in secret.', tag_ids: [1], created_at: daysAgo(0) }),
  ];
  for (const item of copies) item.shelf_id = item.marketed ? 1 : 2;
  // Spread SpongeBob's papers across the shelves so every shelf demonstrates
  // real membership, color, visibility, and counts.
  for (const item of copies.filter((copyItem) => copyItem.user_id === ME)) {
    if (item.paper_id === 1 || item.paper_id === 10) item.shelf_id = 3;
    if (item.paper_id === 9) item.shelf_id = 4;
    item.marketed = shelves.find((shelf) => shelf.id === item.shelf_id).is_public;
  }

  // SpongeBob's notes, as the API would return them. Bare anchors and his
  // Bare anchors are comments too, exactly as they are on the server.
  const comments = demoNotes.map((n) => noteAsComment(n, ME, daysAgo));

  const key = (p) => (p.doi ? 'doi:' + p.doi.trim().toLowerCase() : 'title:' + p.title.trim().toLowerCase());

  const rooms = [
    { id: 1, paper_key: key(papers[0]), paper_title: papers[0].title, created_by: 3,
      leader_id: 2, status: 'finished', scheduled_time: 'Two weeks ago, 4 pm', platform: 'Zoom',
      style: 'walkthrough', style_desc: null, created_at: daysAgo(16) },
    { id: 2, paper_key: key(papers[0]), paper_title: papers[0].title, created_by: 3,
      leader_id: 2, status: 'planning', scheduled_time: null, platform: null,
      style: null, style_desc: null, created_at: daysAgo(2) },
    { id: 3, paper_key: key(papers[6]), paper_title: papers[6].title, created_by: 4,
      leader_id: 4, status: 'scheduled', scheduled_time: 'Friday, 4:00 pm CET', platform: 'Zoom',
      style: 'questions', style_desc: null, created_at: daysAgo(4) },
    { id: 4, paper_key: key(papers[1]), paper_title: papers[1].title, created_by: 2,
      leader_id: null, status: 'open', scheduled_time: null, platform: null,
      style: null, style_desc: null, created_at: daysAgo(1) },
  ];

  let pid = 1;
  const part = (room_id, user_id) => ({ id: pid++, room_id, user_id, created_at: daysAgo(1) });
  const participants = [
    part(1, 2), part(1, 3), part(1, ME),
    part(2, 3), part(2, 2), part(2, ME),
    part(3, 4), part(3, 5),
    part(4, 2),
  ];

  const messages = [
    { id: 1, room_id: 2, user_id: 3, content: 'I mostly followed the story but lost the proof — can we walk it slowly?', created_at: daysAgo(2) },
    { id: 2, room_id: 2, user_id: 2, content: 'Sure! I will prepare the m=1 and m=2 cases on a whiteboard.', created_at: daysAgo(1) },
  ];

  const availabilities = [
    { id: 1, room_id: 2, user_id: 2, availability: 'Weekday evenings; any time Friday', created_at: daysAgo(1) },
    { id: 2, room_id: 2, user_id: 3, availability: 'After 3 pm most days', created_at: daysAgo(1) },
  ];

  const notifications = [
    { id: 1, user_id: ME, room_id: 4, content: 'Sandy Cheeks called for a seminar on “Attention Is All You Need”. A reader of the paper can answer to host.', read: false, created_at: daysAgo(1) },
    { id: 2, user_id: ME, room_id: 2, content: 'Sandy Cheeks will host the seminar on “The Byzantine Generals Problem”. Share your availability in the cohort.', read: true, created_at: daysAgo(2) },
  ];

  return {
    users, papers, copies, comments, rooms, participants, messages,
    availabilities, notifications, tags, shelves,
    nextId: { paper: 100, copy: 100, comment: 100, room: 100, part: 100, msg: 100, avail: 100, notif: 100, tag: 7, shelf: 5 },
  };
}

let db = null;
const STORAGE_KEY = 'papol.demoWorld.v2';
const navigation = window.performance.getEntriesByType('navigation')[0];
if (navigation?.type === 'reload') {
  window.sessionStorage.removeItem(STORAGE_KEY);
}

function storedWorld() {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY));
    return value && Array.isArray(value.papers) && Array.isArray(value.copies) && value.nextId
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
const tagsOf = (copy) => myTags().filter((tag) => (copy?.tag_ids || []).includes(tag.id));

// ---------- Helpers mirroring the backend ----------

// Mirrors the backend's UserPublic: the email rides along only when the
// reader chose to show it.
const publicUser = (u) => ({
  id: u.id, display_name: u.display_name,
  affiliation: u.affiliation || null, avatar_path: u.avatar_path || null,
  email: u.email_public === false ? null : u.email || null,
});

// Mirrors UserPrivate: the signed-in reader always sees their own email.
const privateUser = (u) => ({
  ...publicUser(u),
  email: u.email,
  email_public: u.email_public !== false,
  is_admin: false,
});

const userById = (id) => ensure().users.find((u) => u.id === id);
const paperKey = (p) => (p.doi ? 'doi:' + p.doi.trim().toLowerCase() : 'title:' + p.title.trim().toLowerCase());
const paperCopies = (p) => ensure().copies.filter((c) => c.paper_id === p.id);
const displayedCopies = (p) => paperCopies(p).filter((c) => c.marketed);
const copyOf = (p, uid) => paperCopies(p).find((c) => c.user_id === uid) || null;
const roomParts = (r) => ensure().participants.filter((x) => x.room_id === r.id);

const readerEntry = (c) => ({
  paper_id: c.paper_id, user: publicUser(userById(c.user_id)),
  is_author: !!c.is_author,
  thought: c.thought,
  rating_expertise: c.rating_expertise, rating_reading: c.rating_reading,
  rating_liking: c.rating_liking,
});

const roomSummary = (r) => ({
  id: r.id, status: r.status, scheduled_time: r.scheduled_time,
  platform: r.platform, style: r.style, style_desc: r.style_desc,
  created_at: r.created_at,
  creator: publicUser(userById(r.created_by)),
  leader: r.leader_id ? publicUser(userById(r.leader_id)) : null,
  participant_count: roomParts(r).length,
  participants: roomParts(r).map((x) => publicUser(userById(x.user_id))),
});

const paperRooms = (p) =>
  ensure().rooms.filter((r) => r.paper_key === paperKey(p))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

// The demo's papers each have exactly one edition, synthesized from the
// file they carry: enough for the viewer's edition fields to be real,
// while the demo can never gain a second one (uploads are disabled).
const editionsOf = (p) => [
  demoEditionFor(p),
];

function paperDetail(p) {
  const mine = copyOf(p, ME);
  const editions = editionsOf(p);
  const latest = editions[editions.length - 1];
  const myEdition =
    editions.find((e) => mine && e.id === mine.edition_id) || latest;
  return {
    id: p.id, doi: p.doi, title: p.title, authors: p.authors,
    journal: p.journal, year: p.year, file_path: myEdition.file_path,
    created_at: p.created_at,
    editions,
    latest_edition: latest,
    edition_id: myEdition.id,
    ignored_edition_id: mine ? mine.ignored_edition_id ?? null : null,
    summary: mine ? mine.summary : null,
    thought: mine ? mine.thought : null,
    marketed: mine ? mine.marketed : null,
    is_author: mine ? !!mine.is_author : null,
    rating_expertise: mine ? mine.rating_expertise : null,
    rating_reading: mine ? mine.rating_reading : null,
    rating_liking: mine ? mine.rating_liking : null,
    shelf_id: mine ? mine.shelf_id : null,
    tags: tagsOf(mine),
    comments: mine
      ? ensure().comments.filter((c) => c.paper_id === p.id && c.user_id === ME)
          .map((c) => ({ ...c, user: publicUser(userById(c.user_id)) }))
      : [],
    also_read_by: displayedCopies(p).map(readerEntry),
    rooms: paperRooms(p).map(roomSummary),
    viewer_is_reader: !!(mine && mine.marketed),
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
    id: p.id, doi: p.doi, title: p.title, authors: p.authors,
    journal: p.journal, year: p.year, file_path: p.file_path,
    created_at: c ? c.created_at : p.created_at,
    edition_id: c ? c.edition_id ?? editionsOf(p)[0].id : null,
    summary: c && !hidePrivate ? c.summary : null,
    thought: c ? c.thought : null,
    marketed: c ? c.marketed : null,
    is_author: c ? !!c.is_author : null,
    rating_expertise: c ? c.rating_expertise : null,
    rating_reading: c ? c.rating_reading : null,
    rating_liking: c ? c.rating_liking : null,
    shelf_id: c ? c.shelf_id : null,
    tags: hidePrivate ? [] : tagsOf(c),
    room_status: statusMap[paperKey(p)] || null,
    readers: displayedCopies(p).map(readerEntry),
  };
}

function roomDetail(r) {
  const d = ensure();
  const paper = d.papers.find((p) => paperKey(p) === r.paper_key) || null;
  const mine = paper ? copyOf(paper, ME) : null;
  const isReader = !!(mine && mine.marketed);
  return {
    ...roomSummary(r),
    paper_title: r.paper_title,
    paper_id: paper ? paper.id : null,
    messages: d.messages.filter((m) => m.room_id === r.id)
      .map((m) => ({ id: m.id, content: m.content, created_at: m.created_at, user: publicUser(userById(m.user_id)) })),
    availabilities: d.availabilities.filter((a) => a.room_id === r.id)
      .map((a) => ({ id: a.id, availability: a.availability, created_at: a.created_at, user: publicUser(userById(a.user_id)) })),
    viewer_can_lead:
      r.status === 'open' && isReader &&
      roomParts(r).some((x) => x.user_id === ME),
    viewer_is_participant: roomParts(r).some((x) => x.user_id === ME),
    viewer_is_reader: isReader,
    viewer_hidden_entry_id: mine && !mine.marketed && paper ? paper.id : null,
  };
}

const now = () => new Date().toISOString();

function ensureParticipant(r) {
  const d = ensure();
  if (!roomParts(r).some((x) => x.user_id === ME)) {
    d.participants.push({ id: d.nextId.part++, room_id: r.id, user_id: ME, created_at: now() });
  }
}

function requireReaderOf(room) {
  const d = ensure();
  const paper = d.papers.find((p) => paperKey(p) === room.paper_key);
  const mine = paper ? copyOf(paper, ME) : null;
  if (!mine || !mine.marketed) {
    throw demoError('Add this paper to your nook, and keep it on display, to take part in the cohort', 403);
  }
}

function findPaper(ref) {
  const d = ensure();
  const p = /^\d+$/.test(ref)
    ? d.papers.find((x) => x.id === parseInt(ref))
    : d.papers.find((x) => (x.doi || '').toLowerCase() === ref.toLowerCase());
  if (!p) throw demoError('Paper not found', 404);
  return p;
}

function inActiveCohort(k) {
  const d = ensure();
  return d.rooms.some(
    (r) => r.paper_key === k && r.status !== 'finished' &&
      roomParts(r).some((x) => x.user_id === ME)
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
  if (path === '/auth/me') return privateUser(userById(ME));
  if (path === '/auth/profile' && method === 'PUT') {
    const me = userById(ME);
    if (body.display_name !== undefined) me.display_name = body.display_name || me.display_name;
    if (body.affiliation !== undefined) me.affiliation = body.affiliation || null;
    if (body.email_public !== undefined) me.email_public = !!body.email_public;
    return privateUser(me);
  }
  if (path === '/auth/avatar' || path === '/auth/password') {
    throw demoError('Not available in the demo — create a real account to set this up.');
  }
  // Nothing in the demo is really this reader's, so there is nothing to
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
      paper_count: d.copies.filter((c) => c.user_id === u.id && c.marketed).length,
    }));
  }
  if (path === '/tags' && method === 'GET') return [...myTags()].sort((a, b) => a.name.localeCompare(b.name));
  if (path === '/shelves' && method === 'GET') return d.shelves.map((shelf) => ({ ...shelf, paper_count: d.copies.filter((copy) => copy.user_id === ME && copy.shelf_id === shelf.id).length }));
  if ((m = path.match(/^\/users\/(\d+)\/space$/))) {
    const u = userById(parseInt(m[1]));
    if (!u) throw demoError('User not found', 404);
    const own = u.id === ME;
    const statusMap = roomStatusMap();
    const list = d.copies
      .filter((c) => c.user_id === u.id && (own || c.marketed))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .map((c) => paperListEntry(d.papers.find((p) => p.id === c.paper_id), c, !own, statusMap));
    const stats = own
      ? {
          papers: d.copies.filter((c) => c.user_id === u.id).length,
          displayed: d.copies.filter((c) => c.user_id === u.id && c.marketed).length,
          notes: d.comments.filter((c) => c.user_id === u.id).length,
          seminars: d.participants.filter((x) => x.user_id === u.id).length,
        }
      : null;
    return { user: publicUser(u), papers: list, stats, tags: own ? myTags() : [], shelves: d.shelves.filter((shelf) => own || shelf.is_public).map((shelf) => ({ ...shelf, paper_count: d.copies.filter((copy) => copy.user_id === u.id && copy.shelf_id === shelf.id).length })) };
  }

  if (path === '/shelves' && method === 'POST') {
    if (d.shelves.length >= 5) throw demoError('A nook can have at most five shelves');
    const shelf = { id: d.nextId.shelf++, name: body.name, color: body.color, is_public: !!body.is_public, is_default: false, position: d.shelves.length };
    d.shelves.push(shelf);
    return { ...shelf, paper_count: 0 };
  }
  if ((m = path.match(/^\/shelves\/(\d+)$/)) && method === 'PUT') {
    const shelf = d.shelves.find((item) => item.id === parseInt(m[1]));
    if (!shelf) throw demoError('Shelf not found', 404);
    if (body.is_default) for (const item of d.shelves) item.is_default = item === shelf;
    Object.assign(shelf, body);
    if ('is_public' in body) for (const copy of d.copies.filter((item) => item.user_id === ME && item.shelf_id === shelf.id)) copy.marketed = !!body.is_public;
    return { ...shelf, paper_count: d.copies.filter((copy) => copy.user_id === ME && copy.shelf_id === shelf.id).length };
  }
  if ((m = path.match(/^\/shelves\/(\d+)$/)) && method === 'DELETE') {
    const shelf = d.shelves.find((item) => item.id === parseInt(m[1]));
    if (!shelf) throw demoError('Shelf not found', 404);
    const remaining = d.shelves.filter((item) => item !== shelf);
    if (!remaining.length) throw demoError('A nook must have at least one shelf');
    const destination = remaining.find((item) => item.is_default) || remaining[0];
    for (const copy of d.copies.filter((item) => item.user_id === ME && item.shelf_id === shelf.id)) {
      copy.shelf_id = destination.id;
      copy.marketed = destination.is_public;
    }
    if (shelf.is_default) destination.is_default = true;
    d.shelves = remaining;
    return null;
  }

  if (path === '/tags' && method === 'POST') {
    const name = body.name.trim().replace(/\s+/g, ' ');
    const existing = myTags().find((tag) => tag.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    const tag = { id: d.nextId.tag++, name };
    myTags().push(tag);
    return tag;
  }
  if ((m = path.match(/^\/tags\/(\d+)$/)) && method === 'DELETE') {
    const tagId = parseInt(m[1]);
    if (!d.tags.some((tag) => tag.id === tagId)) throw demoError('Tag not found', 404);
    d.tags = d.tags.filter((tag) => tag.id !== tagId);
    for (const copy of d.copies.filter((item) => item.user_id === ME)) {
      copy.tag_ids = copy.tag_ids.filter((id) => id !== tagId);
    }
    return null;
  }

  // ----- papers -----
  if (path === '/papers' && method === 'GET') {
    const statusMap = roomStatusMap();
    return d.papers
      .filter((p) => displayedCopies(p).length > 0)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .map((p) => paperListEntry(p, null, true, statusMap));
  }
  if (path === '/papers/extract') {
    throw demoError('Uploading papers is not available in the demo — create a real account to build your own nook.');
  }
  if ((m = path.match(/^\/papers\/(\d+)\/extract-metadata$/))) {
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
  if ((m = path.match(/^\/papers\/(\d+)\/add-to-nook$/))) {
    const paper = findPaper(m[1]);
    if (copyOf(paper, ME)) throw demoError('This paper is already in your nook');
    const defaultShelf = d.shelves.find((shelf) => shelf.is_default) || d.shelves[0];
    d.copies.push({ id: d.nextId.copy++, paper_id: paper.id, user_id: ME,
      summary: null, thought: null, marketed: defaultShelf.is_public, is_author: false, rating_expertise: null,
      rating_reading: null, rating_liking: null,
      shelf_id: defaultShelf.id,
      created_at: now() });
    return paperDetail(paper);
  }
  if ((m = path.match(/^\/papers\/(\d+)\/editions$/))) {
    throw demoError('Not available in the demo — create a real account to upload PDFs.');
  }
  if ((m = path.match(/^\/papers\/(\d+)\/ignore-edition$/))) {
    const paper = findPaper(m[1]);
    const mine = copyOf(paper, ME);
    if (!mine) throw demoError('Add this paper to your nook first', 403);
    const editions = editionsOf(paper);
    mine.ignored_edition_id = body.edition_id || editions[editions.length - 1].id;
    return paperDetail(paper);
  }
  if ((m = path.match(/^\/papers\/(\d+)\/adopt-edition$/))) {
    const paper = findPaper(m[1]);
    const mine = copyOf(paper, ME);
    if (!mine) throw demoError('Add this paper to your nook first', 403);
    const editions = editionsOf(paper);
    mine.edition_id = body.edition_id || editions[editions.length - 1].id;
    return paperDetail(paper);
  }
  if ((m = path.match(/^\/papers\/(\d+)\/comments$/))) {
    const paper = findPaper(m[1]);
    if (!copyOf(paper, ME)) throw demoError('Add this paper to your nook first', 403);
    const c = { id: d.nextId.comment++, paper_id: paper.id, user_id: ME,
      content: body.content, created_at: now() };
    d.comments.push(c);
    return { ...c, user: publicUser(userById(ME)) };
  }
  if ((m = path.match(/^\/comments\/(\d+)$/)) && method === 'PUT') {
    const c = d.comments.find((x) => x.id === parseInt(m[1]) && x.user_id === ME);
    if (!c) throw demoError('Comment not found', 404);
    c.content = body.content;
    return { ...c, user: publicUser(userById(c.user_id)) };
  }
  if ((m = path.match(/^\/comments\/(\d+)$/)) && method === 'DELETE') {
    const i = d.comments.findIndex((c) => c.id === parseInt(m[1]) && c.user_id === ME);
    if (i < 0) throw demoError('Comment not found', 404);
    d.comments.splice(i, 1);
    return { message: 'Comment deleted' };
  }
  if ((m = path.match(/^\/papers\/(\d+)\/room$/))) {
    const paper = findPaper(m[1]);
    const mine = copyOf(paper, ME);
    if (!mine || !mine.marketed) {
      throw demoError('Display this paper to call a seminar', 403);
    }
    const k = paperKey(paper);
    if (d.rooms.some((r) => r.paper_key === k && (r.status === 'open' || r.status === 'planning'))) {
      throw demoError('A seminar is already being organized for this paper');
    }
    const room = { id: d.nextId.room++, paper_key: k, paper_title: paper.title,
      created_by: ME, leader_id: null, status: 'open', scheduled_time: null,
      platform: null, style: null, style_desc: null, created_at: now() };
    d.rooms.push(room);
    ensureParticipant(room);
    return roomSummary(room);
  }
  if ((m = path.match(/^\/papers\/(\d+)$/)) && method === 'PUT') {
    const paper = findPaper(m[1]);
    const personal = ['summary', 'thought', 'marketed', 'is_author', 'rating_expertise', 'rating_reading', 'rating_liking'];
    const metadata = ['title', 'authors', 'journal', 'year', 'doi'];
    if (personal.some((k) => k in body)) {
      const mine = copyOf(paper, ME);
      if (!mine) throw demoError('Add this paper to your nook first', 403);
      if (body.marketed === false && inActiveCohort(paperKey(paper))) {
        throw demoError('You are in a seminar cohort for this paper. Leave the cohort before hiding the paper.');
      }
      for (const k of personal) if (k in body) mine[k] = body[k];
      if ('marketed' in body) {
        const shelf = d.shelves.find((item) => item.is_public === body.marketed);
        if (!shelf) throw demoError(`Create a ${body.marketed ? 'public' : 'private'} shelf first`);
        mine.shelf_id = shelf.id;
        mine.marketed = shelf.is_public;
      }
    }
    if ('tag_ids' in body) {
      const mine = copyOf(paper, ME);
      if (!mine) throw demoError('Add this paper to your nook first', 403);
      mine.tag_ids = body.tag_ids;
    }
    if ('shelf_id' in body) {
      const mine = copyOf(paper, ME);
      const shelf = d.shelves.find((item) => item.id === body.shelf_id);
      if (!mine || !shelf) throw demoError('Shelf not found');
      mine.shelf_id = shelf.id;
      mine.marketed = shelf.is_public;
    }
    for (const k of metadata) if (k in body) paper[k] = body[k];
    return paperDetail(paper);
  }
  if ((m = path.match(/^\/papers\/(\d+)$/)) && method === 'DELETE') {
    const paper = findPaper(m[1]);
    const mine = copyOf(paper, ME);
    if (!mine) throw demoError('Add this paper to your nook first', 403);
    d.copies = d.copies.filter((c) => c !== mine);
    d.comments = d.comments.filter((c) => !(c.paper_id === paper.id && c.user_id === ME));
    if (paperCopies(paper).length === 0) {
      d.papers = d.papers.filter((p) => p !== paper);
    }
    return { message: 'Paper removed from your nook' };
  }
  if ((m = path.match(/^\/papers\/(.+)$/)) && method === 'GET') {
    return paperDetail(findPaper(m[1]));
  }

  // ----- rooms -----
  if ((m = path.match(/^\/rooms\/(\d+)(\/(\w+))?$/))) {
    const room = d.rooms.find((r) => r.id === parseInt(m[1]));
    if (!room) throw demoError('Cohort not found', 404);
    const action = m[3] || null;

    if (!action && method === 'GET') return roomDetail(room);
    if (action === 'lead') {
      if (room.status !== 'open') throw demoError('This seminar already has a host');
      requireReaderOf(room);
      if (!roomParts(room).some((x) => x.user_id === ME)) {
        throw demoError('Join the cohort before answering to host');
      }
      room.leader_id = ME;
      room.status = 'planning';
      ensureParticipant(room);
      return roomDetail(room);
    }
    if (action === 'unhost') {
      if (room.leader_id !== ME) throw demoError('Only the host can step back', 403);
      if (room.status !== 'planning') throw demoError('Only a seminar in planning can lose its host');
      room.leader_id = null;
      room.status = 'open';
      return roomDetail(room);
    }
    if (action === 'join') {
      requireReaderOf(room);
      ensureParticipant(room);
      return roomDetail(room);
    }
    if (action === 'leave') {
      if (!roomParts(room).some((x) => x.user_id === ME)) throw demoError('You are not in this cohort');
      if (room.leader_id === ME && room.status !== 'finished') {
        const successor = body && body.successor_id;
        if (!successor) throw demoError('Appoint a cohort member to host before leaving');
        if (successor === ME || !roomParts(room).some((x) => x.user_id === successor)) {
          throw demoError('Choose another cohort member');
        }
        room.leader_id = successor;
      }
      d.participants = d.participants.filter((x) => !(x.room_id === room.id && x.user_id === ME));
      d.availabilities = d.availabilities.filter((x) => !(x.room_id === room.id && x.user_id === ME));
      return roomDetail(room);
    }
    if (action === 'messages') {
      requireReaderOf(room);
      if (!roomParts(room).some((x) => x.user_id === ME)) {
        throw demoError('Join the cohort before posting a message');
      }
      d.messages.push({ id: d.nextId.msg++, room_id: room.id, user_id: ME,
        content: body.content.trim(), created_at: now() });
      return roomDetail(room);
    }
    if (action === 'availability') {
      if (room.status === 'scheduled') throw demoError('This seminar has already been scheduled');
      requireReaderOf(room);
      if (!roomParts(room).some((x) => x.user_id === ME)) {
        throw demoError('Join the cohort before sharing availability');
      }
      const mine = d.availabilities.find((a) => a.room_id === room.id && a.user_id === ME);
      if (mine) mine.availability = body.availability;
      else d.availabilities.push({ id: d.nextId.avail++, room_id: room.id, user_id: ME,
        availability: body.availability, created_at: now() });
      return roomDetail(room);
    }
    if (action === 'announce') {
      if (room.leader_id !== ME) throw demoError('Only the host can announce', 403);
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
      if (room.leader_id !== ME) throw demoError('Only the host can finish the seminar', 403);
      if (room.status !== 'scheduled') throw demoError('Schedule the seminar first');
      room.status = 'finished';
      return roomDetail(room);
    }
  }

  // ----- notifications -----
  if (path === '/notifications' && method === 'GET') {
    const mine = d.notifications.filter((n) => n.user_id === ME)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return {
      unread_count: mine.filter((n) => !n.read).length,
      notifications: mine.map(({ user_id, ...n }) => n),
    };
  }
  if ((m = path.match(/^\/notifications\/(\d+)\/read$/))) {
    const n = d.notifications.find((x) => x.id === parseInt(m[1]) && x.user_id === ME);
    if (!n) throw demoError('Notification not found', 404);
    n.read = true;
    return { message: 'Notification marked read' };
  }
  if (path === '/notifications/read') {
    d.notifications.forEach((n) => { if (n.user_id === ME) n.read = true; });
    return { message: 'All notifications marked read' };
  }

  throw demoError('Not available in the demo', 404);
}

export async function demoRequest(path, options = {}) {
  const result = await routeDemoRequest(path, options);
  if ((options.method || 'GET').toUpperCase() !== 'GET') persistWorld();
  return result;
}
