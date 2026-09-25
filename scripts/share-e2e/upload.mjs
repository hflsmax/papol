// Uploading a paper, driven through the library's form against a real
// Worker, and the queue that reads it.
//
//     node scripts/share-e2e/fake-analyzer.mjs &    # the host's analyzer, stood in for
//     npx wrangler dev --test-scheduled \
//       --var ANALYZER_URL:http://127.0.0.1:8072 --var ANALYZER_AUTH:papol:e2e
//     node scripts/share-e2e/upload.mjs
//
// frontend/scripts/upload-smoke.mjs drives the same form against a faked
// server, which is how it can say what every answer looks like; this says
// the real answers come. The bytes reach the bucket, the reading is queued
// and woken, the Worker sends the PDF to the analyzer with its credential,
// what the analyzer read reaches the form, and the paper saved is in the
// library. Then the queue's other half: a job nobody woke is run by the
// cron sweep, triggered here through `wrangler dev --test-scheduled`.
//
// The analyzer is the stand-in (fake-analyzer.mjs), told per PDF what to
// answer, so every outcome is known before the upload: nothing read (the
// filename's title stands), a title block read, and an analyzer that fails.
// No PDF here carries a DOI or an arXiv id, so nothing is asked of
// CrossRef and the run needs no network beyond the machine.

import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Browser, checker } from './cdp.mjs';
import { account, BASE, call, freshPdf, storePdf } from './papol.mjs';

const ANALYZER = (process.env.PAPOL_FAKE_ANALYZER || 'http://127.0.0.1:8072').replace(/\/$/, '');
const CLOUDFLARE = fileURLToPath(new URL('../../cloudflare/', import.meta.url));
const suffix = randomBytes(3).toString('hex');
const files = mkdtempSync(join(tmpdir(), 'papol-upload-e2e-'));

const browser = new Browser({ headless: process.env.PAPOL_E2E_HEADED !== '1' });
const checks = checker(browser);
const { check } = checks;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// The title the form and the Worker both make of a filename
// (frontend/src/uploadReview.js, cloudflare/src/papers/extract.ts).
const titleFromFilename = (name) => name.replace(/\.[^.]*$/, '').replace(/[_-]/g, ' ')
  .replace(/\S+/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());

const analyzer = async (path, body) => {
  const response = await fetch(ANALYZER + path, body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`the stand-in analyzer answered ${response.status} for ${path}`);
  return response.json();
};

