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
const BOARD_BUDGET = 'c1b2c3d4-0000-4000-8000-000000000022';
const CARD_SPARSE = 'd1b2c3d4-0000-4000-8000-000000000030';
export const DIG_PAPER = 'e1b2c3d4-0000-4000-8000-000000000040';
const DIG_CARD = 'e1b2c3d4-0000-4000-8000-000000000041';
const DIG_SURVEY = 'e1b2c3d4-0000-4000-8000-000000000044';
const DIG_PAPER_MIA = 'e1b2c3d4-0000-4000-8000-000000000049';
const DIG_PAPER_BEN = 'e1b2c3d4-0000-4000-8000-000000000045';

const user = (uuid, display_name, affiliation) => ({ uuid, display_name, affiliation, avatar_path: null, email: null });
const me = { ...user(ME, 'Dana Okafor', 'Leiden Observatory'), online: true };
const ana = { ...user(ANA, 'Ana Reyes', 'ESO'), online: true };
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
const TAG_METHODS = { uuid: 'ab200000-0000-4000-8000-000000000001', name: 'methods' };
const TAG_BENCH = { uuid: 'ab200000-0000-4000-8000-000000000002', name: 'bench' };
const TAG_BACKGROUND = { uuid: 'ab200000-0000-4000-8000-000000000003', name: 'background' };

const papers = [
  {
    sha256: P_LEARN, title: 'Learning wavefront control from few examples', authors: "[\"R. Gomez\", \"T. Lindqvist\", \"P. Ferreira\"]",
    journal: 'Nature Photonics', year: 2025, doi: null, added_by: ben, added_at: hoursAgo(5), is_new: true, in_my_nook: false,
    users: [{ user: ben, thought: 'Worth trying on the bench this month.', rating_reading: 3, rating_liking: 4 }],
    board_uuids: [BOARD_PLAN], tags: [TAG_METHODS, TAG_BENCH],
  },
  {
    sha256: P_ERROR, title: 'Error dynamics in adaptive optics loops', authors: "[\"L. Chen\", \"M. Patel\"]",
    journal: 'Optics Letters', year: 2024, doi: null, added_by: me, added_at: daysAgo(3), is_new: false, in_my_nook: true,
    users: [
      { user: ana, thought: 'Section 3 is where our model breaks.', rating_reading: 4, rating_liking: 3 },
      { user: me, thought: 'The clearest account of why the loop lags.', rating_reading: 4, rating_liking: 4 },
      { user: ben, thought: null, rating_reading: 2, rating_liking: null },
    ],
    board_uuids: [BOARD_PLAN, BOARD_MAP], tags: [TAG_METHODS],
  },
  {
    sha256: P_SURVEY, title: 'A survey of predictive control for telescopes', authors: "[\"S. Olsen\"]",
    journal: 'Annual Review of Astronomy and Astrophysics', year: 2023, doi: null, added_by: ana, added_at: daysAgo(6), is_new: false, in_my_nook: true,
    users: [{ user: ana, thought: 'Skim §4 and §7; the rest is history.', rating_reading: 5, rating_liking: 3 }, { user: me, thought: null, rating_reading: 1, rating_liking: null }],
    board_uuids: [BOARD_MAP], tags: [TAG_BACKGROUND],
  },
  {
    sha256: P_PYRAMID, title: 'Pyramid wavefront sensing under strong scintillation', authors: "[\"K. Nakamura\", \"J. Vidal\", \"A. Rossi\", \"H. Berger\"]",
    journal: 'Journal of Astronomical Telescopes, Instruments, and Systems', year: 2022, doi: null, added_by: ana, added_at: daysAgo(9), is_new: false, in_my_nook: false,
    users: [{ user: ana, thought: null, rating_reading: 3, rating_liking: null }],
    board_uuids: [], tags: [TAG_BENCH],
  },
  {
    sha256: P_VIBES, title: 'Vibration rejection with learned disturbance models', authors: "[\"F. Moreau\", \"D. Okafor\"]",
    journal: null, year: 2026, doi: null, added_by: mia, added_at: hoursAgo(26), is_new: true, in_my_nook: true,
    users: [{ user: mia, thought: 'Our own preprint, for the record.', rating_reading: 5, rating_liking: 4 }, { user: me, thought: null, rating_reading: 5, rating_liking: null }],
    board_uuids: [], tags: [],
  },
];

