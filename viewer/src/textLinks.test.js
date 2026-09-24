import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { findTextLinks, linkPieces, runningText } from './textLinks.js';
import { pageOverlays } from './references.js';

const hrefs = (text) => findTextLinks(text).map((link) => [link.href, text.slice(link.index, link.index + link.length)]);

test('finds web addresses, and stops short of the sentence around them', () => {
  assert.deepEqual(hrefs('Code is at https://github.com/tensorflow/tensor2tensor. See also www.example.org, today.'), [
    ['https://github.com/tensorflow/tensor2tensor', 'https://github.com/tensorflow/tensor2tensor'],
    ['http://www.example.org/', 'www.example.org'],
  ]);
  assert.deepEqual(hrefs('(see https://example.org/a_(b)/c)'), [
    ['https://example.org/a_(b)/c', 'https://example.org/a_(b)/c'],
  ]);
});

test('finds email addresses, but not a version number that looks like one', () => {
  assert.deepEqual(hrefs('Write to avaswani@google.com or noam@google.com.'), [
    ['mailto:avaswani@google.com', 'avaswani@google.com'],
    ['mailto:noam@google.com', 'noam@google.com'],
  ]);
  assert.deepEqual(hrefs('pkg@1.2.3 is not an address'), []);
});

test('finds DOIs, with their own brackets and without the sentence\'s', () => {
  assert.deepEqual(hrefs('doi:10.1038/nature14539. Also (10.1016/0370-2693(96)01084-X).'), [
    ['https://doi.org/10.1038/nature14539', 'doi:10.1038/nature14539'],
    ['https://doi.org/10.1016/0370-2693(96)01084-X', '10.1016/0370-2693(96)01084-X'],
  ]);
  // A DOI inside an address is the address's.
  assert.deepEqual(hrefs('https://doi.org/10.1038/nature14539'), [
    ['https://doi.org/10.1038/nature14539', 'https://doi.org/10.1038/nature14539'],
  ]);
});

test('reads a page as running text, joining a line broken after a hyphen', () => {
  const items = [
    { str: 'see https://my-', hasEOL: true },
    { str: 'site.org/x and', hasEOL: true },
    { str: 'more' },
  ];
  const { text, from } = runningText(items);
  assert.equal(text, 'see https://my-site.org/x and more');
  const [link] = findTextLinks(text);
  assert.equal(link.href, 'https://my-site.org/x');
  assert.deepEqual(linkPieces(from, link.index, link.length), [
    { itemIndex: 0, start: 4, end: 15 },
    { itemIndex: 1, start: 0, end: 10 },
  ]);
});

test('puts boxes over the addresses printed on a real paper', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(await readFile(new URL(
    '../../frontend/scripts/fixtures/attention.pdf', import.meta.url,
  )));
  const task = pdfjs.getDocument({ data, verbosity: 0 });
  const doc = await task.promise;
  try {
    const { links } = await pageOverlays(doc, 1, null);
    const printed = links.filter((link) => link.href?.startsWith('mailto:'));
    assert.ok(printed.some((link) => link.href === 'mailto:avaswani@google.com'));
    for (const link of printed) {
      for (const side of [link.x, link.y, link.w, link.h]) assert.ok(side >= 0 && side <= 1);
    }
  } finally {
    await task.destroy();
  }
});
