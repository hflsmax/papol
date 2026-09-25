import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { Browser } from '../../scripts/share-e2e/cdp.mjs';

// A folder an agent gathered, brought in through the real FolderImport
// (USER_STORIES.md §2c). The folder is played by the entries a drop would
// carry, holding real PDFs; the server by a fetch that holds every upload
// at once and answers for the job that reads it. No account is needed.
const fixturePath = fileURLToPath(new URL('./fixtures/attention.pdf', import.meta.url));
const fixtureBytes = readFileSync(fixturePath);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
// A second PDF, one the nook holds already: the fixture with a byte more.
const heldDigest = digest(Buffer.concat([fixtureBytes, Buffer.from('\n')]));
const newDigest = digest(fixtureBytes);

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
        const bytes = new Uint8Array(await (await window.realFetch('/__fixture.pdf')).arrayBuffer());
        const pdf = (name, extra) => new File(extra ? [bytes, extra] : [bytes], name, {type: 'application/pdf'});
        const manifest = new File([JSON.stringify({papol: 1, papers: [
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
          fileEntry(pdf('attention.pdf')), fileEntry(pdf('mine.pdf', '\\n')), fileEntry(manifest),
          fileEntry(new File(['x'], '.DS_Store')),
        ]);
        createRoot(document.getElementById('test-root')).render(React.createElement(FolderImport, {
          currentUser: {uuid: 'u-1'},
          incomingFolder: {uuid: 'drop-1', entry},
          onClose: () => { window.closed = true; },
          onAdded: () => { window.added = true; },
          onReportableError: (error, area) => { window.reported = area + ': ' + (error?.message || error); },
        }));
      </script>`;
    res.setHeader('Content-Type', 'text/html');
    res.end(await server.transformIndexHtml('/__folder_test', html));
  });
}

const server = await createServer({
  root: fileURLToPath(new URL('..', import.meta.url)),
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{ name: 'folder-fixture', configureServer: folderFixture }],
});
const browser = new Browser();
try {
  await server.listen();
  await browser.start();
  const port = server.httpServer.address().port;
  await browser.navigate(`http://127.0.0.1:${port}/__folder_test`);
  await browser.waitFor('document.querySelectorAll(".folder-row").length === 4', { what: 'the folder\'s rows' });

  // The manifest's works in its order, then the folder's other PDFs; the
  // PDF the nook holds is found by its bytes and never sent.
  await browser.waitFor("document.body.innerText.includes('Already in your nook')", { what: 'the held PDF to be recognised' });
  const rows = () => browser.evaluate(`return [...document.querySelectorAll('.folder-row')].map((row) => ({
    title: row.querySelector('.folder-row-title').value ?? row.querySelector('.folder-row-title').textContent,
    status: row.querySelector('.folder-row-status').textContent,
    checked: row.querySelector('input[type=checkbox]').checked,
  }));`);
  let listed = await rows();
  assert.deepEqual(listed.map((row) => row.status.replace('…', '')).slice(1), ['Not in the folder', 'No PDF: find it yourself', 'Already in your nook']);
  assert.deepEqual(listed.map((row) => row.checked), [true, false, false, false]);
  assert.equal(listed[0].title, 'Manifest title', 'the manifest\'s title stands in until the PDF is read');
  assert.match(await browser.text(), /Where transformers start\./);
  const sent = await browser.evaluate('return window.seen.filter((step) => step.step === "address").map((step) => step.sha256);');
  assert.deepEqual(sent, [newDigest], 'only the new PDF went up');

  // The reading comes in and takes the title's place.
  await browser.evaluate('window.readingDone = true; return true;');
  await browser.waitFor('document.querySelector(".folder-row-title").value === "Attention Is All You Need"', { what: 'the reading to fill the title' });

  // The user files the batch: a new private shelf named after the folder,
  // and one of their tags.
  const shelfOptions = await browser.evaluate('return [...document.querySelectorAll("#folder-shelf option")].map((o) => o.textContent);');
  assert.deepEqual(shelfOptions, ['Reading · Public', 'New private shelf…']);
  await browser.evaluate(`
    const select = document.querySelector('#folder-shelf');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'new');
    select.dispatchEvent(new Event('change', {bubbles: true}));
    return true;`);
  await browser.waitFor('document.querySelector("#folder-new-shelf")');
  assert.equal(await browser.evaluate('return document.querySelector("#folder-new-shelf").value;'), 'Transformers review');
  await browser.evaluate('document.querySelector("#folder-tags").focus(); return true;');
  await browser.waitFor('document.querySelector(".tag-dropdown button")');
  await browser.evaluate('document.querySelector(".tag-dropdown button").click(); return true;');
  await browser.waitFor("[...document.querySelectorAll('.tag-chip.selected')].some((chip) => chip.textContent.includes('thesis'))");

  await browser.waitFor('document.querySelector(".form-actions button.primary").textContent === "Add 1 paper"');
  await browser.evaluate('document.querySelector(".form-actions button.primary").click(); return true;');
  await browser.waitFor("document.body.innerText.includes('1 added, 1 already yours, 2 problems.')", { what: 'the summary' });

  const steps = await browser.evaluate('return window.seen;');
  assert.deepEqual(steps.find((step) => step.step === 'shelf').body.is_public, false);
  assert.equal(steps.find((step) => step.step === 'shelf').body.name, 'Transformers review');
  const saves = steps.filter((step) => step.step === 'save').map((step) => step.body);
  assert.equal(saves.length, 1);
  assert.equal(saves[0].file_path, `${newDigest}.pdf`);
  assert.equal(saves[0].title, 'Attention Is All You Need');
  assert.equal(saves[0].doi, '10.48550/arXiv.1706.03762');
  assert.equal(saves[0].shelf_uuid, 's-new');
  assert.deepEqual(saves[0].tag_uuids, ['t-1']);
  assert.equal(saves[0].initial_comment, 'Where transformers start.');
  assert.equal(await browser.evaluate('return window.added === true && !window.reported;'), true);
  listed = await rows();
  assert.equal(listed[0].status, 'Added');
  console.log('folder: the manifest orders and annotates the review, the nook\'s own PDF is skipped unsent, missing and PDF-less works are listed, and the user\'s shelf and tag file the batch');
} catch (error) {
  await browser.capture('folder-smoke');
  throw error;
} finally {
  await browser.stop();
  await server.close();
}