// Papers in the member's nook that the project does not hold yet, for
// Add papers to offer; and the PDF a picture drops on the page.
const NOOK_ONLY = [
  { sha256: digest(0xc1), title: 'Wavefront reconstruction with neural networks on Shack-Hartmann data', authors: '["Y. Zhang", "R. Gomez"]', journal: 'Optics Express', year: 2024, added_at: daysAgo(14) },
  { sha256: digest(0xc2), title: 'Kalman filtering for tip-tilt control at the VLT', authors: '["C. Petit", "J.-M. Conan", "C. Kulcsár"]', journal: 'JOSA A', year: 2021, added_at: daysAgo(25) },
  { sha256: digest(0xc3), title: 'Reinforcement learning for adaptive optics control', authors: '["J. Nousiainen", "C. Rajani", "M. Kasper"]', journal: 'Optics Express', year: 2022, added_at: daysAgo(31) },
  { sha256: digest(0xc4), title: 'Telescope vibrations: sources, measurement and mitigation', authors: '["M. Kasper"]', journal: 'SPIE', year: 2019, added_at: daysAgo(48) },
].map((p) => ({ ...p, doi: null, users: [{ user: me, thought: null, rating_reading: null, rating_liking: null }] }));
const DROPPED = { sha256: 'f'.repeat(64), title: 'Attention Is All You Need', authors: '["Ashish Vaswani","Noam Shazeer","Niki Parmar"]', journal: 'NeurIPS', year: 2017, doi: '10.48550/arXiv.1706.03762', users: [] };

// Each board as the project lists it, latest first: known by its
// description and who last put something there.
const latest = (text, kind, by, at) => ({ text, kind, added_by: by, added_at: at });
const boards = [
  {
    uuid: BOARD_MAP, name: 'Attention variants map', description: 'Compare the controller families worth taking to the bench.', owner: ana, item_count: 5, created_at: daysAgo(6), updated_at: hoursAgo(1), is_new: true,
    latest_card: latest('Linear attention loses the long-range term we need for tip-tilt; keep the sparse variant for now.', 'comment', ana, hoursAgo(1)),
  },
  {
    uuid: BOARD_PLAN, name: 'Bench plan', description: 'Turn the strongest candidates into a repeatable experiment.', owner: me, item_count: 12, created_at: daysAgo(9), updated_at: hoursAgo(2),
    latest_card: latest('Measure the loop delay before tuning the integrator gain', 'comment', me, hoursAgo(2)),
  },
  {
    uuid: BOARD_BUDGET, name: 'Error budget', description: 'Account for the limits that decide whether prediction helps.', owner: ben, item_count: 7, created_at: daysAgo(12), updated_at: daysAgo(3),
    latest_card: latest('The servo-lag term dominates above 40 Hz; fitting error is flat across every run we have.', 'excerpt', ben, daysAgo(3)),
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
  { uuid: DIG_PAPER_MIA, owner: mia, is_mine: false, phase: 'stashed', text: 'Their turbulence model is the wrong one for our site.', subject: subject.paperError, post_count: 0, unread: 0, is_new: false, voices: [mia], updated_at: daysAgo(2), created_at: daysAgo(2), last_post: { user: mia, excerpt: 'Their turbulence model is the wrong one for our site.', created_at: daysAgo(2) } },
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
    { user: ana, is_keeper: false, joined_at: daysAgo(19) },
    { user: ben, is_keeper: false, joined_at: daysAgo(12) },
    { user: mia, is_keeper: false, joined_at: daysAgo(2) },
  ],
  is_member: true, is_keeper: true, invite_code: 'Ab3dE5gH7j',
  boards, digs, papers, tags: [TAG_BACKGROUND, TAG_BENCH, TAG_METHODS],
};

const summary = { uuid: PROJECT, name: project.name, created_at: project.created_at, members: project.members, is_member: true, is_keeper: true, new_count: 3 };
const other = { uuid: 'b1b2c3d4-0000-4000-8000-000000000011', name: 'Reading group', created_at: daysAgo(60), members: [{ user: me, is_keeper: false, joined_at: daysAgo(60) }, { user: mia, is_keeper: true, joined_at: daysAgo(60) }], is_member: true, is_keeper: false, new_count: 0 };
// A project the member is not in, as the Projects page lists it.
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

