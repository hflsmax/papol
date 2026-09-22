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
        window.invoked = [];
        window.__TAURI_INTERNALS__ = {invoke: async (command, args) => {
          window.invoked.push(command + (args?.changes ? ':' + args.changes.map((c) => c.table + '=' + String(c.uuid).slice(0, 4)).join('+') : ''));
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
        // The PUT goes through XMLHttpRequest, for its upload progress; the
        // bucket is played here, answering in three steps so the bar has
        // something to show. Every value the bar took is recorded as it
        // goes, and whether "Extracting…" was ever on screen beside it.
        window.barSeen = [];
        window.extractingBesideBar = false;
        window.barObserver = new MutationObserver(() => {
          const bar = document.querySelector('[role=progressbar]');
          if (!bar) return;
          const value = bar.getAttribute('aria-label') + ' ' + bar.getAttribute('aria-valuenow') + '% ' + bar.getAttribute('aria-valuetext');
          if (window.barSeen.at(-1) !== value) window.barSeen.push(value);
          if ([...document.querySelectorAll('.wait-label')].some((label) => /^Extracting/.test(label.textContent))) window.extractingBesideBar = true;
        });
        window.barObserver.observe(document, {childList: true, subtree: true, attributes: true, attributeFilter: ['aria-valuenow']});
        const RealXhr = window.XMLHttpRequest;
        window.XMLHttpRequest = class extends RealXhr {
          open(method, url) { this.__url = String(url); this.__method = method; this.__headers = {}; if (!this.__url.startsWith('https://bucket.test/')) super.open(method, url); }
          setRequestHeader(name, value) { if (this.__url.startsWith('https://bucket.test/')) this.__headers[name] = value; else super.setRequestHeader(name, value); }
          send(body) {
            if (!this.__url.startsWith('https://bucket.test/')) { super.send(body); return; }
            window.uploadSeen.push({step: 'put', method: this.__method, headers: this.__headers, size: body?.size});
            const total = body.size;
            const steps = [0.3, 0.7, 1];
            const tick = (i) => {
              if (i < steps.length) { this.upload.onprogress?.({loaded: Math.round(total * steps[i]), total, lengthComputable: true}); setTimeout(() => tick(i + 1), 60); return; }
              Object.defineProperty(this, 'status', {value: 200});
              this.onload?.();
            };
            setTimeout(() => tick(0), 60);
          }
        };
        window.fetch = async (url, options = {}) => {
          const path = String(url);
          if (path.endsWith('/files/upload-address')) {
            // What the Tauri HTTP plugin says of a host outside its scope.
            if (window.failSend) throw new Error('url not allowed on the configured scope');
            if (window.failImport === 'expected') return new Response(JSON.stringify({detail:'File too large'}), {status:413});
            if (window.failImport) return new Response(JSON.stringify({detail:'PDF upload failed'}), {status:500});
            window.uploadSeen.push({step: 'address', body: JSON.parse(options.body)});
            return new Response(JSON.stringify({stored:false, file_path:'b'.repeat(64) + '.pdf', url:'https://bucket.test/uploads/' + 'b'.repeat(64) + '.pdf?X-Amz-Signature=sig',
              headers:{'content-type':'application/pdf', 'x-amz-checksum-sha256':'c2ln'}}));
          }
          if (path.endsWith('/uploaded')) {
            window.uploadSeen.push({step: 'uploaded', body: JSON.parse(options.body)});
            return new Response(JSON.stringify({job:'j1', file_path:'b'.repeat(64) + '.pdf', sha256:'b'.repeat(64)}), {status:202});
          }
          if (String(url).includes('/jobs/j1')) {
            // A reading that failed: every index the identifier was asked of was down.
            if (window.readingFails) return new Response(JSON.stringify({status:'failed', detail:'Metadata lookup failed', result:null}));
            if (!window.readingDone) return new Response(JSON.stringify({status:'running'}));
            // With knownVersion set, the reading found a paper Papol holds
            // already, by the DOI, under another hash.
            const existing = window.knownVersion ? {existing:{sha256:'k'.repeat(64), title:'Known paper', file_path:'k'.repeat(64) + '.pdf'}} : {};
            return new Response(JSON.stringify({status:'done', result:{
              doi:'10.1000/read', title:'Uploaded paper', authors:'["Ada Lovelace"]', journal:'Read Journal', year:2017,
              file_path:'b'.repeat(64) + '.pdf', ...existing,
            }}));
          }
          if (path.endsWith('/papers') && options.method === 'POST') {
            const body = JSON.parse(options.body);
            window.uploadSeen.push({step: 'save', body});
            return new Response(JSON.stringify({sha256: body.file_path.slice(0, 64), file_path: body.file_path, title: body.title,
              notes: [], also_read_by: [], rooms: [], tags: []}));
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
    assert.match(await browser.text(), /Paper Metadata/);
    if (mode === 'web') {
      // The bytes went to the bucket by the address the server gave, with
      // the headers it listed and no credential; the server was then told,
      // with the arXiv id the browser read off the first page.
      const seen = await browser.evaluate('return window.uploadSeen;');
      assert.deepEqual(seen.map((step) => step.step), ['address', 'put', 'uploaded']);
      assert.deepEqual(seen[0].body, { kind: 'paper', sha256: fixtureDigest, size: fixtureSize, name: 'attention.pdf', mime: 'application/pdf' });
      assert.equal(seen[1].method, 'PUT');
      assert.equal(seen[1].size, fixtureSize);
      assert.deepEqual(seen[1].headers, { 'content-type': 'application/pdf', 'x-amz-checksum-sha256': 'c2ln' });
      assert.deepEqual(seen[2].body, {
        file_path: `${'b'.repeat(64)}.pdf`, uploaded_name: 'attention.pdf', identifier: { arxiv_id: '1706.03762v7' },
      });
      // The wait was one bar, "Uploading", that reached the end before
      // "Extracting…" took its place (docs/waiting.md).
      const values = await browser.evaluate('return window.barSeen;');
      assert.ok(values.length >= 3, `the bar moved: ${JSON.stringify(values)}`);
      assert.ok(values.every((step) => step.startsWith('Uploading ')), `one label: ${JSON.stringify(values)}`);
      assert.match(values.at(-1), /^Uploading 100% /, `the bar reached the end: ${JSON.stringify(values)}`);
      assert.match(values.at(-1), new RegExp(`of ${(fixtureSize / 1024 / 1024).toFixed(1)} MB$`), `the detail is in bytes: ${values.at(-1)}`);
      assert.equal(await browser.evaluate('return window.extractingBesideBar;'), false, 'Extracting… never shared the screen with the bar');
      assert.equal(await browser.evaluate('return !!document.querySelector("[role=progressbar]");'), false, 'the bar is gone once the form is open');
    }

    // The form is open before the PDF has been read: the filename's title,
    // and a line saying the reading is on.
    const value = (id) => browser.evaluate(`return document.querySelector("#${id}").value;`);
    assert.equal(await value('upload-paper-title'), 'Attention');
    assert.match(await browser.text(), /Extracting…/);
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
    assert.doesNotMatch(await browser.text(), /Extracting…/);

    // Papol already holds a version of the work: the reading says so, the
    // form offers it, and the save names the version chosen — that one,
    // with the upload to let go of, or this one, as ever.
    const uploaded = `${(mode === 'native' ? 'a' : 'b').repeat(64)}.pdf`;
    const offered = async () => {
      await browser.evaluate('window.readingDone = false; window.knownVersion = true; window.uploadSeen = []; window.invoked = []; return true;');
      await choose();
      await browser.waitFor('document.querySelector("#upload-paper-title")');
      await browser.evaluate('window.readingDone = true; return true;');
      await browser.waitFor('document.querySelector(".known-version")', { what: 'the known version to be offered' });
      assert.match(await browser.text(), /Papol already has a version of this paper: Known paper/);
    };
    // The save: what was sent to the server, and what the nook wrote itself.
    const saved = async () => {
      await browser.evaluate('document.querySelector(".form-actions button.primary").click(); return true;');
      await browser.waitFor('document.querySelector("input[type=file]")', { what: 'the form to close after the save' });
      const posted = (await browser.evaluate('return window.uploadSeen;')).find((step) => step.step === 'save')?.body;
      const invoked = await browser.evaluate('return window.invoked;');
      return { posted, local: invoked.find((command) => command.startsWith('data_mutate:papers')), discarded: invoked.includes('blob_discard') };
    };
    await browser.evaluate('document.querySelector(".form-actions button").click(); return true;');
    await browser.waitFor('document.querySelector("input[type=file]")');
    await offered();
    assert.equal(await browser.evaluate('return document.querySelector(".known-version input[type=radio]").checked;'), true);
    // Taking the known version: saved on the server for that paper's file,
    // with the upload named to let go of; on the desktop the pending blob
    // goes too.
    const took = await saved();
    assert.equal(took.posted.file_path, `${'k'.repeat(64)}.pdf`);
    assert.equal(took.posted.discard_file_path, uploaded);
    assert.equal(took.local, undefined);
    assert.equal(took.discarded, mode === 'native');
    // Keeping this version: what always happened — the upload saved as a
    // paper of its own, in the nook itself on the desktop.
    await offered();
    await browser.evaluate('document.querySelectorAll(".known-version input[type=radio]")[1].click(); return true;');
    const kept = await saved();
    if (mode === 'native') {
      assert.equal(kept.posted, undefined);
      assert.match(kept.local, /^data_mutate:papers=aaaa\+copies=/);
    } else {
      assert.equal(kept.posted.file_path, uploaded);
      assert.equal(kept.posted.discard_file_path, undefined);
    }
    assert.equal(kept.discarded, false);
    await browser.evaluate('window.knownVersion = false; return true;');
    // A reading that failed leaves the form on the filename's title and
    // says so, quietly: a paper that could not be read is not a fault to
    // report. (Against a real Worker, a helper that is down is not this:
    // the job still answers, with the filename — scripts/share-e2e/upload.mjs.)
    await browser.evaluate('window.readingFails = true; return true;');
    await choose();
    await browser.waitFor('document.querySelector("#upload-paper-title")');
    await browser.waitFor("document.body.innerText.includes('Papol could not read the PDF; fill in the details.')",
      { what: 'the failed reading to be said' });
    assert.equal(await value('upload-paper-title'), 'Attention');
    assert.doesNotMatch(await browser.text(), /Extracting…/);
    assert.equal(await browser.evaluate('return !!document.querySelector("[role=dialog]");'), false);
    await browser.evaluate('document.querySelector(".form-actions button").click(); window.readingFails = false; return true;');
    await browser.waitFor('document.querySelector("input[type=file]")');
    if (mode === 'native') {
      // Kept in the nook but not sent: the form opens all the same, says
      // the PDF was not sent rather than that it could not be read, and
      // offers the fault for a report.
      await browser.evaluate('window.failSend = true; return true;');
      await choose();
      await browser.waitFor('document.querySelector("#upload-paper-title")');
      await browser.waitFor('document.querySelector("[role=dialog]")');
      assert.match(await browser.text(), /could not send the PDF to be read \(url not allowed on the configured scope\)/);
      assert.doesNotMatch(await browser.text(), /could not read the PDF/);
      assert.match(await browser.evaluate('return document.querySelector("#feedback-content").value;'), /sending a PDF to be read/);
      await browser.evaluate('document.querySelector("[role=dialog] .feedback-actions button").click();');
      await browser.waitFor('!document.querySelector("[role=dialog]")');
      await browser.evaluate('window.failSend = false; return true;');
    }
    console.log(`${mode}: expected errors stay inline, defects open diagnostics, retry opens the form before the PDF is read, the reading fills what was not typed, a known version is offered and the choice saved, and a reading that failed is said quietly${mode === 'native' ? '; a PDF not sent says so and offers a report' : ''}`);
  }
} catch (error) {
  // The page as the failed assertion left it, for a run that cannot be
  // watched (scripts/share-e2e/cdp.mjs, `capture`).
  await browser.capture('upload-smoke');
  throw error;
} finally {
  await browser.stop();
  await server.close();
}
