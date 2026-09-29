import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// The pages inside a project (the desk and its tabs, a dig), as the real app
// renders them at their real addresses, over a pretend server: a Vite
// server for the frontend that answers `/api/…` itself with one made-up
// project, and signs the tab in as one of its members before the app
// loads. No account or Worker is needed. `?shell=desktop` shows the Mac
// shell around the same pages. project-shots.mjs photographs them.

export const ME = 'a1b2c3d4-0000-4000-8000-000000000001';
const ANA = 'a1b2c3d4-0000-4000-8000-000000000002';
const BEN = 'a1b2c3d4-0000-4000-8000-000000000003';
const MIA = 'a1b2c3d4-0000-4000-8000-000000000004';
export const PROJECT = 'b1b2c3d4-0000-4000-8000-000000000010';
const BOARD_PLAN = 'c1b2c3d4-0000-4000-8000-000000000020';
const BOARD_MAP = 'c1b2c3d4-0000-4000-8000-000000000021';
const CARD_SPARSE = 'd1b2c3d4-0000-4000-8000-000000000030';
export const DIG_PAPER = 'e1b2c3d4-0000-4000-8000-000000000040';
const DIG_CARD = 'e1b2c3d4-0000-4000-8000-000000000041';
const DIG_SURVEY = 'e1b2c3d4-0000-4000-8000-000000000044';
const DIG_PAPER_MIA = 'e1b2c3d4-0000-4000-8000-000000000049';
const DIG_PAPER_BEN = 'e1b2c3d4-0000-4000-8000-000000000045';

const user = (uuid, display_name, affiliation) => ({ uuid, display_name, affiliation, avatar_path: null, email: null });
const me = user(ME, 'Dana Okafor', 'Leiden Observatory');
const ana = user(ANA, 'Ana Reyes', 'ESO');
const ben = user(BEN, 'Ben Hall', 'Leiden Observatory');
const mia = user(MIA, 'Mia Tanaka', 'Subaru Telescope');
// People in Papol who are not in the project, for a keeper to add.
const outsiders = [
  user('a1b2c3d4-0000-4000-8000-000000000005', 'Marta Lindqvist', 'Stockholm University'),
  user('a1b2c3d4-0000-4000-8000-000000000006', 'Mark Osei', null),
];

const digest = (n) => n.toString(16).padStart(2, '0').repeat(32);
export const P_ERROR = digest(0xa1);
export const P_SURVEY = digest(0xa2);
export const P_LEARN = digest(0xa3);
export const P_PYRAMID = digest(0xa4);
export const P_VIBES = digest(0xa5);

const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const daysAgo = (d) => hoursAgo(d * 24);

