import assert from 'node:assert/strict';
import test from 'node:test';

import {
  destinationY,
  flattenOutline,
  headingParts,
  headingY,
  isBibliography,
  isEndMatter,
  isFrontMatter,
  isFloatLabel,
  looksAppendix,
  looksLikeContents,
  markParts,
  destinationHeight,
  readSections,
  topLevel,
  withoutEndMatter,
} from './sections.js';

test('an outline flattens in reading order, each entry at its own depth', () => {
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
    [2, '2.1.1 Data'],
  ]);
});

test('subsections stay below their sections when the paper is filed under its title', () => {
  const flat = flattenOutline([{
    title: 'Untethered soft actuators',
    dest: 'title',
    items: [
      { title: 'Diverse types of soft actuating methods', dest: 'a', items: [
        { title: 'Magnetically-driven soft actuators', dest: 'a1' },
        { title: 'Heat-driven soft actuators', dest: 'a2' },
      ] },
      { title: 'Discussion', dest: 'b' },
    ],
  }]);
  assert.deepEqual(flat.map((entry) => entry.level), [0, 1, 2, 2, 1]);
  // The sections are level 1 here, and their subsections are not among them.
  assert.equal(topLevel(flat), 1);
  assert.deepEqual(
    flat.filter((entry) => entry.level === topLevel(flat)).map((entry) => entry.title),
    ['Diverse types of soft actuating methods', 'Discussion'],
  );
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

test('only a destination with a height says how far down the page it lands', () => {
  assert.equal(destinationHeight([{}, { name: 'XYZ' }, 72, 594, null]), 594);
  assert.equal(destinationHeight([{}, { name: 'FitH' }, 396]), 396);
  assert.equal(destinationHeight([{}, { name: 'XYZ' }, 72, null, null]), null);
  assert.equal(destinationHeight([{}, { name: 'Fit' }]), null);
  assert.equal(destinationHeight(null), null);
});

const piece = (str, x, y, height = 10) => ({
  str, height, width: str.length * height * 0.5, transform: [1, 0, 0, height, x, y],
});

test('a heading the outline only gave a page for is found where it is printed', () => {
  const view = [0, 0, 486, 720];
  const items = [
    piece('as discussed in the conclusion of related work, stacks', 60, 660),
    piece('8', 60, 625.4), piece('CONCLUSION', 78, 625.4),
    piece('We have presented a stack-aware compiler.', 60, 600),
    piece('REFERENCES', 60, 395.8),
  ];
  const conclusion = headingY(items, { number: '8', title: 'Conclusion' }, view);
  const references = headingY(items, { number: '', title: 'References' }, view);
  assert.ok(Math.abs(conclusion - (625.4 + 10) / 720) < 1e-9);
  assert.ok(Math.abs(references - (395.8 + 10) / 720) < 1e-9);
  // Two sections on one page are no longer the same place.
  assert.ok(conclusion > references);
});

test('a heading is a run of pieces on one line, never part of a sentence', () => {
  const view = [0, 0, 600, 800];
  // Small capitals, the far column sharing a baseline, and a ligature.
  const items = [
    piece('this is related work in the sense that', 320, 500),
    piece('7', 40, 500), piece('R', 58, 500, 12), piece('ELATED', 66, 500, 9), piece('W', 110, 500, 12), piece('ORK', 120, 500, 9),
    piece('Speci\uFB01cation', 320, 300),
  ];
  assert.ok(Math.abs(headingY(items, { number: '7', title: 'Related Work' }, view) - 512 / 800) < 1e-9);
  assert.ok(Math.abs(headingY(items, { number: '', title: 'Specification' }, view) - 310 / 800) < 1e-9);
  assert.equal(headingY(items, { number: '', title: 'Related' }, view), null);
  assert.equal(headingY(items, { number: '9', title: 'Missing' }, view), null);
  assert.equal(headingY([], { number: '1', title: 'Introduction' }, view), null);
});

test('an outline of bare page destinations is placed by the printed headings', async () => {
  const items = [piece('8', 60, 625.4), piece('CONCLUSION', 78, 625.4), piece('REFERENCES', 60, 395.8)];
  const doc = {
    numPages: 3,
    getOutline: async () => [
      { title: '8 Conclusion', dest: [2, { name: 'Fit' }] },
      { title: 'References', dest: [2, { name: 'Fit' }] },
    ],
    getPage: async () => ({ view: [0, 0, 486, 720], getTextContent: async () => ({ items }) }),
  };
  const { sections } = await readSections(doc);
  assert.deepEqual(sections.map((section) => section.page), [3, 3]);
  assert.ok(sections[0].y > sections[1].y && sections[1].y < 1);
});

test('an outline of production filenames is not a table of contents', () => {
  const book = ['0521857570pre_pi-xiv.pdf', '0521857570c01_p7-16.pdf', '0521857570c02_p17-27.pdf']
    .map((title, index) => ({ title, page: index * 10 + 1, y: 1 }));
  assert.equal(looksLikeContents(book), false);
  const forms = ['63: 281432c8-5add', 'AUMACA002E-800598-20170701', 'ARINCA200E-801534-20190701',
    'AUCEON001E-800690-20240101'].map((title, index) => ({ title, page: index + 1, y: 1 }));
  assert.equal(looksLikeContents(forms), false);
});

test('an outline that keeps doubling back is not describing this paper', () => {
  // Four of eleven destinations resolved to page one: References on p1 of 11.
  const pages = [1, 1, 4, 7, 1, 1, 11, 11, 1, 11, 1];
  const review = pages.map((page, index) => ({ title: `Section ${index} name`, page, y: 1 }));
  assert.equal(looksLikeContents(review), false);
});

test('an ordinary outline passes, single-word titles and one stray included', () => {
  const paper = [
    { title: 'Abstract', page: 1, y: 0.7 },
    { title: 'Introduction', page: 1, y: 0.4 },
    { title: 'Method', page: 3, y: 0.9 },
    { title: 'Setup', page: 3, y: 0.9 },   // a subsection at its parent's own spot
    { title: 'Results', page: 6, y: 0.5 },
    { title: 'Acknowledgements', page: 5, y: 0.2 },   // one stray is forgiven
    { title: 'References', page: 8, y: 0.9 },
  ];
  assert.equal(looksLikeContents(paper), true);
  // Two columns: the next heading is at the top of the right-hand column,
  // higher on the page than the one before it. That is typesetting.
  assert.equal(looksLikeContents([
    { title: 'Challenges and opportunities', page: 4, y: 0.2 },
    { title: 'Integration of inputs', page: 4, y: 0.9 },
    { title: 'Resilience in harsh environments', page: 5, y: 0.3 },
  ]), true);
  assert.equal(looksLikeContents([{ title: 'Only one', page: 1, y: 1 }]), false);
});

test('the notices are the ones the shelf\'s own outlines carry', () => {
  // Every one of these was read off a PDF here, in the case it was written.
  for (const title of [
    'Acknowledgements', 'Acknowledgments', '7 Acknowledgments', 'Author contributions',
    'Competing interests', 'Additional information', 'FURTHER INFORMATION',
    '9 Data Availability Statement', 'Data availability', "Publisher's note",
  ]) assert.equal(isEndMatter(title), true, title);
  // Plausible end matter that no paper here prints stays out until one does,
  // and a section whose title merely opens with such a word is never one.
  for (const title of [
    'References', 'Conclusion', 'Discussion', 'Supplementary information',
    'Funding', 'Conflict of interest', 'Ethics declarations', 'Reporting summary',
    'Funding models for open science', 'Data', 'Ethics of disclosure',
  ]) assert.equal(isEndMatter(title), false, title);
});

test('the notices leave the sections, and take what is filed under them', () => {
  const sections = [
    { level: 0, title: 'A paper filed under its title' },
    { level: 1, title: 'Discussion' },
    { level: 2, title: 'Limitations' },
    { level: 1, title: 'References' },
    { level: 1, title: 'Acknowledgements' },
    { level: 1, title: 'Additional information' },
    { level: 2, title: 'Reprints' },
    { level: 1, title: 'Appendix' },
  ];
  assert.deepEqual(withoutEndMatter(sections).map((section) => section.title), [
    'A paper filed under its title', 'Discussion', 'Limitations', 'References', 'Appendix',
  ]);
});

test('the two ends of a paper are known by name', () => {
  // 29 of the 42 outlined papers here open on this word, and none opens on
  // any other; the list holds nothing that has not been seen.
  for (const title of ['Abstract', 'ABSTRACT', 'abstract'])
    assert.equal(isFrontMatter(title), true, title);
  // Other publishers' names for the same page are left out until a paper
  // here uses one, and a real section that merely contains the word is not
  // front matter — every one of these is a title this shelf holds.
  for (const title of [
    'Summary', 'Significance', 'Highlights', 'Keywords', 'CCS Concepts',
    'Introduction', 'Results', 'Discussion', 'Overview',
    'Overview of CompCertX', 'Summary of supplementary information',
    'The Abstract Stack', 'Contributions and Overview',
  ]) assert.equal(isFrontMatter(title), false, title);
  for (const title of ['References', 'Bibliography', '8 References', 'Works Cited'])
    assert.equal(isBibliography(title), true, title);
  for (const title of ['Reference frames', 'Related Work']) assert.equal(isBibliography(title), false, title);
});
