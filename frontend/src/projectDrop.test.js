import assert from 'node:assert/strict';
import test from 'node:test';

import { addPdfToProject, droppedMetadata } from './projectDrop.js';

const PROJECT = 'b1b2c3d4-0000-4000-8000-000000000010';
const file = { name: 'attention_is_all_you_need.pdf' };

// The API as the pipeline sees it, recording what was asked of it.
function fakeApi({ digest = 'a'.repeat(64), read = null, createFails = null } = {}) {
  const calls = [];
  return {
    calls,
    sha256Hex: async () => digest,
    readIdentifier: () => null,
    uploadPaper: async () => { calls.push('upload'); return { sha256: digest, file_path: `${digest}.pdf`, job: 'j' }; },
    awaitPaperReading: async () => { calls.push('read'); return read; },
    listShelves: async () => [{ uuid: 'drafts', is_default: false }, { uuid: 'reading', is_default: true }],
    createPaper: async (data) => {
      calls.push(['create', data]);
      if (createFails) throw new Error(createFails);
      return { sha256: digest };
    },
    discardPaperImport: async () => { calls.push('discard'); },
    addPaperToProject: async (uuid, sha256) => { calls.push(['add', uuid, sha256]); return { uuid, papers: [{ sha256 }] }; },
  };
}

test('a dropped PDF goes to the nook on the default shelf, then into the project', async () => {
  const api = fakeApi({ read: { title: 'Attention Is All You Need', authors: '["A. Vaswani"]', year: '2017', journal: 'NeurIPS', doi: '10.1/x' } });
  const states = [];
  const result = await addPdfToProject(PROJECT, file, { onState: (s) => states.push(s) }, api);
  assert.deepEqual(states, ['uploading', 'reading', 'saving', 'adding']);
  const created = api.calls.find((c) => c[0] === 'create')[1];
  assert.equal(created.title, 'Attention Is All You Need');
  assert.equal(created.authors, '["A. Vaswani"]');
  assert.equal(created.year, 2017);
  assert.equal(created.shelf_uuid, 'reading');
  assert.equal(created.file_path, `${'a'.repeat(64)}.pdf`);
  assert.deepEqual(api.calls.at(-1), ['add', PROJECT, 'a'.repeat(64)]);
  assert.equal(result.sha256, 'a'.repeat(64));
});

test('a paper already in the nook is only added, not sent again', async () => {
  const api = fakeApi();
  const states = [];
  await addPdfToProject(PROJECT, file, { nookShas: new Set(['a'.repeat(64)]), onState: (s) => states.push(s) }, api);
  assert.deepEqual(states, ['uploading', 'adding']);
  assert.deepEqual(api.calls, [['add', PROJECT, 'a'.repeat(64)]]);
});

test('a version Papol already holds is the one the project gets', async () => {
  const api = fakeApi({ read: { title: 'T', existing: { sha256: 'b'.repeat(64), file_path: `${'b'.repeat(64)}.pdf` } } });
  const result = await addPdfToProject(PROJECT, file, {}, api);
  assert.equal(api.calls.find((c) => c[0] === 'create')[1].file_path, `${'b'.repeat(64)}.pdf`);
  assert.ok(api.calls.includes('discard'));
  assert.equal(result.sha256, 'b'.repeat(64));
});

test('a paper the server says is already in the nook is still added', async () => {
  const api = fakeApi({ createFails: 'This paper is already in your nook' });
  await addPdfToProject(PROJECT, file, {}, api);
  assert.deepEqual(api.calls.at(-1), ['add', PROJECT, 'a'.repeat(64)]);
});

test('any other failure stops before the project', async () => {
  const api = fakeApi({ createFails: 'Storage is full' });
  await assert.rejects(addPdfToProject(PROJECT, file, {}, api), /Storage is full/);
  assert.ok(!api.calls.some((c) => c[0] === 'add'));
});

test('with no reading, the paper is named after its file', () => {
  assert.deepEqual(droppedMetadata(file, null), {
    title: 'Attention Is All You Need', authors: '[]', journal: null, year: null, doi: null,
  });
  assert.equal(droppedMetadata(file, { authors: ['X'] }).authors, '["X"]');
});