const papers = [
  {
    sha256: P_LEARN, title: 'Learning wavefront control from few examples', authors: "[\"R. Gomez\", \"T. Lindqvist\", \"P. Ferreira\"]",
    journal: 'Nature Photonics', year: 2025, doi: null, added_by: ben, added_at: hoursAgo(5), is_new: true, in_my_nook: false,
    users: [{ user: ben, thought: 'Worth trying on the bench this month.', rating_reading: 3, rating_liking: 4 }],
    board_uuids: [BOARD_PLAN],
  },
  {
    sha256: P_ERROR, title: 'Error dynamics in adaptive optics loops', authors: "[\"L. Chen\", \"M. Patel\"]",
    journal: 'Optics Letters', year: 2024, doi: null, added_by: me, added_at: daysAgo(3), is_new: false, in_my_nook: true,
    users: [
      { user: ana, thought: 'Section 3 is where our model breaks.', rating_reading: 4, rating_liking: 3 },
      { user: me, thought: 'The clearest account of why the loop lags.', rating_reading: 4, rating_liking: 4 },
      { user: ben, thought: null, rating_reading: 2, rating_liking: null },
    ],
    board_uuids: [BOARD_PLAN, BOARD_MAP],
  },
  {
    sha256: P_SURVEY, title: 'A survey of predictive control for telescopes', authors: "[\"S. Olsen\"]",
    journal: 'Annual Review of Astronomy and Astrophysics', year: 2023, doi: null, added_by: ana, added_at: daysAgo(6), is_new: false, in_my_nook: true,
    users: [{ user: ana, thought: 'Skim §4 and §7; the rest is history.', rating_reading: 5, rating_liking: 3 }, { user: me, thought: null, rating_reading: 1, rating_liking: null }],
    board_uuids: [BOARD_MAP],
  },
  {
    sha256: P_PYRAMID, title: 'Pyramid wavefront sensing under strong scintillation', authors: "[\"K. Nakamura\", \"J. Vidal\", \"A. Rossi\", \"H. Berger\"]",
    journal: 'Journal of Astronomical Telescopes, Instruments, and Systems', year: 2022, doi: null, added_by: ana, added_at: daysAgo(9), is_new: false, in_my_nook: false,
    users: [{ user: ana, thought: null, rating_reading: 3, rating_liking: null }],
    board_uuids: [],
  },
  {
    sha256: P_VIBES, title: 'Vibration rejection with learned disturbance models', authors: "[\"F. Moreau\", \"D. Okafor\"]",
    journal: null, year: 2026, doi: null, added_by: mia, added_at: hoursAgo(26), is_new: true, in_my_nook: true,
    users: [{ user: mia, thought: 'Our own preprint, for the record.', rating_reading: 5, rating_liking: 4 }, { user: me, thought: null, rating_reading: 5, rating_liking: null }],
    board_uuids: [],
  },
];

const box = (x, y, w, h, kind = 'comment') => ({ x, y, w, h, kind });
const boards = [
  {
    uuid: BOARD_PLAN, name: 'Bench plan', description: null, owner: me, item_count: 12, updated_at: hoursAgo(2),
    boxes: [box(0, 0, 300, 112), box(340, 0, 300, 145, 'excerpt'), box(0, 150, 300, 112), box(340, 180, 300, 112), box(700, 40, 300, 180, 'image'), box(0, 300, 300, 145, 'excerpt'), box(340, 330, 300, 112), box(700, 260, 300, 112), box(1040, 0, 300, 112), box(1040, 150, 300, 145, 'excerpt'), box(1040, 330, 300, 112), box(700, 410, 300, 82, 'file')],
  },
  {
    uuid: BOARD_MAP, name: 'Attention variants map', description: null, owner: ana, item_count: 5, updated_at: hoursAgo(1), is_new: true,
    boxes: [box(0, 0, 300, 145, 'excerpt'), box(360, 0, 300, 145, 'excerpt'), box(180, 200, 300, 112), box(540, 220, 300, 180, 'image'), box(0, 260, 300, 112)],
  },
];

const subject = {
  paperError: { key: `paper:${P_ERROR}`, kind: 'paper', paper_sha256: P_ERROR, label: 'Error dynamics in adaptive optics loops' },
  paperSurvey: { key: `paper:${P_SURVEY}`, kind: 'paper', paper_sha256: P_SURVEY, label: 'A survey of predictive control for telescopes' },
  // Digs made inside the error-dynamics paper: on an anchor, on ink, on a clip.
  anchorDelay: { key: 'annotation:a9000000-0000-4000-8000-000000000001', kind: 'annotation', annotation_uuid: 'a9000000-0000-4000-8000-000000000001', paper_sha256: P_ERROR, paper_title: 'Error dynamics in adaptive optics loops', annotation_kind: 'anchor', page: 3, down: 0.42, by: 'Ben Hall', label: 'Delay assumed fixed at one frame' },
  inkBudget: { key: 'annotation:a9000000-0000-4000-8000-000000000002', kind: 'annotation', annotation_uuid: 'a9000000-0000-4000-8000-000000000002', paper_sha256: P_ERROR, paper_title: 'Error dynamics in adaptive optics loops', annotation_kind: 'ink', page: 5, down: 0.3, by: 'Ana Reyes', label: 'Ink on page 5' },
  clipFigure: { key: 'annotation:a9000000-0000-4000-8000-000000000003', kind: 'annotation', annotation_uuid: 'a9000000-0000-4000-8000-000000000003', paper_sha256: P_ERROR, paper_title: 'Error dynamics in adaptive optics loops', annotation_kind: 'clip', page: 8, down: 0.2, by: 'Dana Okafor', label: 'A clip on page 8' },
  card: { key: `card:${CARD_SPARSE}`, kind: 'card', board_item_uuid: CARD_SPARSE, board_uuid: BOARD_PLAN, board_name: 'Bench plan', card_kind: 'comment', label: 'Sparse attention at long context' },
};