const reports = [];
const REPORT = (() => {
  const sentAt = Date.parse('2026-09-30T14:02:10Z');
  const step = (s, kind, what) => ({ at: sentAt - s * 1000, kind, what });
  return {
    uuid: 'fb000000-0000-4000-8000-000000000000',
    content: 'The rule boxes on page 7 cover the premises of T-App, so I cannot read them.',
    page: `/viewer/${P_ERROR}`,
    context: {
      app: 'viewer', runtime: 'web', window: null, version: 'd75b409', page: `/viewer/${P_ERROR}`,
      title: 'Error dynamics in adaptive optics loops', project: 'Adaptive optics control',
      viewport: '1440×900 at 2x', browser: 'Chrome 131', system: 'macOS', language: 'en-GB', online: true, sent_at: sentAt,
      trail: [
        step(412, 'open', '/'),
        step(398, 'click', 'link "Adaptive optics control" /project/' + PROJECT),
        step(390, 'open', '/project/' + PROJECT),
        step(371, 'click', 'button "Read"'),
        step(366, 'open', `/viewer/${P_ERROR}`),
        step(122, 'click', 'div.telescope'),
        step(95, 'error', 'TypeError: Cannot read properties of undefined (reading \'box\')'),
        step(40, 'click', 'button "Feedback"'),
      ],
    },
    contact: null, resolved: false, created_at: '2026-09-30T14:02:11', user: me, user_email: 'dana@example.org',
  };
})();

let deleted = false;

