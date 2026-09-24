import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  MANIFEST_NAME, agentInstructions, droppedFolder, filesFromPicker, filesInFolder, folderPath,
  folderRows, identifierFor, importSummary, parseManifest, rowAddable, rowMetadata, rowStatus,
  rowTitle,
} from './agentFolder.js';

const pdf = (path, size = 1000) => ({ path, file: { name: path.split('/').pop(), type: 'application/pdf', size } });

test('the manifest describes papers, and says nothing about where they go', () => {
  const { papers, error } = parseManifest(JSON.stringify({
    papol: 1,
    shelf: 'Thesis review',
    papers: [{
      file: './sub\\diffusion.pdf', doi: 'https://doi.org/10.15607/RSS.2023.XIX.026',
      arxiv: 'arXiv:2303.04137v2', title: '  Diffusion Policy ', note: 'Why it matters.', tags: ['x'],
    }],
  }));
  assert.equal(error, undefined);
  assert.deepEqual(papers, [{
    file: 'sub/diffusion.pdf', doi: '10.15607/RSS.2023.XIX.026', arxiv_id: '2303.04137v2',
    title: 'Diffusion Policy', note: 'Why it matters.',
  }]);
});

test('a manifest that cannot be read says why', () => {
  assert.match(parseManifest('{ nope').error, /not valid JSON/);
  assert.match(parseManifest('[]').error, /should hold an object/);
  assert.match(parseManifest('{"papol": 2, "papers": []}').error, /newer Papol/);
  assert.match(parseManifest('{"papol": 1}').error, /no "papers" list/);
  // No version is taken as the first.
  assert.deepEqual(parseManifest('{"papers": []}'), { papers: [] });
});

test('an identifier that is not one is dropped, and an empty entry with it', () => {
  const { papers } = parseManifest(JSON.stringify({ papers: [
    { file: 'a.pdf', doi: 'not a doi', arxiv: 'hello' },
    { note: 'nothing to find this by' },
    'a string',
  ] }));
  assert.deepEqual(papers, [{ file: 'a.pdf', doi: null, arxiv_id: null, title: null, note: null }]);
});

test('the review lists the manifest in its order, then the other PDFs', () => {
  const files = [
    pdf('z-extra.pdf'), pdf('b.pdf'), pdf('Sub/A.PDF'),
    { path: MANIFEST_NAME, file: { name: MANIFEST_NAME, type: 'application/json', size: 10 } },
    { path: 'notes.txt', file: { name: 'notes.txt', type: 'text/plain', size: 10 } },
  ];
  const manifest = parseManifest(JSON.stringify({ papers: [
    { file: 'b.pdf', note: 'b' },
    { file: 'sub/a.pdf', note: 'a, matched ignoring case' },
    { file: 'gone.pdf', title: 'Missing' },
    { doi: '10.1000/paywalled', title: 'Paywalled' },
    { file: 'b.pdf', note: 'a second entry for b is not a second paper' },
  ] }));
  const rows = folderRows(files, manifest);
  assert.deepEqual(rows.map((row) => [row.path, row.problem, row.entry?.note ?? null]), [
    ['b.pdf', null, 'b'],
    ['Sub/A.PDF', null, 'a, matched ignoring case'],
    ['gone.pdf', 'missing', null],
    [null, 'no-pdf', null],
    ['z-extra.pdf', null, null],
  ]);
  assert.equal(new Set(rows.map((row) => row.key)).size, rows.length);
});

test('a manifest file is found by its name alone when that name is unique', () => {
  const rows = folderRows([pdf('papers/one.pdf'), pdf('two/x.pdf'), pdf('three/x.pdf')], parseManifest(JSON.stringify({ papers: [
    { file: 'one.pdf' }, { file: 'x.pdf' },
  ] })));
  assert.deepEqual(rows.map((row) => [row.path, row.problem]), [
    ['papers/one.pdf', null],
    ['x.pdf', 'missing'],
    ['three/x.pdf', null],
    ['two/x.pdf', null],
  ]);
});

test('a folder with no manifest lists every PDF, and a PDF too large says so', () => {
  const rows = folderRows([pdf('b.pdf'), pdf('a.pdf', 500 * 1024 * 1024)], null);
  assert.deepEqual(rows.map((row) => [row.path, row.problem]), [['a.pdf', 'too-large'], ['b.pdf', null]]);
  assert.match(rowStatus(rows[0]), /Larger than/);
});

test('a row is titled by what the user typed, the reading, the manifest, the filename', () => {
  const row = { path: 'attention_is-all.pdf', entry: { title: 'From the manifest' } };
  assert.equal(rowTitle({ path: row.path }), 'Attention Is All');
  assert.equal(rowTitle(row), 'From the manifest');
  assert.equal(rowTitle({ ...row, reading: { title: 'Read' } }), 'Read');
  assert.equal(rowTitle({ ...row, reading: { title: 'Read' }, editedTitle: ' Typed ' }), 'Typed');
  assert.equal(rowTitle({ ...row, editedTitle: '   ' }), 'From the manifest');
});

