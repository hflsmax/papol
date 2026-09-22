import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { Browser } from '../../scripts/share-e2e/cdp.mjs';

// The fixture as the browser must describe it: its digest and its size.
const fixturePath = fileURLToPath(new URL('./fixtures/attention.pdf', import.meta.url));
const fixtureBytes = readFileSync(fixturePath);
const fixtureDigest = createHash('sha256').update(fixtureBytes).digest('hex');
const fixtureSize = fixtureBytes.length;

// Exercise the real upload component across the web/native API boundary.
// No account, backend, or user data is needed. The server's side is
// played by a fetch that stores the upload at once and answers for the
// job that reads it: `running` until the test says the reading is done.
const feedbackDialog = fileURLToPath(new URL('../../shared/ui/FeedbackDialog.jsx', import.meta.url));
function uploadFixture(server) {
  server.middlewares.use('/__upload_test', async (req, res) => {
    const native = req.url.includes('native');
    const html = `<!doctype html><div id="test-root"></div>
      <script>
        window.__PAPOL_ENV__ = {runtime: '${native ? 'desktop' : 'web'}', surface: 'desk'};
        localStorage.setItem('papol.localAccountUuid', '77777777-7777-4777-8777-777777777777');
        window.failImport = false;
        window.readingDone = false;
        window.__TAURI_INTERNALS__ = {invoke: async (command) => {
          if (command === 'blob_import') {
            if (window.failImport === 'expected') throw 'Offline files may be at most 40 MB';
            if (window.failImport) throw 'PDF import failed on disk';
            return {sha256: 'a'.repeat(64)};
          }
          if (command === 'data_query' || command === 'diagnostic_recent') return [];
        }};
        // The upload as the bucket and the Worker see it: the address asked
        // for, the PUT to the bucket, and the word that the bytes are in.
        window.uploadSeen = [];
        window.fetch = async (url, options = {}) => {
          const path = String(url);
          if (path.endsWith('/upload-address')) {
            if (window.failImport === 'expected') return new Response(JSON.stringify({detail:'File too large'}), {status:413});
            if (window.failImport) return new Response(JSON.stringify({detail:'PDF upload failed'}), {status:500});
            // An older Worker has no such route; the bytes go through it instead.
            if (window.olderWorker) return new Response(JSON.stringify({detail:'Not Found'}), {status:404});
            window.uploadSeen.push({step: 'address', body: JSON.parse(options.body)});
            return new Response(JSON.stringify({stored:false, file_path:'b'.repeat(64) + '.pdf', url:'https://bucket.test/uploads/' + 'b'.repeat(64) + '.pdf?X-Amz-Signature=sig',
              headers:{'content-type':'application/pdf', 'x-amz-checksum-sha256':'c2ln'}}));
          }
          if (path.startsWith('https://bucket.test/')) {
            window.uploadSeen.push({step: 'put', method: options.method, headers: options.headers, size: options.body?.size});
            return new Response(null, {status:200});
          }
          if (path.endsWith('/uploaded')) {
            window.uploadSeen.push({step: 'uploaded', body: JSON.parse(options.body)});
            return new Response(JSON.stringify({job:'j1', file_path:'b'.repeat(64) + '.pdf', sha256:'b'.repeat(64)}), {status:202});
          }
          if (path.endsWith('/extract')) {
            window.uploadSeen.push({step: 'extract', size: options.body?.get?.('file')?.size, authorized: !!options.headers?.Authorization});
            return new Response(JSON.stringify({job:'j1', file_path:'b'.repeat(64) + '.pdf', sha256:'b'.repeat(64)}), {status:202});
          }
          if (String(url).includes('/jobs/j1')) {
            if (!window.readingDone) return new Response(JSON.stringify({status:'running'}));
            return new Response(JSON.stringify({status:'done', result:{
              doi:'10.1000/read', title:'Uploaded paper', authors:'["Ada Lovelace"]', journal:'Read Journal', year:2017,
              file_path:'b'.repeat(64) + '.pdf',
            }}));
          }
          return new Response('[]');
        };
      </script>
      <script type="module">
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import PaperUpload from '/src/components/PaperUpload.jsx';
        import FeedbackDialog from '/@fs${feedbackDialog}';
        function Fixture() {
          const [report, setReport] = React.useState(null);
          return React.createElement(React.Fragment, null,
            React.createElement(PaperUpload, {
              onPaperCreated: () => {},
              onReportableError: (error, area) => setReport(area + ': ' + (error?.message || String(error))),
            }),
            report && React.createElement(FeedbackDialog, {
              initialContent: report, reportError: true, onClose: () => setReport(null),
            }),
          );
        }
        createRoot(document.getElementById('test-root')).render(React.createElement(Fixture));
      </script>`;
    res.setHeader('Content-Type', 'text/html');
    res.end(await server.transformIndexHtml('/__upload_test', html));
  });
}
const server = await createServer({
  root: fileURLToPath(new URL('..', import.meta.url)),
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{ name: 'upload-fixture', configureServer: uploadFixture }],
});
const browser = new Browser();
try {
  await server.listen();
  await browser.start();
  const port = server.httpServer.address().port;
  for (const mode of ['web', 'native']) {
    await browser.navigate(`http://127.0.0.1:${port}/__upload_test?${mode}`);
    await browser.waitFor('document.querySelector("input[type=file]")');
    const choose = async () => {
      const { root } = await browser.send('DOM.getDocument');
      const { nodeId } = await browser.send('DOM.querySelector', {
        nodeId: root.nodeId, selector: 'input[type=file]',
      });
      await browser.send('DOM.setFileInputFiles', { nodeId, files: [fixturePath] });
    };
    await browser.evaluate("window.failImport = 'expected';");
    await choose();
    await browser.waitFor('document.querySelector(".error")');
    assert.equal(await browser.evaluate('return !!document.querySelector("[role=dialog]");'), false);
    assert.match(await browser.text(), mode === 'native' ? /at most 40 MB/ : /File too large/);
    await browser.evaluate('window.failImport = true;');
    await choose();
    await browser.waitFor('document.querySelector(".error")');
    await browser.waitFor('document.querySelector("[role=dialog]")');
    assert.match(await browser.text(), /Send an error report/);
    assert.match(await browser.evaluate('return document.querySelector("#feedback-content").value;'),
      mode === 'native' ? /PDF import failed on disk/ : /PDF upload failed/);
    await browser.evaluate('document.querySelector("[role=dialog] .feedback-actions button").click();');
    await browser.waitFor('!document.querySelector("[role=dialog]")');
    await browser.evaluate('window.failImport = false;');
    await choose();
    await browser.waitFor('document.querySelector("#upload-paper-title")');
    assert.match(await browser.text(), /Review Paper Metadata/);
    if (mode === 'web') {
      // The bytes went to the bucket by the address the server gave, with
      // the headers it listed and no credential; the server was then told,
      // with the arXiv id the browser read off the first page.
      const seen = await browser.evaluate('return window.uploadSeen;');
      assert.deepEqual(seen.map((step) => step.step), ['address', 'put', 'uploaded']);
      assert.deepEqual(seen[0].body, { sha256: fixtureDigest, size: fixtureSize, name: 'attention.pdf' });
      assert.equal(seen[1].method, 'PUT');
      assert.equal(seen[1].size, fixtureSize);
      assert.deepEqual(seen[1].headers, { 'content-type': 'application/pdf', 'x-amz-checksum-sha256': 'c2ln' });
      assert.deepEqual(seen[2].body, {
        file_path: `${'b'.repeat(64)}.pdf`, uploaded_name: 'attention.pdf', identifier: { arxiv_id: '1706.03762v7' },
      });
      // Against an older Worker, with no address to give, the bytes go
      // through it in a form, as they always did.
      await browser.evaluate('document.querySelector(".form-actions button").click(); window.olderWorker = true; window.uploadSeen = [];');
      await browser.waitFor('document.querySelector("input[type=file]")');
      await choose();
      await browser.waitFor('document.querySelector("#upload-paper-title")');
      assert.deepEqual(await browser.evaluate('return window.uploadSeen;'), [{ step: 'extract', size: fixtureSize, authorized: false }]);
      await browser.evaluate('window.olderWorker = false; return true;');
    }

    // The form is open before the PDF has been read: the filename's title,
    // and a line saying the reading is on.
    const value = (id) => browser.evaluate(`return document.querySelector("#${id}").value;`);
    assert.equal(await value('upload-paper-title'), 'Attention');
    assert.match(await browser.text(), /Reading the PDF for its title and authors/);
    // The user types while it is read.
    await browser.evaluate(`
      const input = document.querySelector('#upload-paper-journal');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'My journal');
      input.dispatchEvent(new Event('input', {bubbles: true}));
    `);
    // The reading fills what they left alone, never what they typed.
    await browser.evaluate('window.readingDone = true;');
    await browser.waitFor('document.querySelector("#upload-paper-title").value === "Uploaded paper"', { what: 'the reading to fill the title' });
    assert.equal(await value('upload-paper-authors'), 'Ada Lovelace');
    assert.equal(await value('upload-paper-year'), '2017');
    assert.equal(await value('upload-paper-doi'), '10.1000/read');
    assert.equal(await value('upload-paper-journal'), 'My journal');
    assert.doesNotMatch(await browser.text(), /Reading the PDF/);
    console.log(`${mode}: expected errors stay inline, defects open diagnostics, retry opens the form before the PDF is read, and the reading fills what was not typed`);
  }
} finally {
  await browser.stop();
  await server.close();
}