// What the pretend server says to each request the pages make.
// Friends, and the Common room made from them. Ana and Ben are the
// member's friends; Mia has asked; Marta is someone Papol suggests, and the
// owner of the friend link the fixture answers for.
const FRIEND_DIG = 'e1b2c3d4-0000-4000-8000-000000000060';
const friendDig = {
  uuid: FRIEND_DIG, created_at: hoursAgo(7), updated_at: hoursAgo(2), edited_at: null, project: null, subject: subject.paperSurvey, owner: ana, is_mine: false,
  text: 'Section 4 undersells the pyramid sensor: the gain they quote is for a point source. I think the comparison flips for our extended guide star.',
  phase: 'digging', can_moderate: false, can_post: true,
  posts: [post('f1000000-0000-4000-8000-000000000060', ben, 'It does flip. Table 3 in the Nakamura paper has the extended case.', hoursAgo(2), false)],
};
const friendDigListed = { uuid: FRIEND_DIG, project_uuid: null, created_at: friendDig.created_at, updated_at: friendDig.updated_at, owner: ana, is_mine: false, text: friendDig.text, excerpt: friendDig.text, phase: 'digging', subject: subject.paperSurvey, post_count: 1, unread: 0, is_new: false, voices: [ana, ben], last_post: { user: ben, excerpt: friendDig.posts[0].body, created_at: hoursAgo(2) } };
const paperOut = (p) => ({ sha256: p.sha256, title: p.title, authors: p.authors, year: p.year, journal: p.journal });
const friendState = () => ({ friends: [{ user: ana, since: daysAgo(30) }, { user: ben, since: daysAgo(12) }], requests: [{ user: mia, asked_at: hoursAgo(4), common: [paperOut(papers[1]), paperOut(papers[2])] }], sent: [], link: 'Fr13ndL1nk', shares_reading: false });
let friendsNow = friendState();
const BATCH = [
  ['Deformable mirror fitting error at high actuator count', '["P. Madec"]', 2021, 'Applied Optics'],
  ['Kalman filtering for tip-tilt in extremely large telescopes', '["C. Kulcsar", "H.-F. Raynaud"]', 2020, 'JOSA A'],
  ['Reinforcement learning for adaptive optics: a first on-sky test', '["J. Nousiainen"]', 2024, 'Astronomy & Astrophysics'],
  ['Open-loop tomography with laser guide stars', '["E. Gendron"]', 2019, 'Astronomy & Astrophysics'],
  ['Frozen flow, measured: wind profiles from telemetry', '["L. Poyneer"]', 2018, 'JOSA A'],
  ['Predictive control on the Keck bench', '["S. Cetre"]', 2023, 'Proc. SPIE'],
  ['A data-driven integrator gain schedule', '["B. Neichel"]', 2022, 'MNRAS'],
].map(([title, authors, year, journal], i) => ({ sha256: digest(0xc0 + i), title, authors, year, journal }));
const roomRows = (view) => {
  const line = (user, did, at, more = {}) => ({ user, did, at, words: null, ratings: null, dig: null, ...more });
  const rows = [
    { kind: 'paper', key: `paper:${P_SURVEY}`, paper: paperOut(papers[2]), in_my_nook: true, at: hoursAgo(2), is_new: true, lines: [
      line(ben, 'posted', hoursAgo(2), { words: friendDig.posts[0].body, dig: { uuid: FRIEND_DIG, page: null, on: 'paper', owner: ana, post_count: 1 } }),
      line(ana, 'dug', hoursAgo(7), { words: friendDig.text, dig: { uuid: FRIEND_DIG, page: null, on: 'paper', owner: ana, post_count: 1 } }),
    ] },
    { kind: 'paper', key: `paper:${P_LEARN}`, paper: paperOut(papers[0]), in_my_nook: false, at: hoursAgo(5), is_new: true, lines: [
      line(ben, 'thought', hoursAgo(5), { words: 'Worth trying on the bench this month.' }),
      line(ben, 'rated', hoursAgo(5), { ratings: { expertise: null, reading: 3, liking: 4 } }),
      line(ana, 'added', hoursAgo(30)),
      ...(view === 'everyone' ? [line(mia, 'added', daysAgo(2))] : []),
    ] },
    { kind: 'friend', key: `friend:${BEN}`, user: ben, at: daysAgo(1), is_new: false },
    { kind: 'batch', key: `batch:${ANA}`, user: ana, papers: BATCH, at: daysAgo(3), is_new: false },
    { kind: 'board', key: 'board:1', user: ana, board: { uuid: BOARD_MAP, name: 'Wavefront sensors compared', description: null, item_count: 7 }, at: daysAgo(4), is_new: false },
    { kind: 'paper', key: `paper:${P_PYRAMID}`, paper: paperOut(papers[3]), in_my_nook: false, at: daysAgo(9), is_new: false, lines: [
      line(ana, 'reading', daysAgo(1)),
      line(ana, 'rated', daysAgo(9), { ratings: { expertise: null, reading: 3, liking: null } }),
    ] },
    { kind: 'project', key: `project:${closed.uuid}`, project: { uuid: closed.uuid, name: closed.name, description: 'Which sensor for which seeing.', member_count: 3, is_member: false, asked: false }, at: daysAgo(11), is_new: false, lines: [{ user: ana, did: 'joined', at: daysAgo(11) }] },
  ];
  return view === 'everyone' ? [
    { kind: 'paper', key: `paper:${P_VIBES}`, paper: paperOut(papers[4]), in_my_nook: false, at: hoursAgo(1), is_new: true, lines: [line(outsiders[0], 'added', hoursAgo(1)), line(mia, 'thought', hoursAgo(1.5), { words: 'The disturbance model is the part to steal.' })] },
    ...rows.map((row) => (row.kind === 'paper' ? { ...row, lines: row.lines.map((l) => (l.dig ? { ...l, did: 'added', words: null, dig: null } : l)).filter((l, i, all) => all.findIndex((o) => o.user === l.user && o.did === l.did) === i) } : row)).filter((row) => row.kind !== 'friend'),
  ] : rows;
};
const mostRead = (view) => [
  { kind: 'paper', key: `paper:${P_LEARN}`, paper: paperOut(papers[0]), in_my_nook: false, at: hoursAgo(5), is_new: false, lines: [ben, ana, ...(view === 'everyone' ? [mia, outsiders[0]] : [])].map((user) => ({ user, did: 'added', at: daysAgo(2), words: null, ratings: null, dig: null })) },
  { kind: 'paper', key: `paper:${P_PYRAMID}`, paper: paperOut(papers[3]), in_my_nook: false, at: daysAgo(9), is_new: false, lines: [ana, ...(view === 'everyone' ? [mia] : [])].map((user) => ({ user, did: 'added', at: daysAgo(9), words: null, ratings: null, dig: null })) },
  { kind: 'paper', key: `paper:${P_VIBES}`, paper: paperOut(papers[4]), in_my_nook: false, at: daysAgo(3), is_new: false, lines: [view === 'everyone' ? outsiders[0] : ben].map((user) => ({ user, did: 'added', at: daysAgo(3), words: null, ratings: null, dig: null })) },
];