const post = (uuid, u, body, at, mine = false) => ({ uuid, user: u, body, created_at: at, edited_at: null, is_mine: mine });
const errorPosts = [
  post('f0000000-0000-4000-8000-000000000001', ana, `I think Section 3 is where our model breaks, and it matters for the bench plan.

The authors assume the wavefront sensor delay is **fixed at one frame**. On our setup it isn't: the camera readout drifts between 0.8 and 1.3 frames depending on the exposure, and their error budget (eq. 12) grows fast with delay.

Two things follow:

1. Their headline 40% gain is an upper bound for us, not an estimate.
2. If we measure the delay first, we can say how much of the gain we should expect before we spend a week on the controller.

Dana, does that match what you saw in March?`, daysAgo(2)),
  post('f0000000-0000-4000-8000-000000000002', me, `It does. March runs showed the same drift, and I never wrote it down properly, which is on me.

I'd go further: their simulation uses a frozen-flow turbulence model, so the *prediction* half of the controller gets an easier job than it would on sky. Figure 6 is the only place they test anything else, and the gain there drops to about 15%.

I added "Measure the loop delay" to the Bench plan board. Let's do that before anything else.`, hoursAgo(30), true),
  post('f0000000-0000-4000-8000-000000000003', ben, 'Agreed on measuring first. I can run the delay sweep on Thursday if someone books the bench.', hoursAgo(3)),
];

