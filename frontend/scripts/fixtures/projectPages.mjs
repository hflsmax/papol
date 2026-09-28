import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// The pages inside a project (the desk, a brief, a dig), as the real app
// renders them at their real addresses, over a pretend server: a Vite
// server for the frontend that answers `/api/…` itself with one made-up
// project, and signs the tab in as one of its members before the app
// loads. No account or Worker is needed. `?shell=desktop` shows the Mac
// shell around the same pages. project-shots.mjs photographs them.

const ME = 'a1b2c3d4-0000-4000-8000-000000000001';
const ANA = 'a1b2c3d4-0000-4000-8000-000000000002';
const BEN = 'a1b2c3d4-0000-4000-8000-000000000003';
const MIA = 'a1b2c3d4-0000-4000-8000-000000000004';
export const PROJECT = 'b1b2c3d4-0000-4000-8000-000000000010';
const BOARD_PLAN = 'c1b2c3d4-0000-4000-8000-000000000020';
const BOARD_MAP = 'c1b2c3d4-0000-4000-8000-000000000021';
const CARD_SPARSE = 'd1b2c3d4-0000-4000-8000-000000000030';
export const DIG_PAPER = 'e1b2c3d4-0000-4000-8000-000000000040';
const DIG_CARD = 'e1b2c3d4-0000-4000-8000-000000000041';
const DIG_BOARD = 'e1b2c3d4-0000-4000-8000-000000000042';
const DIG_TAKE = 'e1b2c3d4-0000-4000-8000-000000000043';
const DIG_SURVEY = 'e1b2c3d4-0000-4000-8000-000000000044';

const user = (uuid, display_name, affiliation) => ({ uuid, display_name, affiliation, avatar_path: null, email: null });
const me = user(ME, 'Dana Okafor', 'Leiden Observatory');
const ana = user(ANA, 'Ana Reyes', 'ESO');
const ben = user(BEN, 'Ben Hall', 'Leiden Observatory');
const mia = user(MIA, 'Mia Tanaka', 'Subaru Telescope');

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
    uuid: BOARD_MAP, name: 'Attention variants map', description: null, owner: ana, item_count: 5, updated_at: daysAgo(4),
    boxes: [box(0, 0, 300, 145, 'excerpt'), box(360, 0, 300, 145, 'excerpt'), box(180, 200, 300, 112), box(540, 220, 300, 180, 'image'), box(0, 260, 300, 112)],
  },
];

