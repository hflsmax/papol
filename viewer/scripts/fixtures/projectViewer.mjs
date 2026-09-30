import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// The viewer, with a project on or none, as the real app renders it over a
// pretend server: a Vite server for the viewer that answers `/api/…` itself
// with one paper the reader keeps, the reader's own digs on it, one project
// holding it, and what three of its members left on the pages — and signs
// the tab in as one of them before the app loads. No account or Worker is needed. project-shots.mjs
// photographs it.

const ME = 'a1b2c3d4-0000-4000-8000-000000000001';
const ANA = 'a1b2c3d4-0000-4000-8000-000000000002';
const BEN = 'a1b2c3d4-0000-4000-8000-000000000003';
export const PROJECT = 'b1b2c3d4-0000-4000-8000-000000000010';
const OTHER = 'b1b2c3d4-0000-4000-8000-000000000011';
const DIG = 'e1b2c3d4-0000-4000-8000-000000000050';

const user = (uuid, display_name, affiliation) => ({ uuid, display_name, affiliation, avatar_path: null, email: null });
const me = user(ME, 'Dana Okafor', 'Leiden Observatory');
const ana = user(ANA, 'Ana Reyes', 'ESO');
const ben = user(BEN, 'Ben Hall', 'Leiden Observatory');

// Another paper stands in for the fixture's when a picture needs one (a
// paper with named rules, for telescope-shots.mjs): PAPOL_FIXTURE_PDF names it.
const pdfFile = process.env.PAPOL_FIXTURE_PDF || fileURLToPath(new URL('../../../frontend/scripts/fixtures/attention.pdf', import.meta.url));
const pdfBytes = readFileSync(pdfFile);
export const PAPER = 'f1'.repeat(32);

const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const daysAgo = (d) => hoursAgo(d * 24);

const paper = {
  sha256: PAPER, title: process.env.PAPOL_FIXTURE_TITLE || 'Attention Is All You Need', authors: '["A. Vaswani", "N. Shazeer", "N. Parmar"]',
  journal: process.env.PAPOL_FIXTURE_TITLE ? '' : 'NeurIPS', year: 2017, doi: null, file_path: `${PAPER}.pdf`, file_url: '/uploads/attention.pdf',
  copy_uuid: 'c0000000-0000-4000-8000-000000000001', shelf_uuid: 'ab000000-0000-4000-8000-000000000001', is_public: true,
  summary: null, thought: null, tags: [], also_read_by: [], sharable_uuid: null, created_at: daysAgo(30),
};

