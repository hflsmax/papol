import assert from 'node:assert/strict';
import test from 'node:test';

import {
  destinationY,
  flattenOutline,
  headingParts,
  isFloatLabel,
  looksAppendix,
  markParts,
  readSections,
  sectionAt,
  topLevel,
} from './sections.js';

test('an outline flattens in reading order, two levels deep', () => {
  const flat = flattenOutline([
    { title: '1  Introduction', dest: 'sec1', items: [] },
    {
      title: '2 Method',
      dest: 'sec2',
      items: [
        { title: '2.1 Setup', dest: 'sec2.1', items: [{ title: '2.1.1 Data', dest: 'd' }] },
      ],
    },
    { title: 'no destination' },
  ]);
  assert.deepEqual(flat.map((entry) => [entry.level, entry.title]), [
    [0, '1 Introduction'],
    [0, '2 Method'],
    [1, '2.1 Setup'],
    [1, '2.1.1 Data'],
  ]);
});

test('a float is not a section, however the outline files it', () => {
  assert.equal(isFloatLabel('Fig. 1 Triangular facets as building blocks'), true);
  assert.equal(isFloatLabel('Figure 4'), true);
  assert.equal(isFloatLabel('Table 1 A sample of origami patterns'), true);
  assert.equal(isFloatLabel('Box 2 Notation'), true);
  // Prose that merely begins with the word.
  assert.equal(isFloatLabel('Figures of merit'), false);
  assert.equal(isFloatLabel('Tabulation and its discontents'), false);
  assert.equal(isFloatLabel('Conclusion'), false);
});

test('the publishers’ figure bookmarks are dropped on the way in', () => {
  const flat = flattenOutline([
    { title: 'Multistable inflatable origami structures', dest: 'root', items: [
      { title: 'Conclusion', dest: 'c' },
      { title: 'Fig. 1 Triangular facets as building blocks', dest: 'f1' },
      { title: 'Table 2 Patterns', dest: 't2' },
    ] },
  ]);
  assert.deepEqual(flat.map((entry) => entry.title), [
    'Multistable inflatable origami structures',
    'Conclusion',
  ]);
});

test('the top level is the shallowest one holding more than one entry', () => {
  // A paper that bookmarks its sections directly.
  assert.equal(topLevel([{ level: 0 }, { level: 0 }, { level: 1 }, { level: 1 }]), 0);
  // A publisher's outline: the whole article under one bookmark of its own
  // title, every real section a child of it.
  assert.equal(topLevel([{ level: 0 }, { level: 1 }, { level: 1 }, { level: 1 }]), 1);
  assert.equal(topLevel([]), 0);
  // Nothing has more than one entry; the only section there is still counts.
  assert.equal(topLevel([{ level: 0 }]), 0);
});

test('an outline title gives up a printed number but never a bare letter', () => {
  assert.deepEqual(headingParts('2.1 Setup'), { number: '2.1', title: 'Setup' });
  assert.deepEqual(headingParts('A.1 Proofs'), { number: 'A.1', title: 'Proofs' });
  assert.deepEqual(headingParts('A Simple Baseline'), { number: '', title: 'A Simple Baseline' });
});

test('a destination lands where it says, as a fraction from the page bottom', () => {
  const view = [0, 0, 612, 792];
  assert.ok(Math.abs(destinationY([{}, { name: 'XYZ' }, 72, 594, null], view) - 0.75) < 1e-9);
  assert.ok(Math.abs(destinationY([{}, { name: 'FitH' }, 396], view) - 0.5) < 1e-9);
  // A destination naming no height means the whole page.
  assert.equal(destinationY([{}, { name: 'Fit' }], view), 1);
  assert.equal(destinationY(null, view), 1);
});

test('a section that names itself an appendix is one', () => {
  assert.equal(looksAppendix({ title: 'Appendix A: Proofs' }), true);
  assert.equal(looksAppendix({ title: 'Supplementary Material' }), true);
  assert.equal(looksAppendix({ number: 'B', title: 'Extra results' }), true);
  assert.equal(looksAppendix({ number: '3', title: 'Method' }), false);
});

