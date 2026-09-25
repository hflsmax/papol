import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// A folder an agent gathered, brought in through the real FolderImport
// (USER_STORIES.md §2c), on a page of its own at /__folder_test. The
// folder is played by the entries a drop would carry, holding real PDFs;
// the server by a fetch that holds every upload at once and answers for
// the job that reads it. No account is needed. folder-smoke.mjs checks
// the review through it; letter-shots.mjs photographs it, with ?styled
// (the application's styles, in the Library's frame), ?box (the upload
// box a folder is dropped on, in place of the review) and ?flow (the box,
// then the review once window.dropFolder() is called).
const fixturePath = fileURLToPath(new URL('./attention.pdf', import.meta.url));
const fixtureBytes = readFileSync(fixturePath);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
// A second PDF, one the nook holds already: the fixture with a byte more.
export const heldDigest = digest(Buffer.concat([fixtureBytes, Buffer.from('\n')]));
export const newDigest = digest(fixtureBytes);
// The styles App.jsx sets on every page, for ?styled.
const sharedStyles = `/@fs${fileURLToPath(new URL('../../../shared/applicationStyles.js', import.meta.url))}`;

function folderFixture(server) {
  server.middlewares.use('/__fixture.pdf', (req, res) => {
    res.setHeader('Content-Type', 'application/pdf');
    res.end(fixtureBytes);
  });
  server.middlewares.use('/__folder_test', async (req, res) => {
    const html = `<!doctype html><div id="test-root"></div>
      <script>
        window.__PAPOL_ENV__ = {runtime: 'web', surface: 'desk'};
        window.seen = [];
        window.readingDone = false;
        window.realFetch = window.fetch;
        window.fetch = async (url, options = {}) => {
          const path = String(url).split('?')[0];
          const body = options.body ? JSON.parse(options.body) : null;
          const json = (value, status = 200) => new Response(JSON.stringify(value), {status});
          if (path.endsWith('/files/upload-address')) {
            window.seen.push({step: 'address', sha256: body.sha256, name: body.name});
            return json({stored: true, file_path: body.sha256 + '.pdf'});
          }
          if (path.endsWith('/papers/lookup')) return json({detail: 'No index knows this identifier'}, 404);
          if (path.endsWith('/papers/uploaded')) {
            window.seen.push({step: 'uploaded', body});
            return json({job: 'j1', file_path: body.file_path, sha256: body.file_path.slice(0, 64)}, 202);
          }
          if (path.includes('/jobs/j1')) {
            if (!window.readingDone) return json({status: 'running'});
            return json({status: 'done', result: {doi: '10.48550/arXiv.1706.03762', title: 'Attention Is All You Need',
              authors: '["Ashish Vaswani"]', journal: 'NeurIPS', year: 2017, file_path: '${newDigest}.pdf'}});
          }
          if (path.endsWith('/users/u-1/nook')) return json({papers: [{sha256: '${heldDigest}'}], shelves: [], boards: []});
          if (path.endsWith('/shelves') && options.method === 'POST') {
            window.seen.push({step: 'shelf', body});
            return json({uuid: 's-new', name: body.name, is_public: false});
          }
          if (path.endsWith('/shelves')) return json([{uuid: 's-public', name: 'Reading', is_public: true, is_default: true}]);
          if (path.endsWith('/tags')) return json([{uuid: 't-1', name: 'thesis'}]);
          if (path.endsWith('/papers') && options.method === 'POST') {
            window.seen.push({step: 'save', body});
            return json({sha256: body.file_path.slice(0, 64), file_path: body.file_path, title: body.title});
          }
          if (path.endsWith('/papers')) return json([]);
          return json([]);
        };
      </script>
      <script type="module">
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import FolderImport from '/src/components/FolderImport.jsx';
        import PaperUpload from '/src/components/PaperUpload.jsx';
        import {applicationStyles} from '${sharedStyles}';
        const bytes = new Uint8Array(await (await window.realFetch('/__fixture.pdf')).arrayBuffer());
        const pdf = (name, extra) => new File(extra ? [bytes, extra] : [bytes], name, {type: 'application/pdf'});
        // ?letter: a review as an agent would really write it, for the
        // letter's pictures; the smoke's own rows stay as its checks expect.
        const letter = location.search.includes('letter');
        const manifest = new File([JSON.stringify({papol: 1, papers: letter ? [
          {file: 'attention.pdf', title: 'Attention Is All You Need', note: 'Introduces the Transformer. Start here: every later paper in this review builds on it.'},
          {doi: '10.1145/3530811', title: 'Efficient Transformers: A Survey', note: 'Maps the ways to make attention cheaper on long inputs.'},
          {file: 'language-models.pdf', title: 'Language Models are Unsupervised Multitask Learners', note: 'GPT-2: scaling a decoder-only Transformer.'},
        ] : [
          {file: 'attention.pdf', note: 'Where transformers start.', title: 'Manifest title', tags: ['ignored']},
          {file: 'gone.pdf'},
          {doi: '10.1000/paywalled', title: 'Behind a paywall'},
        ]})], 'papol.json', {type: 'application/json'});
        const fileEntry = (file) => ({name: file.name, isDirectory: false, file: (ok) => ok(file)});
        const folder = (name, children) => ({name, isDirectory: true, createReader: () => {
          let read = false;
          return {readEntries: (ok) => { ok(read ? [] : children); read = true; }};
        }});
        const entry = folder('Transformers review', [
          fileEntry(pdf('attention.pdf')), fileEntry(pdf(letter ? 'language-models.pdf' : 'mine.pdf', '\\n')), fileEntry(manifest),
          fileEntry(new File(['x'], '.DS_Store')),
        ]);
        const styled = location.search.includes('styled');
        // ?flow: the box first, and the review in its place once
        // window.dropFolder() is called, as the Library swaps them.
        const flow = location.search.includes('flow');
        const Page = () => {
          const [dropped, setDropped] = React.useState(!flow && !location.search.includes('box'));
          React.useEffect(() => { window.dropFolder = () => setDropped(true); }, []);
          const child = !dropped ? React.createElement(PaperUpload, {
            onAddFolder: () => {}, onReportableError: () => {}, onPaperCreated: () => {}, onReviewChange: () => {},
          }) : React.createElement(FolderImport, {
            currentUser: {uuid: 'u-1'},
            // ?loose: two PDFs dropped together, with no folder around them.
            incomingFolder: location.search.includes('loose')
              ? {uuid: 'drop-2', files: [pdf('attention.pdf'), pdf('mine.pdf', '\\n')]}
              : {uuid: 'drop-1', entry},
            onClose: () => { window.closed = true; },
            onAdded: () => { window.added = true; },
            onReportableError: (error, area) => { window.reported = area + ': ' + (error?.message || error); },
          });
          return !styled ? child : React.createElement('div', {style: {maxWidth: 960, margin: '24px auto', padding: '0 24px'}},
            React.createElement('style', null, applicationStyles),
            React.createElement('div', {className: dropped ? 'library-page upload-review-mode' : 'library-page'}, child));
        };
        createRoot(document.getElementById('test-root')).render(React.createElement(Page));
      </script>`;
    res.setHeader('Content-Type', 'text/html');
    res.end(await server.transformIndexHtml('/__folder_test', html));
  });
}

// A Vite server for the frontend with the folder's page on it, not yet
// listening.
export function folderServer() {
  return createServer({
    root: fileURLToPath(new URL('../..', import.meta.url)),
    server: { host: '127.0.0.1', port: 0 },
    plugins: [{ name: 'folder-fixture', configureServer: folderFixture }],
  });
}