// A line of paint across a page: PDF-space fractions, y up. `at` is the
// line's height from the bottom, x from `from` to `to`.
const paint = (uuid, u, page, at, from, to, color, created) => ({
  uuid, kind: 'ink', page, group_uuid: null, created_at: created, user: u,
  body: { points: [{ x: from, y: at }, { x: to, y: at }], color, width: 0.021, opacity: 0.25, shape: 'flat' },
});
const anchor = (uuid, u, page, x, y, created) => ({
  uuid, kind: 'anchor', page, group_uuid: null, created_at: created, user: u, body: { anchor: { type: 'point', x, y } },
});
const id = (n) => `d1b2c3d4-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;

// The reader's own marks on page 1, as the paper opens alone.
const mine = [
  paint(id(1), me, 1, 0.612, 0.13, 0.87, '#d92b1f', daysAgo(2)),
  paint(id(2), me, 1, 0.596, 0.13, 0.62, '#d92b1f', daysAgo(2)),
  anchor(id(3), me, 1, 0.885, 0.604, daysAgo(2)),
  // A view of the abstract's opening, set in the blank head of the page.
  {
    uuid: id(12), kind: 'clip', page: 1, group_uuid: null, created_at: daysAgo(2), user: me,
    body: { source: { x: 0.24, y: 0.592, w: 0.54, h: 0.069 }, frame: { x: 0.32, y: 0.035, w: 0.36, h: 0.046 }, floating: false },
  },
];
// What the others left.
const theirs = [
  paint(id(4), ana, 1, 0.505, 0.13, 0.87, '#e0a020', daysAgo(1)),
  paint(id(5), ana, 1, 0.489, 0.13, 0.87, '#e0a020', daysAgo(1)),
  paint(id(6), ana, 1, 0.473, 0.13, 0.42, '#e0a020', daysAgo(1)),
  anchor(id(7), ana, 1, 0.885, 0.49, daysAgo(1)),
  paint(id(8), ben, 1, 0.352, 0.13, 0.87, '#1668dc', hoursAgo(6)),
  paint(id(9), ben, 1, 0.336, 0.13, 0.55, '#1668dc', hoursAgo(6)),
  anchor(id(10), ben, 1, 0.115, 0.35, hoursAgo(6)),
  anchor(id(11), ben, 2, 0.5, 0.6, hoursAgo(5)),
];

const digPosts = [
  { uuid: 'f0000000-0000-4000-8000-000000000010', user: ana, body: 'Is this still true at 8 heads? Their ablation in Table 3 says the gain flattens.', created_at: hoursAgo(20), edited_at: null, is_mine: false },
  { uuid: 'f0000000-0000-4000-8000-000000000011', user: me, body: 'It flattens for translation. For our loop the heads would be doing different work, so I would not read Table 3 as a ceiling.', created_at: hoursAgo(20), edited_at: null, is_mine: true },
  { uuid: 'f0000000-0000-4000-8000-000000000012', user: ana, body: 'Fair. Then the claim to test is whether the heads specialise at all on our data.', created_at: hoursAgo(3), edited_at: null, is_mine: false },
];
const digSubject = {
  key: `annotation:${id(7)}`, kind: 'annotation', annotation_uuid: id(7), paper_sha256: PAPER, paper_title: paper.title,
  annotation_kind: 'anchor', page: 1, user_uuid: ANA, by: 'Ana Reyes', label: 'An anchor on page 1',
};
const dig = {
  uuid: DIG, created_at: hoursAgo(20), updated_at: hoursAgo(3), project: { uuid: PROJECT, name: 'Adaptive optics control' },
  subject: digSubject, owner: ana, is_mine: false, phase: 'digging', text: digPosts[0].body, can_moderate: true, posts: digPosts.slice(1),
};
// Ben's dig on his own paint, the one a project's link lands on.
const INK_DIG = 'e1b2c3d4-0000-4000-8000-000000000051';
const inkDig = {
  uuid: INK_DIG, created_at: hoursAgo(6), updated_at: hoursAgo(2), project: dig.project,
  subject: { key: `annotation:${id(8)}`, kind: 'annotation', annotation_uuid: id(8), paper_sha256: PAPER, paper_title: paper.title, annotation_kind: 'ink', page: 1, user_uuid: BEN, by: 'Ben Hall', label: 'Ink on page 1' },
  owner: ben, is_mine: false, phase: 'digging', text: '3.5 days on eight GPUs is the number to beat for our budget.', can_moderate: true,
  posts: [{ uuid: 'f0000000-0000-4000-8000-000000000013', user: me, body: 'We have two. Call it a week.', created_at: hoursAgo(2), edited_at: null, is_mine: true }],
};
// Ana's dig on the paper itself, which heads the margin; Ben has one too.
const PAPER_DIG = 'e1b2c3d4-0000-4000-8000-000000000052';
const paperSubject = { key: `paper:${PAPER}`, kind: 'paper', paper_sha256: PAPER, label: paper.title };
const paperDig = {
  uuid: PAPER_DIG, created_at: daysAgo(2), updated_at: daysAgo(1), project: dig.project, subject: paperSubject,
  owner: ana, is_mine: false, phase: 'gold', text: 'The parallelism argument carries the whole paper, and it is the part we can test on our own loop first.', can_moderate: true, posts: [],
};
const paperDigBen = {
  uuid: 'e1b2c3d4-0000-4000-8000-000000000053', created_at: daysAgo(1), updated_at: daysAgo(1), project: dig.project, subject: paperSubject,
  owner: ben, is_mine: false, phase: 'digging', text: 'Section 6 is where they admit the limits.', can_moderate: true, posts: [],
};

// The reader's own digs, with no project on: on their anchor, on their
// paint, and on the paper itself. Nobody else sees them.
const personal = (n, subject, text, created) => ({
  uuid: `e1b2c3d4-0000-4000-8000-0000000000${n}`, created_at: created, updated_at: created, project: null,
  subject, owner: me, is_mine: true, phase: null, text, can_moderate: false, posts: [],
});
const annotationSubject = (a, label) => ({
  key: `annotation:${a.uuid}`, kind: 'annotation', annotation_uuid: a.uuid, paper_sha256: PAPER, paper_title: paper.title,
  annotation_kind: a.kind, page: a.page, user_uuid: ME, by: me.display_name, label,
});
const personalDigs = [
  personal(60, annotationSubject(mine[2], 'An anchor on page 1'), 'The whole argument in one sentence: attention alone, no recurrence, and it trains faster.', daysAgo(2)),
  personal(61, annotationSubject(mine[0], 'Ink on page 1'), 'Check this against the timing we measured on the bench.', daysAgo(2)),
  personal(62, paperSubject, 'Read for the loop redesign. Section 3.2 is the part that matters.', daysAgo(3)),
];
const each = (d, isNew = false) => ({ uuid: d.uuid, owner: d.owner, created_at: d.created_at, is_new: isNew });
const personalPin = (d) => ({ uuid: d.uuid, mine: d.uuid, dig_count: 1, post_count: 0, unread: 0, is_new: false, voices: [me], lead: { owner: me, phase: null, excerpt: d.text }, digs: [each(d)] });

const allDigs = [dig, inkDig, paperDig, paperDigBen, ...personalDigs];

const members = [
  { user: me, is_keeper: true, joined_at: daysAgo(20) },
  { user: ana, is_keeper: true, joined_at: daysAgo(19) },
  { user: ben, is_keeper: false, joined_at: daysAgo(12) },
];
const projects = [
  { uuid: PROJECT, name: 'Adaptive optics control', created_at: daysAgo(20), members, is_member: true, is_keeper: true, new_count: 0, has_paper: true },
  { uuid: OTHER, name: 'Reading group', created_at: daysAgo(60), members: [members[0]], is_member: true, is_keeper: false, new_count: 0, has_paper: true },
];

// What the pretend server says to each request the viewer makes.
let saved = 0;
function answer(method, path, search) {
  if (path === '/auth/me') return { ...me, is_admin: false, email: 'dana@example.org' };
  if (path === `/viewer/${PAPER}`) return { ...paper, anchors: mine.filter((a) => a.kind === 'anchor') };
  if (path === `/viewer/${PAPER}/info`) return { paper: { ...paper }, references_status: 'done' };
  // An anchor the reader drops is saved under a name of its own; each
  // later one (clips a scene keeps) under the next name.
  if (method === 'POST' && path === `/papers/${PAPER.slice(0, 32)}/annotations`) {
    return { uuid: id(90 + saved++), kind: 'anchor', page: 1, body: {}, created_at: daysAgo(0), updated_at: daysAgo(0), revision: 1 };
  }
  // The reader's personal digs on the paper, by annotation, and the one on
  // the paper itself.
  if (path === `/papers/${PAPER.slice(0, 32)}/digs`) {
    const on = (a) => personalDigs.find((d) => d.subject.key === `annotation:${a.uuid}`);
    return {
      digs: Object.fromEntries(mine.filter(on).map((a) => [a.uuid, personalPin(on(a))])),
      paper_digs: personalPin(personalDigs[2]),
    };
  }
  // A dig written with no project on comes back as the reader's own.
  if (path === '/digs' && method === 'POST') return personal(70, annotationSubject({ uuid: id(90), kind: 'anchor', page: 1 }, 'An anchor on page 1'), 'Written in the margin.', daysAgo(0));
  if (path === '/digs' && method === 'GET') {
    const key = search.get('subject');
    const on = personalDigs.filter((d) => d.subject.key === key);
    const [, uuid] = key.split(':');
    const about = mine.find((a) => a.uuid === uuid) ?? { uuid: id(90), kind: 'anchor', page: 1 };
    const subject = on[0]?.subject ?? (key.startsWith('paper:') ? paperSubject : annotationSubject(about, about.kind === 'ink' ? `Ink on page ${about.page}` : `An anchor on page ${about.page}`));
    return { mine: on[0]?.uuid ?? null, digs: on.map(({ posts, ...d }) => ({ ...d, post_count: posts.length })), project: null, subject };
  }
  if (path === `/papers/${PAPER.slice(0, 32)}/annotations`) {
    const kind = search.get('kind');
    return mine.filter((a) => !kind || a.kind === kind);
  }
  if (path === '/projects') return projects;
  if (path === `/projects/${PROJECT}/papers/${PAPER}/annotations`) {
    return {
      project: { uuid: PROJECT, name: 'Adaptive optics control', members },
      me: ME,
      annotations: [...mine, ...theirs],
      digs: {
        [id(7)]: { uuid: DIG, dig_count: 1, post_count: 1, is_new: true, voices: [me, ana], lead: { owner: ana, phase: 'digging', excerpt: dig.text }, digs: [each(dig, true)] },
        [id(8)]: { uuid: INK_DIG, dig_count: 1, post_count: 1, is_new: false, voices: [ben, me], lead: { owner: ben, phase: 'digging', excerpt: inkDig.text }, digs: [each(inkDig)] },
      },
      paper_digs: { uuid: PAPER_DIG, dig_count: 2, post_count: 0, is_new: false, voices: [ana, ben], lead: { owner: ana, phase: 'gold', excerpt: paperDig.text }, digs: [each(paperDig), each(paperDigBen)] },
    };
  }
  if (path === `/projects/${PROJECT}`) return { ...projects[0], boards: [], discussions: [], papers: [] };
  if (path === `/projects/${PROJECT}/digs`) {
    const key = search.get('subject');
    const on = allDigs.filter((d) => d.subject.key === key);
    if (on.length) return { mine: null, digs: on.map(({ posts, ...d }) => ({ ...d, post_count: posts.length })), project: dig.project, subject: on[0].subject };
    const [, uuid] = key.split(':');
    const about = [...mine, ...theirs].find((a) => a.uuid === uuid);
    const label = about?.kind === 'ink' ? `Ink on page ${about.page}` : `An anchor on page ${about?.page}`;
    return { mine: null, digs: [], project: dig.project, subject: { key, kind: 'annotation', annotation_uuid: uuid, paper_sha256: PAPER, page: about?.page, annotation_kind: about?.kind, by: about?.user.display_name, label } };
  }
  // A post comes back in its dig, as the reader wrote it (the words stand in).
  const posting = method === 'POST' && allDigs.find((d) => path === `/digs/${d.uuid}/posts`);
  if (posting) return { ...posting, posts: [...posting.posts, { uuid: id(95), user: me, body: 'Posted from the box.', created_at: hoursAgo(0), edited_at: null, is_mine: true }] };
  const asked = allDigs.find((d) => path === `/digs/${d.uuid}`);
  if (asked) return asked;
  if (path.startsWith('/client-requirements') || path.startsWith('/compat')) return { ok: true };
  return method === 'GET' ? {} : { ok: true };
}

function viewerFixture(server) {
  server.middlewares.use('/uploads', (req, res) => {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', pdfBytes.length);
    res.end(pdfBytes);
  });
  server.middlewares.use('/api', (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const body = answer(req.method, url.pathname, url.searchParams);
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = body === null ? 404 : 200;
    res.end(JSON.stringify(body ?? { error: 'Not found' }));
  });
}

// The tab is the reader's before the app loads: a token where the app
// keeps it, and no Mac banner.
const signIn = () => ({
  name: 'viewer-fixture-sign-in',
  transformIndexHtml: (html) => html.replace('<head>', `<head><script>
    localStorage.setItem('papol_token', 'fixture');
    localStorage.setItem('papol.macosDownloadBannerDismissed', '1');
    localStorage.setItem('papol_annotation_storage_notice', 'hidden');
  </script>`),
});

// A Vite server for the viewer with the project on it, not yet listening.
export function viewerServer() {
  return createServer({
    root: fileURLToPath(new URL('../..', import.meta.url)),
    server: { host: '127.0.0.1', port: 0, proxy: {} },
    plugins: [signIn(), { name: 'viewer-fixture', configureServer: viewerFixture }],
  });
}