test('the paper divides into a body and an appendix at the first one', () => {
  const marked = markParts([
    { level: 0, number: '1', title: 'Introduction', page: 1, y: 0.9 },
    { level: 0, number: '', title: 'References', page: 7, y: 0.9 },
    { level: 0, number: 'A', title: 'Proofs', page: 8, y: 0.9, appendix: true },
    { level: 1, number: 'A.1', title: 'Lemmas', page: 8, y: 0.5 },
  ]);
  assert.deepEqual(marked.map((section) => section.appendix), [false, false, true, true]);
  assert.deepEqual(marked.map((section) => section.id), ['s0', 's1', 's2', 's3']);
});

test('nothing follows a bibliography but the back of the paper', () => {
  const marked = markParts([
    { level: 0, number: '1', title: 'Introduction', page: 1, y: 0.9 },
    { level: 0, number: '', title: 'References', page: 7, y: 0.9 },
    { level: 0, number: '', title: 'Attention Visualizations', page: 9, y: 0.9 },
  ]);
  assert.deepEqual(marked.map((section) => section.appendix), [false, false, true]);
});

test('back matter is found at whichever level the sections turned out to be', () => {
  const marked = markParts([
    { level: 0, number: '', title: 'A paper filed under its own title', page: 1, y: 0.9 },
    { level: 1, number: '', title: 'Introduction', page: 1, y: 0.5 },
    { level: 1, number: '', title: 'References', page: 8, y: 0.9 },
    { level: 1, number: '', title: 'Supplementary Figures', page: 9, y: 0.9 },
  ]);
  assert.deepEqual(marked.map((section) => section.appendix), [false, false, false, true]);
});

const outlineDoc = (entries, numPages = 12) => ({
  numPages,
  getOutline: async () => entries,
  getDestination: async (name) => [{ num: name.length }, { name: 'XYZ' }, 72, 700, null],
  getPageIndex: async (ref) => (ref.num % numPages),
  getPage: async () => ({ view: [0, 0, 612, 792] }),
});

test('the outline is the whole of it', async () => {
  const read = await readSections(outlineDoc([
    { title: '1 Introduction', dest: 'a' },
    { title: 'Appendix A: Proofs', dest: 'bb' },
  ]));
  assert.deepEqual(read.sections.map((s) => [s.number, s.title, s.appendix]), [
    ['1', 'Introduction', false],
    ['', 'Appendix A: Proofs', true],
  ]);
});

test('a paper with no outline has no sections, and says so quietly', async () => {
  const read = await readSections({ numPages: 20, getOutline: async () => null });
  assert.deepEqual(read.sections, []);
});

test('a single bookmark is a cover link, not a table of contents', async () => {
  const read = await readSections(outlineDoc([{ title: 'The paper', dest: 'a' }]));
  assert.deepEqual(read.sections, []);
});

test('an outline that will not resolve is not guessed at', async () => {
  const read = await readSections({
    numPages: 9,
    getOutline: async () => [
      { title: 'One', dest: 'a' }, { title: 'Two', dest: 'b' },
    ],
    getDestination: async () => null,
    getPageIndex: async () => { throw new Error('no such page'); },
    getPage: async () => ({ view: [0, 0, 612, 792] }),
  });
  assert.deepEqual(read.sections, []);
});

test('a cancelled read resolves to nothing at all', async () => {
  const doc = outlineDoc([{ title: 'One', dest: 'a' }, { title: 'Two', dest: 'b' }]);
  assert.equal(await readSections(doc, { cancelled: () => true }), null);
});

test('the section being read is the last one begun at or above it', () => {
  const sections = [
    { id: 's0', page: 1, y: 0.9 },
    { id: 's1', page: 3, y: 0.8 },
    { id: 's2', page: 3, y: 0.3 },
    { id: 's3', page: 6, y: 0.7 },
  ];
  assert.equal(sectionAt(sections, { page: 1, y: 0.5 })?.id, 's0');
  assert.equal(sectionAt(sections, { page: 2, y: 0.5 })?.id, 's0');
  assert.equal(sectionAt(sections, { page: 3, y: 0.85 })?.id, 's0');
  assert.equal(sectionAt(sections, { page: 3, y: 0.5 })?.id, 's1');
  assert.equal(sectionAt(sections, { page: 4, y: 0.9 })?.id, 's2');
  assert.equal(sectionAt(sections, { page: 9, y: 0.1 })?.id, 's3');
  // Landing on a heading names that section, not the one before it.
  assert.equal(sectionAt(sections, { page: 3, y: 0.81 })?.id, 's1');
  assert.equal(sectionAt(sections, null), null);
});
