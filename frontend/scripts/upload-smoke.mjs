import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { Browser } from '../../scripts/share-e2e/cdp.mjs';

// Exercise the real upload component across the web/native API boundary.
// No account, backend, or user data is needed.
function uploadFixture(server) {
  server.middlewares.use('/__upload_test', async (req, res) => {
    const native = req.url.includes('native');
    const html = `<!doctype html><div id="test-root"></div>
      <script>
        window.__PAPOL_ENV__ = {runtime: '${native ? 'desktop' : 'web'}', surface: 'desk'};
        localStorage.setItem('papol.localAccountUuid', '77777777-7777-4777-8777-777777777777');
        window.failImport = false;
        window.__TAURI_INTERNALS__ = {invoke: async (command) => {
          if (command === 'blob_import') {
            if (window.failImport === 'expected') throw 'Offline files may be at most 40 MB';
            if (window.failImport) throw 'PDF import failed on disk';
            return {sha256: 'a'.repeat(64)};
          }
          if (command === 'data_query' || command === 'diagnostic_recent') return [];
        }};
        window.fetch = async (url) => {
          if (String(url).endsWith('/extract')) {
            if (window.failImport === 'expected') return new Response(JSON.stringify({detail:'File too large'}), {status:413});
            if (window.failImport) return new Response(JSON.stringify({detail:'PDF upload failed'}), {status:500});
            return new Response(JSON.stringify({title:'Uploaded paper', file_path:'test.pdf'}));
          }
          return new Response('[]');
        };
      </script>
      <script type="module">
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import PaperUpload from '/src/components/PaperUpload.jsx';
        import FeedbackDialog from '/src/components/FeedbackDialog.jsx';
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
      await browser.send('DOM.setFileInputFiles', {
        nodeId,
        files: [fileURLToPath(new URL('../public/assets/demo/papers/attention.pdf', import.meta.url))],
      });
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
    await browser.evaluate('document.querySelector("[role=dialog] .form-actions button").click();');
    await browser.waitFor('!document.querySelector("[role=dialog]")');
    await browser.evaluate('window.failImport = false;');
    await choose();
    await browser.waitFor('document.querySelector("#upload-paper-title")');
    assert.match(await browser.text(), /Review Paper Metadata/);
    console.log(`${mode}: expected errors stay inline, defects open diagnostics, retry opens review`);
  }
} finally {
  await browser.stop();
  await server.close();
}