test('the manifest fills what the reading did not find, and never a paper Papol holds', () => {
  const entry = { doi: '10.1000/manifest', title: 'Manifest title' };
  assert.deepEqual(rowMetadata({ path: 'x.pdf', entry, reading: null }), {
    title: 'Manifest title', authors: '[]', journal: null, year: null, doi: '10.1000/manifest',
  });
  assert.deepEqual(rowMetadata({
    path: 'x.pdf', entry,
    reading: { title: 'Read', authors: '["A. Author"]', journal: 'J', year: '2020', doi: '10.1000/printed' },
  }), { title: 'Read', authors: '["A. Author"]', journal: 'J', year: 2020, doi: '10.1000/printed' });
  const library = { title: 'Corrected by a reader', authors: '["B"]', journal: null, year: 2019, doi: '10.1000/held' };
  assert.deepEqual(rowMetadata({ path: 'x.pdf', entry, library, reading: { title: 'Read' } }), {
    title: 'Corrected by a reader', authors: '["B"]', journal: null, year: 2019, doi: '10.1000/held',
  });
});

test('the identifier sent is the printed one, else the manifest\'s', async () => {
  assert.deepEqual(await identifierFor(Promise.resolve({ doi: '10.1/printed' }), { doi: '10.1/manifest' }), { doi: '10.1/printed' });
  assert.deepEqual(await identifierFor(Promise.resolve(null), { doi: '10.1/manifest' }), { doi: '10.1/manifest' });
  assert.deepEqual(await identifierFor(Promise.reject(new Error('unreadable')), { arxiv_id: '2303.04137' }), { arxiv_id: '2303.04137' });
  assert.equal(await identifierFor(Promise.resolve(null), null), null);
});

test('only a PDF that went up, and is not the nook\'s already, can be added', () => {
  assert.equal(rowAddable({ state: 'ready' }), true);
  assert.equal(rowAddable({ state: 'reading' }), true);
  assert.equal(rowAddable({ state: 'uploading' }), false);
  assert.equal(rowAddable({ state: 'yours' }), false);
  assert.equal(rowAddable({ state: 'ready', problem: 'missing' }), false);
  assert.equal(importSummary([
    { state: 'added' }, { state: 'added' }, { state: 'yours' }, { problem: 'no-pdf' }, { state: 'failed' },
  ]), '2 added, 1 already yours, 2 problems');
  assert.equal(importSummary([{ state: 'added' }]), '1 added');
});

test('a dropped folder is taken only when it is the one thing dropped', () => {
  const directory = { isDirectory: true, name: 'Review' };
  const item = (entry) => ({ kind: 'file', webkitGetAsEntry: () => entry });
  assert.equal(droppedFolder({ items: [item(directory)] }), directory);
  assert.equal(droppedFolder({ items: [item({ isDirectory: false })] }), null);
  assert.equal(droppedFolder({ items: [item(directory), item(directory)] }), null);
  assert.equal(droppedFolder({ items: [{ kind: 'string' }] }), null);
  assert.equal(droppedFolder(null), null);
});

test('a dropped folder is walked for its files, hidden ones left out', async () => {
  const file = (name) => ({ name, isDirectory: false, file: (resolve) => resolve({ name }) });
  const directory = (name, children) => ({
    name, isDirectory: true,
    createReader: () => {
      // Entries arrive in batches until an empty one, as WebKit gives them.
      const batches = [children.slice(0, 1), children.slice(1), []];
      return { readEntries: (resolve) => resolve(batches.shift()) };
    },
  });
  const read = await filesInFolder(directory('Review', [
    file('a.pdf'), file('.DS_Store'), directory('sub', [file('b.pdf')]), directory('.git', [file('c.pdf')]),
  ]));
  assert.equal(read.name, 'Review');
  assert.deepEqual(read.files.map(({ path }) => path), ['a.pdf', 'sub/b.pdf']);
});

test('a chosen folder\'s paths lose the folder\'s own name', () => {
  const chosen = filesFromPicker([
    { name: 'a.pdf', webkitRelativePath: 'Review/a.pdf' },
    { name: 'b.pdf', webkitRelativePath: 'Review/sub/b.pdf' },
    { name: '.DS_Store', webkitRelativePath: 'Review/.DS_Store' },
  ]);
  assert.equal(chosen.name, 'Review');
  assert.deepEqual(chosen.files.map(({ path }) => path), ['a.pdf', 'sub/b.pdf']);
  assert.equal(folderPath('./x\\y.pdf'), 'x/y.pdf');
});

test('the instructions point the agent at the format, and the format says what the parser reads', () => {
  const prompt = agentInstructions('https://papol.io/agent-folder.txt');
  assert.match(prompt, /papol\.json/);
  assert.match(prompt, /https:\/\/papol\.io\/agent-folder\.txt/);
  const format = readFileSync(new URL('../public/agent-folder.txt', import.meta.url), 'utf8');
  const example = JSON.parse(format.slice(format.indexOf('{\n  "papol"'), format.indexOf('\n}\n') + 2));
  const { papers, error } = parseManifest(JSON.stringify(example));
  assert.equal(error, undefined);
  assert.deepEqual(Object.keys(example.papers[0]).sort(), ['arxiv', 'doi', 'file', 'note', 'title']);
  assert.ok(papers[0].file && papers[0].doi && papers[0].arxiv_id && papers[0].title && papers[0].note);
});