const digs = [
  { uuid: 'd9000000-0000-4000-8000-000000000001', owner: ben, is_mine: false, text: 'This is the assumption our bench breaks. Everything in section 4 leans on it.', subject: subject.anchorDelay, post_count: 1, unread: 1, is_new: true, voices: [ben, ana], updated_at: hoursAgo(5), created_at: daysAgo(1), last_post: { user: ana, excerpt: 'Worth a line in the bench plan: measure it before we tune anything.', created_at: hoursAgo(5) } },
  { uuid: 'd9000000-0000-4000-8000-000000000002', owner: ana, is_mine: false, text: 'Eq. 12 grows with the square of the delay, so 1.3 frames is not a small miss.', subject: subject.inkBudget, post_count: 0, unread: 0, is_new: false, voices: [ana], updated_at: daysAgo(1), created_at: daysAgo(1), last_post: { user: ana, excerpt: 'Eq. 12 grows with the square of the delay, so 1.3 frames is not a small miss.', created_at: daysAgo(1) } },
  { uuid: 'd9000000-0000-4000-8000-000000000003', owner: me, is_mine: true, phase: 'gold', text: 'Figure 6 is the only on-sky test. Keep this one for the write-up.', subject: subject.clipFigure, post_count: 0, unread: 0, is_new: false, voices: [me], updated_at: daysAgo(2), created_at: daysAgo(2), last_post: { user: me, excerpt: 'Figure 6 is the only on-sky test. Keep this one for the write-up.', created_at: daysAgo(2) } },
  { uuid: DIG_PAPER, owner: ana, is_mine: false, text: errorPosts[0].body, subject: subject.paperError, post_count: 2, unread: 1, is_new: true, voices: [ana, me, ben], updated_at: hoursAgo(3), created_at: daysAgo(2), last_post: { user: ben, excerpt: errorPosts[2].body, created_at: hoursAgo(3) } },
  { uuid: DIG_PAPER_BEN, owner: ben, is_mine: false, phase: 'stashed', text: 'The appendix has the raw delay traces; worth plotting against ours.', subject: subject.paperError, post_count: 0, unread: 0, is_new: false, voices: [ben], updated_at: daysAgo(1), created_at: daysAgo(1), last_post: { user: ben, excerpt: 'The appendix has the raw delay traces; worth plotting against ours.', created_at: daysAgo(1) } },
  { uuid: DIG_CARD, owner: me, is_mine: true, text: 'Their few-shot result is why this card goes first.', subject: subject.card, post_count: 3, unread: 0, is_new: false, voices: [me, ben], updated_at: hoursAgo(20), created_at: daysAgo(2), last_post: { user: ben, excerpt: 'Before we try this, what does "few-shot" mean on our bench? Their examples are 200 open-loop frames, which we can record in an afternoon.', created_at: hoursAgo(20) } },
  { uuid: DIG_PAPER_MIA, owner: mia, is_mine: false, phase: 'buried', text: 'Their turbulence model is the wrong one for our site.', subject: subject.paperError, post_count: 0, unread: 0, is_new: false, voices: [mia], updated_at: daysAgo(2), created_at: daysAgo(2), last_post: { user: mia, excerpt: 'Their turbulence model is the wrong one for our site.', created_at: daysAgo(2) } },
  { uuid: DIG_SURVEY, owner: me, is_mine: true, phase: 'gold', text: 'The best map of the field so far; the taxonomy in section 2 is worth keeping.', subject: subject.paperSurvey, post_count: 4, unread: 0, is_new: false, voices: [me, ana, ben], updated_at: daysAgo(5), created_at: daysAgo(6), last_post: { user: me, excerpt: 'Dug into Sparse attention at long context', created_at: daysAgo(5) } },
];

// The member's personal digs, outside any project: theirs alone, on the
// papers in their nook. One on the survey; none on the others.
const PERSONAL_DIG = 'e1b2c3d4-0000-4000-8000-000000000050';
const personal = [
  { uuid: PERSONAL_DIG, subject: subject.paperSurvey, text: 'Read section 2 before the group meets: its taxonomy is the one we should use.\n\nThe table on page 14 compares every controller on the same bench; worth copying for the thesis.', created_at: daysAgo(4) },
];
const personalOf = (d) => ({ uuid: d.uuid, created_at: d.created_at, updated_at: d.created_at, edited_at: null, project: null, subject: d.subject, owner: me, is_mine: true, text: d.text, phase: 'digging', can_moderate: false, posts: [] });

const project = {
  uuid: PROJECT, name: 'Adaptive optics control', created_at: daysAgo(20),
  description: 'How a closed loop can learn the turbulence it corrects, and where learned control beats a tuned integrator on a real bench.',
  members: [
    { user: me, is_keeper: true, joined_at: daysAgo(20) },
    { user: ana, is_keeper: true, joined_at: daysAgo(19) },
    { user: ben, is_keeper: false, joined_at: daysAgo(12) },
    { user: mia, is_keeper: false, joined_at: daysAgo(2) },
  ],
  is_member: true, is_keeper: true, invite_code: 'Ab3dE5gH7j',
  boards, digs, papers,
};

const summary = { uuid: PROJECT, name: project.name, created_at: project.created_at, members: project.members, is_member: true, is_keeper: true, new_count: 3 };
const other = { uuid: 'b1b2c3d4-0000-4000-8000-000000000011', name: 'Reading group', created_at: daysAgo(60), members: [{ user: me, is_keeper: false, joined_at: daysAgo(60) }, { user: mia, is_keeper: true, joined_at: daysAgo(60) }], is_member: true, is_keeper: false, new_count: 0 };
// A project the member is not in, as the Bazaar lists it.
const closed = { uuid: 'b1b2c3d4-0000-4000-8000-000000000012', name: 'Wavefront sensing', created_at: daysAgo(40), members: [{ user: mia, is_keeper: true, joined_at: daysAgo(40) }], is_member: false, is_keeper: false, new_count: 0 };

