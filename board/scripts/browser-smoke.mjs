// The release checklist's board step, automated: open a board's canvas and
// fail unless its cards render. The unit tests state how items are dragged
// and grouped; nothing else opens the built canvas and looks at it, and a
// canvas that cannot draw its cards is exactly the failure a suite of
// handlers cannot see.
//
// The API is served by this script from the shapes the backend declares, so
// the check is hermetic: no backend and no account, only the token the
// application requires to be standing in localStorage.
import { resolve } from 'node:path';
import { distFile, runSmoke } from '../../scripts/smoke-harness.mjs';

const dist = resolve(process.env.PAPOL_SMOKE_DIST || 'dist');

const BOARD = 'b0a4d111-2222-4333-8444-555566667777';
const board = {
  uuid: BOARD,
  revision: 1,
  user_uuid: 'c1d2e3f4-5678-4abc-8def-012345678901',
  owner: null,
  shelf_uuid: null,
  can_edit: true,
  name: 'The Smoke Board',
  description: null,
  created_at: '2026-01-02T03:04:05',
  updated_at: '2026-01-02T03:04:05',
  item_count: 2,
  items: [
    {
      uuid: 'd1e2f3a4-1111-4222-8333-444455556666',
      group_uuid: null,
      kind: 'comment',
      content: 'A thought pinned to the canvas.',
      staged: false,
      text_align: 'left',
      position: 1,
      x: 0.2,
      y: 0.2,
      width: 0.25,
      created_at: '2026-01-02T03:04:05',
    },
    {
      uuid: 'e2f3a4b5-2222-4333-8444-555566667777',
      group_uuid: null,
      kind: 'webpage',
      content: null,
      source_url: 'https://example.org/read-this',
      source_label: 'example.org',
      staged: false,
      text_align: 'left',
      position: 2,
      x: 0.55,
      y: 0.4,
      width: 0.25,
      created_at: '2026-01-02T03:04:06',
    },
  ],
  staged_items: [],
  groups: [],
};

const json = (body) => ({ type: 'application/json', body: JSON.stringify(body) });

// The board asks who you are before it opens, so the token is planted the
// way sign-in plants it — before the application's own modules run.
const bootstrap = `<script>
  localStorage.setItem('papol_token', 'browser-smoke-token');
</script>`;

const probe = `<script>
  (() => {
    const ready = () => {
      if (document.querySelector('.render-error')) {
        fetch('/__papol_smoke_ready?page=render-error', { method: 'POST' });
        return;
      }
      if (document.querySelectorAll('.board-canvas-card').length >= 2) {
        fetch('/__papol_smoke_ready?page=board-canvas', { method: 'POST' });
        return;
      }
      setTimeout(ready, 25);
    };
    ready();
  })();
</script>`;

await runSmoke(
  [{ path: `/papol/boards/${BOARD}`, page: 'board-canvas' }],
  async (url) => {
    const { pathname } = url;
    if (pathname === `/papol/api/boards/${BOARD}`) return json(board);
    if (pathname.startsWith('/papol/api/')) {
      return { status: 404, ...json({ detail: 'Not part of the board smoke' }) };
    }
    // The canvas is served a path segment deep, so its relative assets
    // resolve beside /papol/boards/, and the board path itself is the shell.
    const relative = pathname.replace(/^\/papol\/boards\/?/, '');
    const asset = /\.[a-z0-9]+$/i.test(relative) ? relative : 'index.html';
    const file = await distFile(dist, asset);
    if (file && asset === 'index.html') {
      return {
        type: file.type,
        body: file.body.toString('utf8').replace('</head>', `${bootstrap}</head>`)
          .replace('</body>', `${probe}</body>`),
      };
    }
    return file;
  },
);

console.log('Board browser smoke: the canvas drew its cards.');