const subject = {
  paperError: { key: `paper:${P_ERROR}`, kind: 'paper', paper_sha256: P_ERROR, label: 'Error dynamics in adaptive optics loops' },
  paperSurvey: { key: `paper:${P_SURVEY}`, kind: 'paper', paper_sha256: P_SURVEY, label: 'A survey of predictive control for telescopes' },
  card: { key: `card:${CARD_SPARSE}`, kind: 'card', board_item_uuid: CARD_SPARSE, board_uuid: BOARD_PLAN, board_name: 'Bench plan', card_kind: 'comment', label: 'Sparse attention at long context' },
  board: { key: `board:${BOARD_PLAN}`, kind: 'board', board_uuid: BOARD_PLAN, board_name: 'Bench plan', label: 'Bench plan' },
  take: { key: `take:${P_LEARN}:${BEN}`, kind: 'take', paper_sha256: P_LEARN, user_uuid: BEN, paper_title: 'Learning wavefront control from few examples', label: '“Worth trying on the bench this month.”', by: 'Ben Hall' },
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

const discussions = [
  { uuid: DIG_PAPER, subject: subject.paperError, post_count: 3, unread: 1, is_new: true, voices: [ana, me, ben], updated_at: hoursAgo(3), created_at: daysAgo(2), last_post: { user: ben, excerpt: errorPosts[2].body, created_at: hoursAgo(3) } },
  { uuid: DIG_TAKE, subject: subject.take, post_count: 2, unread: 2, is_new: true, voices: [mia, ana], updated_at: hoursAgo(4), created_at: hoursAgo(5), last_post: { user: mia, excerpt: 'This month? We have not measured the delay yet.', created_at: hoursAgo(4) } },
  { uuid: DIG_CARD, subject: subject.card, post_count: 4, unread: 0, is_new: false, voices: [me, ben], updated_at: hoursAgo(20), created_at: daysAgo(2), last_post: { user: ben, excerpt: 'Before we try this, what does "few-shot" mean on our bench? Their examples are 200 open-loop frames, which we can record in an afternoon.', created_at: hoursAgo(20) } },
  { uuid: DIG_BOARD, subject: subject.board, post_count: 1, unread: 0, is_new: false, voices: [ana], updated_at: daysAgo(3), created_at: daysAgo(3), last_post: { user: ana, excerpt: 'Should this board be in the order we will run things?', created_at: daysAgo(3) } },
  { uuid: DIG_SURVEY, subject: subject.paperSurvey, post_count: 5, unread: 0, is_new: false, voices: [me, ana, ben], updated_at: daysAgo(5), created_at: daysAgo(6), last_post: { user: me, excerpt: 'Dug into Sparse attention at long context', created_at: daysAgo(5) } },
];

const project = {
  uuid: PROJECT, name: 'Adaptive optics control', created_at: daysAgo(20),
  members: [
    { user: me, is_keeper: true, joined_at: daysAgo(20) },
    { user: ana, is_keeper: true, joined_at: daysAgo(19) },
    { user: ben, is_keeper: false, joined_at: daysAgo(12) },
    { user: mia, is_keeper: false, joined_at: daysAgo(2) },
  ],
  is_member: true, is_keeper: true, invite_code: 'Ab3dE5gH7j',
  boards, discussions, papers,
};

const summary = { uuid: PROJECT, name: project.name, created_at: project.created_at, members: project.members, is_member: true, is_keeper: true, new_count: 3 };
const other = { uuid: 'b1b2c3d4-0000-4000-8000-000000000011', name: 'Reading group', created_at: daysAgo(60), members: [{ user: me, is_keeper: false, joined_at: daysAgo(60) }, { user: mia, is_keeper: true, joined_at: daysAgo(60) }], is_member: true, is_keeper: false, new_count: 0 };

const discussion = (uuid) => {
  const d = discussions.find((x) => x.uuid === uuid);
  if (!d) return null;
  const posts = uuid === DIG_PAPER ? errorPosts : [post(`f1000000-0000-4000-8000-${uuid.slice(-12)}`, d.last_post.user, d.last_post.excerpt, d.last_post.created_at, d.last_post.user.uuid === ME)];
  return { uuid, created_at: d.created_at, updated_at: d.updated_at, project: { uuid: PROJECT, name: project.name }, subject: d.subject, can_moderate: true, posts };
};

// A paper as the Library and a nook list it: the members' takes are the
// users shown against it, and a nook's own copy sits on its one shelf.
const SHELF = { uuid: 'ab000000-0000-4000-8000-000000000001', name: 'Reading', color: '#7ba26c', is_public: true, is_default: true, position: 0, paper_count: 3, board_count: 0 };
const listed = (p, mine = false) => {
  const own = p.users.find((u) => u.user.uuid === ME);
  return {
    doi: p.doi, title: p.title, authors: p.authors, journal: p.journal, year: p.year, file_path: `papers/${p.sha256}.pdf`, sha256: p.sha256,
    created_at: p.added_at, summary: null, thought: mine ? own?.thought ?? null : null, is_public: mine ? true : null, is_author: mine ? false : null,
    rating_expertise: null, rating_reading: mine ? own?.rating_reading ?? null : null, rating_liking: mine ? own?.rating_liking ?? null : null,
    room_status: null, tags: [], shelf_uuid: mine ? SHELF.uuid : null, copy_uuid: mine ? `ac${p.sha256.slice(2, 8)}-0000-4000-8000-000000000001` : null, effort: null,
    users: p.users.map((u) => ({ user: u.user, is_author: false, thought: u.thought, rating_reading: u.rating_reading, rating_liking: u.rating_liking, rating_expertise: null, summary: null, tags: [] })),
  };
};

// What the pretend server says to each request the pages make.
function answer(method, path, search) {
  if (path === '/auth/me') return { ...me, is_admin: false, email: 'dana@example.org' };
  if (path === '/notifications') return { notifications: [], unread_count: 1 };
  if (path === '/admin-messages/pending') return [];
  if (path === '/projects') return [summary, other];
  if (path === `/projects/${PROJECT}`) return project;
  if (path === `/projects/${PROJECT}/discussion`) {
    const key = search.get('subject');
    const d = discussions.find((x) => x.subject.key === key);
    return { discussion_uuid: d?.uuid ?? null, project: { uuid: PROJECT, name: project.name }, subject: d?.subject ?? { key, kind: key.split(':')[0], label: 'A thing' } };
  }
  const dig = path.match(/^\/discussions\/([0-9a-f-]+)$/);
  if (dig) return discussion(dig[1]);
  if (path === `/users/${ME}/nook`) {
    return {
      user: me, shelves: [SHELF], tags: [], stats: { papers: 3, displayed: 3, notes: 4, seminars: 0 },
      papers: papers.filter((p) => p.in_my_nook).map((p) => listed(p, true)),
      boards: [], projects: [summary, other],
    };
  }
  if (path === '/papers') return papers.map((p) => listed(p));
  const one = path.match(/^\/papers\/([0-9a-f]+)$/);
  if (one) {
    const found = papers.find((p) => p.sha256.startsWith(one[1])) ?? papers[1];
    return { ...listed(found, found.in_my_nook), in_nook: found.in_my_nook, notes: [], comments: [], also_read_by: found.users.filter((u) => u.user.uuid !== ME).map((u) => ({ ...u, is_author: false, tags: [] })), boards: [], projects: [], sharable_uuid: null };
  }
  if (path.startsWith('/activity')) return { spans: [], papers: {}, first_at: null };
  if (path === '/tags' || path === '/boards' || path === '/library/boards') return [];
  if (path === '/users') return [me, ana, ben, mia].map((u) => ({ ...u, paper_count: 2 }));
  if (path === '/shelves') return [SHELF];
  if (path.startsWith('/client-requirements') || path.startsWith('/compat')) return { ok: true };
  return method === 'GET' ? {} : { ok: true };
}

function projectFixture(server) {
  server.middlewares.use('/api', (req, res) => {
    const url = new URL(req.url, 'http://localhost');
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