const digOf = (uuid) => {
  const d = digs.find((x) => x.uuid === uuid);
  if (!d) return null;
  const posts = uuid === DIG_PAPER ? errorPosts.slice(1)
    : d.post_count ? [post(`f1000000-0000-4000-8000-${uuid.slice(-12)}`, d.last_post.user, d.last_post.excerpt, d.last_post.created_at, d.last_post.user.uuid === ME)] : [];
  return { uuid, created_at: d.created_at, updated_at: d.updated_at, edited_at: null, project: { uuid: PROJECT, name: project.name }, subject: d.subject, owner: d.owner, is_mine: d.is_mine, text: d.text, phase: d.phase ?? 'digging', can_moderate: true, posts };
};

// A paper as the Library and a nook list it: the members' takes are the
// users shown against it, and a nook's own copy sits on its one shelf.
const SHELF = { uuid: 'ab000000-0000-4000-8000-000000000001', name: 'Reading', color: '#7ba26c', is_public: true, is_default: true, position: 0, paper_count: 3, board_count: 0 };
const TAGS = ['control', 'wavefront', 'to cite'].map((name, i) => ({ uuid: `ae000000-0000-4000-8000-00000000000${i + 1}`, name }));
const DRAWER = { uuid: 'ab000000-0000-4000-8000-000000000002', name: 'Drafts', color: '#b07a4f', is_public: false, is_default: false, position: 1, paper_count: 0, board_count: 1 };
// The member's own boards, outside any project.
const nookBoard = (n, name, count, shelf, at) => ({ uuid: `ad000000-0000-4000-8000-00000000000${n}`, name, description: null, item_count: count, shelf_uuid: shelf.uuid, updated_at: at, owner: me, can_edit: true, items: [] });
// The time the member has spent on each of their papers, in the order the
// nook lists them; one they have not opened yet.
const EFFORT = [7500, 1260, 0];
const NOOK_BOARDS = [nookBoard(1, 'Thesis chapter 3 outline', 18, DRAWER, hoursAgo(5)), nookBoard(2, 'Wavefront sensors compared', 7, SHELF, daysAgo(3))];
const listed = (p, mine = false) => {
  const own = p.users.find((u) => u.user.uuid === ME);
  return {
    doi: p.doi, title: p.title, authors: p.authors, journal: p.journal, year: p.year, file_path: `papers/${p.sha256}.pdf`, sha256: p.sha256,
    created_at: p.added_at, summary: null, thought: mine ? own?.thought ?? null : null, is_public: mine ? true : null, is_author: mine ? false : null,
    rating_expertise: null, rating_reading: mine ? own?.rating_reading ?? null : null, rating_liking: mine ? own?.rating_liking ?? null : null,
    tags: [], shelf_uuid: mine ? SHELF.uuid : null, copy_uuid: mine ? `ac${p.sha256.slice(2, 8)}-0000-4000-8000-000000000001` : null, effort: null,
    users: p.users.map((u) => ({ user: u.user, is_author: false, thought: u.thought, rating_reading: u.rating_reading, rating_liking: u.rating_liking, rating_expertise: null, summary: null, tags: [] })),
  };
};