function answer(method, path, search, sent = {}) {
  // Each picture loads the app afresh: the project is back.
  if (path === '/auth/me') { deleted = false; friendsNow = friendState(); }
  // Friends: what the member's friends say now, changed by each answer.
  if (path === '/friends' || path === '/friends/settings' || path === '/friends/link') {
    if (path === '/friends/settings') friendsNow.shares_reading = Boolean(sent.shares_reading);
    if (path === '/friends/link') friendsNow.link = method === 'DELETE' ? null : 'N3wFr13nd0';
    return friendsNow;
  }
  const friendAct = path.match(/^\/friends\/([0-9a-f-]{36})(\/accept|\/decline)?$/);
  if (friendAct) {
    const who = [ana, ben, mia, ...outsiders].find((u) => u.uuid === friendAct[1]);
    const asked = friendsNow.requests.find((r) => r.user.uuid === friendAct[1]);
    if (friendAct[2] === '/accept' && asked) friendsNow.friends.push({ user: asked.user, since: hoursAgo(0) });
    if (friendAct[2]) friendsNow.requests = friendsNow.requests.filter((r) => r !== asked);
    else if (method === 'POST' && who) friendsNow.sent.push(who.uuid);
    else if (method === 'DELETE') {
      friendsNow.sent = friendsNow.sent.filter((uuid) => uuid !== friendAct[1]);
      friendsNow.friends = friendsNow.friends.filter((f) => f.user.uuid !== friendAct[1]);
    }
    return friendsNow;
  }
  if (path.startsWith('/friend-links/')) return { user: outsiders[0], is_me: false, is_friend: method === 'POST' };
  if (path === '/room/news') return { news: true, requests: friendsNow.requests.length };
  if (path === '/room') {
    const view = search.get('view') === 'everyone' ? 'everyone' : 'friends';
    const order = search.get('order') === 'most' ? 'most' : 'latest';
    return {
      view, order, friend_count: friendsNow.friends.length, seen_at: daysAgo(1), requests: friendsNow.requests, since: daysAgo(28),
      suggestions: [{ user: outsiders[0], reason: 'Reads 3 papers you read' }],
      rows: order === 'most' ? mostRead(view) : roomRows(view),
    };
  }
  if (/^\/papers\/[0-9a-f]+\/friend-digs$/.test(path)) return { digs: P_SURVEY.startsWith(path.split('/')[2]) ? [friendDigListed] : [] };
  if (path === `/digs/${FRIEND_DIG}`) return friendDig;
  if (path === `/digs/${FRIEND_DIG}/posts` && method === 'POST') {
    friendDig.posts.push(post(`f1000000-0000-4000-8000-0000000000${60 + friendDig.posts.length}`, me, sent.body, hoursAgo(0), true));
    return friendDig;
  }
  if (path === '/auth/me') return { ...me, is_admin: process.env.PAPOL_ADMIN === '1', email: 'dana@example.org' };
  if (path === '/notifications') {
    const note = (n, content, h, read, more = {}) => ({ uuid: `fa000000-0000-4000-8000-00000000000${n}`, content, created_at: hoursAgo(h), read, kind: null, link: null, actor: null, ...more });
    return {
      notifications: [
        note(5, 'Mia Tanaka asks to be friends.', 4, false, { kind: 'friend_request', link: `/u/${MIA}`, actor: mia, waiting: true }),
        note(6, 'Ben Hall posted in your dig on “A survey of predictive control for telescopes”.', 2, false, { kind: 'dig_post', link: `/paper/${P_SURVEY.slice(0, 32)}`, actor: ben }),
        note(1, 'Ben Hall replied in your dig on “Error dynamics in adaptive optics loops”.', 3, false),
        note(2, 'Mia Tanaka joined Adaptive optics control.', 26, false),
        note(3, 'Ana Reyes added “A survey of predictive control for telescopes” to Adaptive optics control.', 24 * 6, true),
        note(4, 'Welcome to Papol, Dana Okafor—your paper-reading companion. Your nook is where you document your reading: upload the papers you read, rate them, and keep what you think of each.', 24 * 40, true),
      ],
      unread_count: 4,
    };
  }
  if (path === '/admin-messages/pending') return [];
  // Reports as the admin page lists them: whatever the pages sent in this
  // visit, else one sent from the viewer with the steps before it.
  if (path === '/feedback' && method === 'POST') {
    const report = { uuid: `fb000000-0000-4000-8000-00000000000${reports.length + 1}`, ...sent, resolved: false, created_at: hoursAgo(0).slice(0, 19), user: me, user_email: 'dana@example.org' };
    reports.unshift(report);
    return report;
  }
  if (path === '/admin/feedback') return reports.length ? reports : [REPORT];
  if (path === '/admin/message-recipients') return [];
  if (path === '/admin/tables') return { tables: [] };
  if (path === '/admin/emails') return { configured: true, sends: [] };
  // A board started from the rail lands on the default shelf, newest first.
  if (path === '/boards' && method === 'POST') {
    const made = { ...nookBoard(3, sent.name, 0, SHELF, new Date().toISOString()) };
    NOOK_BOARDS.unshift(made);
    return made;
  }
  // A project started from the rail opens as the fixture's own.
  if (path === '/projects' && method === 'POST') return project;
  if (path === '/projects') return deleted ? [other, closed] : [summary, other, closed];
  // A keeper deleting the project: gone from the lists for the rest of
  // the visit, as the server has it.
  if (path === `/projects/${PROJECT}` && method === 'DELETE') { deleted = true; return { message: 'Project deleted' }; }
  if (path === `/projects/${PROJECT}`) return project;
  // A paper added from the nook or dropped on the page: the project with it
  // first, as the server answers. Nothing is kept, so each picture starts
  // from the same project.
  if (path === `/projects/${PROJECT}/papers` && method === 'POST') {
    const found = [...NOOK_ONLY, DROPPED].find((p) => p.sha256 === sent.paper_sha256);
    if (!found || papers.some((p) => p.sha256 === found.sha256)) return project;
    return { ...project, papers: [{ ...found, added_by: me, added_at: new Date().toISOString(), is_new: false, in_my_nook: true, board_uuids: [], tags: [] }, ...papers] };
  }
  if (path === `/projects/${PROJECT}/people`) {
    const asked = (search?.get('q') ?? '').toLowerCase();
    return asked ? outsiders.filter((u) => u.display_name.toLowerCase().includes(asked)) : [];
  }
  // A dig written in the pictures: the member's own, kept for the visit.
  if (path === `/projects/${PROJECT}/digs` && method === 'POST') {
    const at = new Date().toISOString();
    const made = { uuid: `d9100000-0000-4000-8000-${String(digs.length).padStart(12, '0')}`, owner: me, is_mine: true, phase: 'digging', text: sent.text, subject: { key: sent.subject, kind: sent.subject.split(':')[0], label: 'A thing' }, post_count: 0, unread: 0, is_new: false, voices: [me], updated_at: at, created_at: at, last_post: { user: me, excerpt: sent.text, created_at: at } };
    const paperOf = Object.values(subject).find((x) => x.key === sent.subject);
    if (paperOf) made.subject = paperOf;
    digs.push(made);
    return digOf(made.uuid);
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
  // A project's board, as any member reads it: it is on the project.
  const projectBoardAsked = boards.find((b) => path === `/boards/${b.uuid}`);
  if (projectBoardAsked) {
    const onIt = papers.slice(0, 2);
    const items = onIt.map((p, i) => ({ uuid: `af00000${i}-0000-4000-8000-000000000001`, kind: 'excerpt', source_url: `https://papol.io/viewer/?pdf=${p.sha256}`, source_label: p.title, excerpt_text: null, content: null, x: 40 + i * 260, y: 60 + i * 40, width: 220, height: 140 }));
    return { ...projectBoardAsked, items, project: { uuid: PROJECT, name: summary.name }, digs: {}, staged_items: [], papers: onIt.map(({ sha256, title, authors, year }) => ({ sha256, title, authors, year })), groups: [], revision: 1, user_uuid: projectBoardAsked.owner.uuid, can_edit: true, created_at: daysAgo(9) };
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
      })).concat(NOOK_ONLY.map((p, i) => ({
        ...listed(p, true),
        // Read at a spread of ages, so the desk shows each step of how long
        // ago a paper was last read.
        effort: [{ seconds: 2400, last_at: daysAgo(5) }, { seconds: 900, last_at: daysAgo(18) }, { seconds: 3600, last_at: daysAgo(60) }, { seconds: 600, last_at: daysAgo(200) }][i] ?? null,
      }))),
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
// page while it waits for them. A path ending in * holds every path under it.
export const held = new Set();
const isHeld = (path) => [...held].some((each) => (each.endsWith('*') ? path.startsWith(each.slice(0, -1)) : each === path));

function projectFixture(server) {
  server.middlewares.use('/api', (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (isHeld(url.pathname)) return;
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      let sent = {};
      try { sent = raw ? JSON.parse(raw) : {}; } catch { sent = {}; }
      const body = answer(req.method, url.pathname, url.searchParams, sent);
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = body === null ? 404 : 200;
      res.end(JSON.stringify(body ?? { error: 'Not found' }));
    });
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
