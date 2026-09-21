import test from 'node:test';
import assert from 'node:assert/strict';

import { assembleExport, untar } from '../../shared/exportArchive.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// A ustar writer just big enough to make what the Worker sends.
function tar(files) {
  const blocks = [];
  for (const [path, content] of Object.entries(files)) {
    const bytes = typeof content === 'string' ? encoder.encode(content) : content;
    const header = new Uint8Array(512);
    const put = (offset, text) => header.set(encoder.encode(text), offset);
    put(0, path);
    put(100, '0000644\0');
    put(108, '0000000\0');
    put(116, '0000000\0');
    put(124, `${bytes.length.toString(8).padStart(11, '0')}\0`);
    put(136, '00000000000\0');
    put(148, '        ');
    put(156, '0');
    put(257, 'ustar\0');
    put(263, '00');
    put(148, `${header.reduce((a, b) => a + b, 0).toString(8).padStart(6, '0')}\0 `);
    blocks.push(header, bytes, new Uint8Array((512 - (bytes.length % 512)) % 512));
  }
  blocks.push(new Uint8Array(1024));
  const out = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0));
  let at = 0;
  for (const block of blocks) { out.set(block, at); at += block.length; }
  return out;
}

test('untar gives back every plain file under its full name, and stops at the end blocks', () => {
  const bytes = tar({
    'papol-export-2026-09-21/README.txt': 'Your Papol export\n',
    'papol-export-2026-09-21/nook.json': '[]',
    'papol-export-2026-09-21/exact.bin': new Uint8Array(512).fill(7),
  });
  const entries = untar(bytes);
  assert.deepEqual([...entries.keys()], ['papol-export-2026-09-21/README.txt', 'papol-export-2026-09-21/nook.json', 'papol-export-2026-09-21/exact.bin']);
  assert.equal(decoder.decode(entries.get('papol-export-2026-09-21/README.txt')), 'Your Papol export\n');
  assert.equal(entries.get('papol-export-2026-09-21/exact.bin').length, 512);
  assert.ok(entries.get('papol-export-2026-09-21/exact.bin').every((b) => b === 7));
});

test('untar refuses bytes whose header checksum does not add up', () => {
  const bytes = tar({ 'a.txt': 'a' });
  bytes[0] ^= 0xff;
  assert.throws(() => untar(bytes), /not a Papol export/);
});

test('assembleExport lays the fetched files beside the data, stored as they are, and names the ones it could not fetch', async () => {
  const manifest = [
    { path: 'pdfs/on-leaving-2024.pdf', url: '/uploads/cafe.pdf', size: 5 },
    { path: 'pdfs/gone.pdf', url: '/uploads/gone.pdf', size: 3 },
    { path: 'board-files/b1/i1-photo.png', url: '/api/board-items/i1/file', size: 4 },
  ];
  const bytes = tar({
    'papol-export-2026-09-21/README.txt': 'read me',
    'papol-export-2026-09-21/files.json': JSON.stringify(manifest),
  });
  const asked = [];
  const progress = [];
  const fetchFile = async (file) => {
    asked.push(file.url);
    if (file.url === '/uploads/gone.pdf') throw new Error('404');
    return encoder.encode(file.url.startsWith('/api/') ? 'png!' : '%PDF!');
  };
  const { root, entries, failed } = await assembleExport(bytes, fetchFile, { onProgress: (p) => progress.push(p), concurrency: 2 });

  assert.equal(root, 'papol-export-2026-09-21/');
  assert.deepEqual(asked.sort(), ['/api/board-items/i1/file', '/uploads/cafe.pdf', '/uploads/gone.pdf']);
  assert.deepEqual(failed, ['pdfs/gone.pdf']);
  assert.deepEqual(Object.keys(entries).sort(), [
    'papol-export-2026-09-21/README.txt',
    'papol-export-2026-09-21/board-files/b1/i1-photo.png',
    'papol-export-2026-09-21/files.json',
    'papol-export-2026-09-21/pdfs/on-leaving-2024.pdf',
  ]);
  assert.deepEqual(entries['papol-export-2026-09-21/README.txt'][1], { level: 6 });
  assert.deepEqual(entries['papol-export-2026-09-21/pdfs/on-leaving-2024.pdf'][1], { level: 0 });
  assert.equal(decoder.decode(entries['papol-export-2026-09-21/pdfs/on-leaving-2024.pdf'][0]), '%PDF!');
  assert.deepEqual(progress, [{ done: 0, total: 3 }, { done: 1, total: 3 }, { done: 2, total: 3 }, { done: 3, total: 3 }]);
});

test('assembleExport refuses an archive that names no files', async () => {
  const bytes = tar({ 'papol-export-2026-09-21/README.txt': 'read me' });
  await assert.rejects(assembleExport(bytes, async () => new Uint8Array()), /names no files/);
});