// Another member's nook as a visitor sees it: only public shelves, each
// paper with the owner's own take. Ana's is the full one the pictures use.
const THEIR_SHELVES = [
  { uuid: 'ab100000-0000-4000-8000-000000000001', name: 'Reading', color: '#7ba26c', is_public: true, is_default: true, position: 0 },
  { uuid: 'ab100000-0000-4000-8000-000000000002', name: 'Wavefront sensing', color: '#4f7cb0', is_public: true, is_default: false, position: 1 },
  { uuid: 'ab100000-0000-4000-8000-000000000003', name: 'Classics', color: '#b07a4f', is_public: true, is_default: false, position: 2 },
];
const THEIR_EXTRA = [
  { sha256: digest(0xb1), title: 'Adaptive optics for astronomy', authors: '["J. M. Beckers"]', journal: 'Annual Review of Astronomy and Astrophysics', year: 1993, shelf: 2, thought: 'Still the best first read.', rating_reading: 5, rating_liking: 5, days: 40 },
  { sha256: digest(0xb2), title: 'Wavefront sensing with a pyramid: a tutorial', authors: '["R. Ragazzoni"]', journal: 'Journal of Modern Optics', year: 1996, shelf: 1, thought: null, rating_reading: 4, rating_liking: 4, days: 20 },
  { sha256: digest(0xb3), title: 'Predictive control with a Kalman filter on the Keck AO system', authors: '["S. Cetre", "M. van Kooten", "R. Jensen-Clem"]', journal: 'SPIE', year: 2024, shelf: 0, thought: 'The tuning appendix is gold.', rating_reading: 3, rating_liking: 4, days: 2 },
  { sha256: digest(0xb4), title: 'Non-common path aberrations: a review', authors: '["N. Vigan", "K. Dohlen"]', journal: 'Astronomy & Astrophysics', year: 2019, shelf: 1, thought: null, rating_reading: 2, rating_liking: null, days: 12 },
];
function theirNook(owner) {
  const takes = papers.filter((p) => p.users.some((u) => u.user.uuid === owner.uuid)).map((p, i) => {
    const own = p.users.find((u) => u.user.uuid === owner.uuid);
    return { ...listed(p), shelf_uuid: THEIR_SHELVES[i % 2].uuid, is_public: true, thought: own.thought, rating_reading: own.rating_reading, rating_liking: own.rating_liking };
  });
  const extra = owner.uuid === ANA ? THEIR_EXTRA.map((x) => ({
    ...listed({ ...x, added_at: daysAgo(x.days), users: [{ user: owner, thought: x.thought, rating_reading: x.rating_reading, rating_liking: x.rating_liking }] }),
    shelf_uuid: THEIR_SHELVES[x.shelf].uuid, is_public: true, thought: x.thought, rating_reading: x.rating_reading, rating_liking: x.rating_liking,
  })) : [];
  const all = [...takes, ...extra].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const shelves = THEIR_SHELVES.slice(0, owner.uuid === ANA ? 3 : 1).map((s) => ({ ...s, paper_count: all.filter((p) => p.shelf_uuid === s.uuid).length, board_count: 0 }));
  const boards = owner.uuid === ANA ? [
    { uuid: 'ad100000-0000-4000-8000-000000000001', name: 'Sensor zoo', description: null, item_count: 12, shelf_uuid: THEIR_SHELVES[1].uuid, updated_at: daysAgo(4), owner, can_edit: false, items: [] },
    { uuid: 'ad100000-0000-4000-8000-000000000002', name: 'Thesis reading map', description: null, item_count: 31, shelf_uuid: THEIR_SHELVES[0].uuid, updated_at: daysAgo(15), owner, can_edit: false, items: [] },
  ] : [];
  return {
    user: owner, shelves, tags: [], stats: { papers: all.length, displayed: all.length, notes: 0 },
    papers: all, boards, projects: owner.uuid === ANA ? [summary] : [],
  };
}