// The local D1, as the running Worker has it: wrangler reads and writes
// the same files under cloudflare/.wrangler/state.
function d1(sql) {
  const run = spawnSync('npx', ['wrangler', 'd1', 'execute', 'papol', '--local', '--json', '--command', sql], {
    cwd: CLOUDFLARE, encoding: 'utf8',
  });
  if (run.status !== 0) throw new Error(`wrangler d1 execute failed: ${run.stderr || run.stdout}`);
  // A banner in colour comes first, and its escapes hold `[` too: the
  // answer starts at the first line that is a bare `[`.
  const lines = run.stdout.replace(/\x1b\[[0-9;]*m/g, '').split('\n');
  return JSON.parse(lines.slice(lines.findIndex((line) => line.trim() === '[')).join('\n'))[0].results;
}

const job = async (token, uuid) => (await call('GET', `/api/jobs/${uuid}`, { token }))[1];

// A PDF of this run's, written where the file chooser can be pointed at it.
function pdfFile(name, words) {
  const bytes = freshPdf(`${words} ${suffix}`);
  const path = join(files, name);
  writeFileSync(path, bytes);
  return { name, path, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

// The upload's answer names the job that reads it; the page keeps it to
// itself, so it is read off the wire.
const jobs = [];
const watchUploads = () => {
  const uploads = new Set();
  browser.listeners.push(async (message) => {
    if (message.method === 'Network.responseReceived' && message.params.response.url.endsWith('/api/papers/uploaded')) {
      uploads.add(message.params.requestId);
    }
    if (message.method === 'Network.loadingFinished' && uploads.delete(message.params.requestId)) {
      const { body } = await browser.send('Network.getResponseBody', { requestId: message.params.requestId });
      jobs.push(JSON.parse(body).job);
    }
  });
};

const field = (id) => browser.evaluate(`return document.querySelector('#${id}')?.value ?? null;`);
const type = (id, value) => browser.evaluate(`
  const input = document.querySelector('#${id}');
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, ${JSON.stringify(value)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;`);

// Choose a file on the library's form, and wait for the reading to be over:
// the form opens at once on the filename's title, "Extracting…" beside it,
// and the line goes when the job has answered — filled in or not.
async function choose(file) {
  const before = jobs.length;
  await browser.waitFor('document.querySelector("input[type=file]")', { what: 'the upload form' });
  await browser.setFiles('input[type=file]', [file.path]);
  await browser.waitFor('document.querySelector("#upload-paper-title")', { timeout: 30_000, what: `the form for ${file.name}` });
  for (let i = 0; i < 100 && jobs.length === before; i += 1) await wait(100);
  await browser.waitFor("!document.body.innerText.includes('Extracting…')", { timeout: 60_000, what: `the reading of ${file.name}` });
  return jobs.length > before ? jobs.at(-1) : null;
}

const cancel = async () => {
  await browser.evaluate(`
    [...document.querySelectorAll('.form-actions button')].find((b) => !b.classList.contains('primary')).click();
    return true;`);
  await browser.waitFor('!document.querySelector("#upload-paper-title")', { what: 'the form to close' });
};

const unread = () => browser.evaluate("return document.body.innerText.includes('could not read the PDF');");
const sentToAnalyzer = async (file) => (await analyzer('/__seen')).filter((r) => r.sha256 === file.sha256 && r.path === '/header');

try {
  const me = await account(`uploader-${suffix}@papol.test`, 'Una Uploader');
  await browser.start();
  await browser.send('Network.enable');
  watchUploads();
  await browser.signIn({ token: me.token, accountUuid: me.uuid, origin: BASE });
  await browser.navigate(`${BASE}/library`);

  console.log('\n== A PDF the analyzer reads nothing from ==');
  const plain = pdfFile(`e2e-upload-${suffix}.pdf`, 'A paper for the upload check');
  const expected = titleFromFilename(plain.name);
  let uuid = await choose(plain);
  check('the form opens on the title its filename gives', await field('upload-paper-title') === expected,
    String(await field('upload-paper-title')));
  check('the reading ends without a word of failure', !(await unread()));
  let outcome = uuid ? await job(me.token, uuid) : null;
  check('the reading was woken and done', outcome?.status === 'done', JSON.stringify(outcome));
  check('and it answered the filename title', outcome?.result?.title === expected, JSON.stringify(outcome?.result));
  let sent = await sentToAnalyzer(plain);
  check('the Worker sent the analyzer the PDF itself, with its credential',
    sent.length === 1 && sent[0].type === 'application/pdf' && sent[0].pdf && sent[0].authorized && sent[0].size === plain.bytes.length,
    JSON.stringify(sent));

  // What the user adds is what is saved: an author and a year typed in.
  await type('upload-paper-authors', 'Grace Hopper');
  await type('upload-paper-year', '2026');
  await browser.evaluate("document.querySelector('.form-actions button.primary').click(); return true;");
  const opened = await browser.waitFor("location.pathname.startsWith('/paper/')", { timeout: 20_000, what: 'the saved paper to open' })
    .catch(() => false);
  check('saving opens the paper', opened, await browser.evaluate('return location.pathname;'));
  await browser.navigate(`${BASE}/library`);
  const listed = await browser.waitFor(
    `[...document.querySelectorAll('.paper-title-link')].some((a) => a.textContent.trim() === ${JSON.stringify(expected)})`,
    { timeout: 20_000, what: 'the paper in the library' }).catch(() => false);
  check('the library lists it', listed);
  const [, papers] = await call('GET', '/api/papers', { token: me.token });
  const saved = Array.isArray(papers) ? papers.find((p) => p.sha256 === plain.sha256) : null;
  check('the API has it under its digest', !!saved, `${papers?.length} papers`);
  check('with the title and the author as the form had them',
    saved?.title === expected && /Grace Hopper/.test(String(saved?.authors)) && saved?.year === 2026,
    JSON.stringify(saved && { title: saved.title, authors: saved.authors, year: saved.year }));

  console.log('\n== A PDF whose title block the analyzer reads ==');
  const read = pdfFile(`e2e-read-${suffix}.pdf`, 'A paper the stand-in reads');
  const header = {
    title: `What the Stand-in Read ${suffix}`, authors: ['Ada Lovelace', 'Alan Turing'],
    journal: 'Journal of Stand-ins', year: 2024,
  };
  await analyzer('/__plan', { sha256: read.sha256, header });
  await browser.navigate(`${BASE}/library`);
  uuid = await choose(read);
  check('the title is what the analyzer read', await field('upload-paper-title') === header.title,
    String(await field('upload-paper-title')));
  check('and the authors', await field('upload-paper-authors') === 'Ada Lovelace, Alan Turing',
    String(await field('upload-paper-authors')));
  check('and the journal and the year',
    await field('upload-paper-journal') === header.journal && await field('upload-paper-year') === '2024',
    `${await field('upload-paper-journal')} / ${await field('upload-paper-year')}`);
  sent = await sentToAnalyzer(read);
  check('from the PDF it was sent', sent.length === 1 && sent[0].pdf, JSON.stringify(sent));
  await cancel();

  console.log('\n== A PDF the analyzer fails on ==');
  const broken = pdfFile(`e2e-broken-${suffix}.pdf`, 'A paper the stand-in fails on');
  await analyzer('/__plan', { sha256: broken.sha256, status: 422, detail: 'The PDF could not be read: Invalid PDF structure.' });
  uuid = await choose(broken);
  // The analyzer is asked for the title block only as the last word, so one
  // that is down is a paper nothing was read from, not a reading that
  // failed (extract.ts, `titleBlock`): the form keeps the filename's title
  // and says nothing. "Papol could not read the PDF" is for a job that
  // failed — the indexes all down — which upload-smoke.mjs shows.
  check('the analyzer was asked, and failed', (await sentToAnalyzer(broken)).length === 1);
  check('the form keeps the title its filename gives',
    await field('upload-paper-title') === titleFromFilename(broken.name), String(await field('upload-paper-title')));
  outcome = uuid ? await job(me.token, uuid) : null;
  check('and the reading is done all the same', outcome?.status === 'done', JSON.stringify(outcome));
  check('with no line saying it failed', !(await unread()));
  await cancel();

  console.log('\n== A job nobody woke is run by the sweep ==');
  // A reading whose wake-up was lost: the row written as the upload route
  // writes it, and no message sent. `wrangler dev` never fires a cron on
  // its own, so nothing runs it until the sweep is asked for.
  const swept = pdfFile(`swept-${suffix}.pdf`, 'A paper nobody woke the reading of');
  const stored = await storePdf(me.token, swept.bytes, swept.name);
  const lost = crypto.randomUUID();
  const at = new Date(Date.now() - 1000).toISOString();
  const payload = JSON.stringify({ file_path: stored.file_path, uploaded_name: swept.name });
  d1(`INSERT INTO jobs (uuid, kind, "key", payload, status, user_uuid, attempts, run_at, created_at)
      VALUES ('${lost}', 'extract_metadata', NULL, '${payload}', 'queued', '${me.uuid}', 0, '${at}', '${at}')`);
  await wait(1500);
  outcome = await job(me.token, lost);
  check('the job waits, queued, with nothing to wake it', outcome?.status === 'queued', JSON.stringify(outcome));
  const cron = await fetch(`${BASE}/__scheduled?cron=${encodeURIComponent('*/2 * * * *')}`);
  check('the sweep is triggered', cron.ok, `${cron.status} ${await cron.text()}`);
  for (let i = 0; i < 40 && !['done', 'failed'].includes(outcome?.status); i += 1) {
    await wait(250);
    outcome = await job(me.token, lost);
  }
  check('and the job is done', outcome?.status === 'done', JSON.stringify(outcome));
  check('with the reading it would have had', outcome?.result?.title === titleFromFilename(swept.name),
    JSON.stringify(outcome?.result));
  const [row] = d1(`SELECT worker, attempts FROM jobs WHERE uuid = '${lost}'`);
  check('run by the sweep, once', row?.worker === 'cron:sweep' && row?.attempts === 1, JSON.stringify(row));
} catch (error) {
  console.log('\nHARNESS ERROR:', error.message);
  check('the run itself', false, error.message);
} finally {
  await checks.settle();
  await browser.stop();
}

const { failures } = checks;
console.log(`\n${'='.repeat(56)}`);
console.log(failures ? `${failures} FAILED` : 'All upload checks passed.');
process.exit(failures ? 1 : 0);