// What the pretend server says to each request the pages make.
function answer(method, path, search) {
  if (path === '/auth/me') return { ...me, is_admin: false, email: 'dana@example.org' };
  if (path === '/notifications') {
    const note = (n, content, h, read) => ({ uuid: `fa000000-0000-4000-8000-00000000000${n}`, content, created_at: hoursAgo(h), read });
    return {
      notifications: [
        note(1, 'Ben Hall replied in your dig on “Error dynamics in adaptive optics loops”.', 3, false),
        note(2, 'Mia Tanaka joined Adaptive optics control.', 26, false),
        note(3, 'Ana Reyes added “A survey of predictive control for telescopes” to Adaptive optics control.', 24 * 6, true),
        note(4, 'Welcome to Papol, Dana Okafor—your paper-reading companion. Your nook is where you document your reading: upload the papers you read, rate them, and keep what you think of each.', 24 * 40, true),
      ],
      unread_count: 2,
    };
  }
  if (path === '/admin-messages/pending') return [];
  // A project started from the rail opens as the fixture's own.
  if (path === '/projects' && method === 'POST') return project;
  if (path === '/projects') return [summary, other, closed];
  if (path === `/projects/${PROJECT}`) return project;
  if (path === `/projects/${PROJECT}/people`) {
    const asked = (search?.get('q') ?? '').toLowerCase();
    return asked ? outsiders.filter((u) => u.display_name.toLowerCase().includes(asked)) : [];
  }
  if (path === `/projects/${PROJECT}/digs`) {
    const key = search.get('subject');
    const on = digs.filter((x) => x.subject.key === key);
    const mine = on.find((x) => x.is_mine)?.uuid ?? null;
    return { mine, digs: on, project: { uuid: PROJECT, name: project.name }, subject: on[0]?.subject ?? { key, kind: key.split(':')[0], label: 'A thing' } };
  }
  if (path === '/digs' && method === 'GET') {
    const key = search.get('subject');
    const on = personal.filter((x) => x.subject.key === key);
    return { mine: on[0]?.uuid ?? null, digs: on.map((d) => ({ uuid: d.uuid, owner: me, is_mine: true, post_count: 0 })), project: null, subject: on[0]?.subject ?? { key, kind: key.split(':')[0], label: 'A thing' } };
  }
  const dig = path.match(/^\/digs\/([0-9a-f-]+)$/);
  if (dig) {
    const own = personal.find((d) => d.uuid === dig[1]);
    return own ? personalOf(own) : digOf(dig[1]);
  }
  const nookBoardAsked = NOOK_BOARDS.find((b) => path === `/boards/${b.uuid}`);
  if (nookBoardAsked) {
    const onIt = nookBoardAsked === NOOK_BOARDS[1] ? papers.slice(0, 2) : [];
    const items = onIt.map((p, i) => ({ uuid: `ae00000${i}-0000-4000-8000-000000000001`, kind: 'excerpt', source_url: `https://papol.io/viewer/?pdf=${p.sha256}`, source_label: p.title, excerpt_text: null, content: null, x: 40 + i * 260, y: 60 + i * 40, width: 220, height: 140 }));
    return { ...nookBoardAsked, items, project: null, digs: {}, staged_items: [], papers: onIt.map(({ sha256, title, authors, year }) => ({ sha256, title, authors, year })), groups: [], revision: 1, user_uuid: ME, created_at: daysAgo(9) };
  }
  if (path === `/users/${ME}/nook`) {
    return {
      user: me, shelves: [{ ...SHELF, board_count: 1 }, DRAWER], tags: TAGS, stats: { papers: 3, displayed: 3, notes: 4 },
      papers: papers.filter((p) => p.in_my_nook).map((p, i) => ({
        ...listed(p, true), tags: [[TAGS[0]], [TAGS[0], TAGS[1]], [TAGS[2]]][i] ?? [],
        effort: EFFORT[i] ? { seconds: EFFORT[i], last_at: hoursAgo(3 + i * 20) } : null,
      })),
      boards: NOOK_BOARDS,
      projects: [summary, other],
    };
  }
  // Another member's nook, where their face leads: what they keep on
  // their public shelves, with their own takes, and their boards.
  const someone = [ana, ben, mia].find((u) => path === `/users/${u.uuid}/nook`);
  if (someone) return theirNook(someone);
  if (path === '/papers') return papers.map((p) => listed(p));
  const one = path.match(/^\/papers\/([0-9a-f]+)$/);
  if (one) {
    const found = papers.find((p) => p.sha256.startsWith(one[1])) ?? papers[1];
    return { ...listed(found, found.in_my_nook), in_nook: found.in_my_nook, also_read_by: found.users.filter((u) => u.user.uuid !== ME).map((u) => ({ ...u, is_author: false, tags: [] })), boards: [], projects: [], sharable_uuid: null };
  }
  // A paper's time, from its Effort in the nook: two sittings a day apart.
  const time = path.match(/^\/activity\/paper\/([0-9a-f]+)$/);
  if (time) {
    const at = (h, m) => new Date(Date.now() - h * 3_600_000 + m * 60_000).toISOString();
    return { sha256: time[1], seconds: 7500, first_at: at(28, 0), last_at: at(3, 0), spans: [
      { kind: 'paper', subject: time[1], started_at: at(28, 0), ended_at: at(28, 75), seconds: 4500 },
      { kind: 'paper', subject: time[1], started_at: at(4, 10), ended_at: at(4, 60), seconds: 3000 },
    ] };
  }
  // The member's week of reading, on their own page: a sitting or two a
  // day on the fixture papers, the same every time.
  if (path.startsWith('/activity')) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const spans = [];
    for (let back = 6; back >= 0; back -= 1) {
      [[9.5, 70], [14, 45 + back * 5]].forEach(([hour, minutes], i) => {
        const start = new Date(today.getTime() - back * 86_400_000 + hour * 3_600_000);
        const end = new Date(Math.min(start.getTime() + minutes * 60_000, Date.now()));
        if (end <= start) return;
        const subject = papers[(back + i) % papers.length].sha256;
        spans.push({ kind: 'paper', subject, started_at: start.toISOString(), ended_at: end.toISOString(), seconds: Math.round((end - start) / 1000) });
      });
    }
    return { spans, papers: Object.fromEntries(papers.map((p) => [p.sha256, { title: p.title, in_nook: true }])), first_at: spans[0]?.started_at ?? null };
  }
  // A PDF dropped on the window: stored at once, and known to the indexes.
  if (path === '/files/upload-address') return { stored: true, file_path: `${'f'.repeat(64)}.pdf` };
  if (path === '/papers/lookup') return { doi: '10.48550/arXiv.1706.03762', title: 'Attention Is All You Need', authors: '["Ashish Vaswani","Noam Shazeer","Niki Parmar"]', journal: 'NeurIPS', year: 2017 };
  if (path === '/papers/uploaded') return { job: null, file_path: `${'f'.repeat(64)}.pdf`, sha256: 'f'.repeat(64) };
  if (path === '/tags' || path === '/boards' || path === '/library/boards') return [];
  if (path === '/users') return [me, ana, ben, mia].map((u) => ({ ...u, paper_count: 2 }));
  if (path === '/shelves') return [SHELF, DRAWER];
  if (path.startsWith('/client-requirements') || path.startsWith('/compat')) return { ok: true };
  return method === 'GET' ? {} : { ok: true };
}

// Paths the pretend server leaves unanswered, so a picture can show a
// page while it waits for them.
export const held = new Set();

function projectFixture(server) {
  server.middlewares.use('/api', (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (held.has(url.pathname)) return;
    const body = answer(req.method, url.pathname, url.searchParams);
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = body === null ? 404 : 200;
    res.end(JSON.stringify(body ?? { error: 'Not found' }));
  });
}

// The tab is a member's before the app loads: a token where the app keeps
// it, and no Mac banner.
const signIn = () => ({
  name: 'project-fixture-sign-in',
  transformIndexHtml: (html) => html.replace('<head>', `<head><script>
    localStorage.setItem('papol_token', 'fixture');
    localStorage.setItem('papol.macosDownloadBannerDismissed', '1');
  </script>`),
});

// A Vite server for the frontend with the project on it, not yet listening.
export function projectServer() {
  return createServer({
    root: fileURLToPath(new URL('../..', import.meta.url)),
    server: { host: '127.0.0.1', port: 0 },
    plugins: [signIn(), { name: 'project-fixture', configureServer: projectFixture }],
  });
}
