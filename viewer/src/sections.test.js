import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bodyTextSize,
  coherentSections,
  destinationY,
  flattenOutline,
  headingFromText,
  headingParts,
  headingsFromLines,
  keepHeadings,
  linesFromItems,
  markParts,
  promoteTitles,
  readSections,
  sectionAt,
} from './sections.js';

test('a numbered heading gives up its number and its title', () => {
  assert.deepEqual(headingFromText('3 Method'), {
    number: '3', title: 'Method', level: 0, appendix: false,
  });
  assert.deepEqual(headingFromText('3.2. Training the model'), {
    number: '3.2', title: 'Training the model', level: 1, appendix: false,
  });
});

test('a heading deeper than a subsection is folded into one', () => {
  assert.equal(headingFromText('4.1.2 Optimizer')?.level, 1);
  assert.equal(headingFromText('4.1.2 Optimizer')?.number, '4.1.2');
});

test('the sections every paper has are recognised unnumbered', () => {
  assert.equal(headingFromText('Abstract')?.title, 'Abstract');
  assert.equal(headingFromText('References')?.title, 'References');
  assert.equal(headingFromText('Related Work')?.number, '');
  assert.equal(headingFromText('Acknowledgements:')?.title, 'Acknowledgements');
  assert.equal(headingFromText('the introduction of a prior'), null);
});

test('an appendix says so, and opens the back of the paper', () => {
  assert.deepEqual(headingFromText('Appendix A: Proofs'), {
    number: 'A', title: 'Proofs', level: 0, appendix: true,
  });
  assert.equal(headingFromText('Appendix')?.appendix, true);
  assert.equal(headingFromText('A.1 Dataset details')?.appendix, true);
  assert.equal(headingFromText('A.1 Dataset details')?.level, 1);
});

test('a bare capital is a section number only once an appendix is open', () => {
  assert.equal(headingFromText('B Additional results'), null);
  assert.deepEqual(headingFromText('B Additional results', { appendixOpen: true }), {
    number: 'B', title: 'Additional results', level: 0, appendix: true,
  });
});

test('what only looks like a heading is turned away', () => {
  // A caption.
  assert.equal(headingFromText('Figure 3: Accuracy against model size'), null);
  assert.equal(headingFromText('Table 1 Results'), null);
  // A line of a printed table of contents.
  assert.equal(headingFromText('3 Method . . . . . . . . 7'), null);
  // A sentence that happens to start with the word Appendix.
  assert.equal(headingFromText('Appendix A contains the full proofs.'), null);
  // A sentence that happens to start with a number.
  assert.equal(headingFromText('3 of the five models were trained from scratch'), null);
  // Too long to be a heading.
  assert.equal(headingFromText(`1 ${'word '.repeat(30)}`), null);
});

test('text items become printed lines, split at a two-column gutter', () => {
  const item = (str, x, y, width, size = 10) => ({
    str, width, height: size, transform: [size, 0, 0, size, x, y], fontName: 'f1',
  });
  const lines = linesFromItems(
    [
      item('3', 40, 700, 8),
      item('Method', 52, 700, 50),
      item('4', 320, 700, 8),
      item('Results', 332, 700, 52),
    ],
    { pageWidth: 612, pageHeight: 792, pageBottom: 0 },
  );
  assert.deepEqual(lines.map((line) => line.text), ['3 Method', '4 Results']);
  // y is a fraction of the page, measured from its bottom, as an anchor's is.
  assert.ok(Math.abs(lines[0].y - 700 / 792) < 1e-9);
});

test('items broken mid-word are rejoined without a space', () => {
  const item = (str, x, width) => ({
    str, width, height: 10, transform: [10, 0, 0, 10, x, 500], fontName: 'f1',
  });
  const [line] = linesFromItems([item('Intro', 40, 25), item('duction', 65, 35)], {
    pageWidth: 612, pageHeight: 792,
  });
  assert.equal(line.text, 'Introduction');
});

test('the body size is the size carrying the most characters', () => {
  assert.equal(bodyTextSize([
    { size: 9.96, text: 'x'.repeat(400) },
    { size: 9.96, text: 'x'.repeat(400) },
    { size: 14, text: 'A heading' },
  ]), 10);
});

test('a page full of candidates is a contents page, and offers none', () => {
  const lines = Array.from({ length: 9 }, (unused, index) => ({
    text: `${index + 1} Section ${index + 1}`, y: 0.5, size: 12, bold: false,
  }));
  assert.deepEqual(headingsFromLines(lines, { page: 2 }).headings, []);
});

test('a candidate printed in the margin is a running head, not a heading', () => {
  const found = headingsFromLines(
    [{ text: '2 Method', y: 0.98, size: 12, bold: false }],
    { page: 4 },
  );
  assert.deepEqual(found.headings, []);
});

test('a heading opening an appendix opens it for the lines after it', () => {
  const found = headingsFromLines(
    [
      { text: 'Appendix', y: 0.9, size: 14, bold: false },
      { text: 'B Extra results', y: 0.5, size: 12, bold: false },
    ],
    { page: 9 },
  );
  assert.deepEqual(found.headings.map((heading) => heading.number), ['', 'B']);
  assert.equal(found.appendixOpen, true);
});

test('a candidate no larger and no heavier than the body is not a heading', () => {
  const candidates = [
    { number: '3', title: 'Method', page: 3, y: 0.8, size: 12, bold: false },
    { number: '3.1', title: 'We then compute the loss', page: 3, y: 0.4, size: 10, bold: false },
    { number: '', title: 'References', page: 8, y: 0.9, size: 10, bold: true },
    { number: '', title: 'Acknowledgements', page: 8, y: 0.5, size: 10, bold: false },
  ];
  const kept = keepHeadings(candidates, { bodySize: 10, pageCount: 10 });
  assert.deepEqual(kept.map((heading) => heading.title), ['Method', 'References']);
});

test('a phrase printed on most pages is furniture', () => {
  const running = Array.from({ length: 6 }, (unused, index) => ({
    number: '', title: 'References', page: index + 1, y: 0.97, size: 12, bold: true,
  }));
  assert.deepEqual(keepHeadings(running, { bodySize: 10, pageCount: 8 }), []);
});

test('a line short of letters is mathematics, not a heading', () => {
  assert.equal(headingFromText('Z Z', { appendixOpen: true }), null);
  assert.equal(headingFromText('C Wlog 1+ !1:', { appendixOpen: true }), null);
  assert.equal(headingFromText('B Proofs of Theorem 4', { appendixOpen: true })?.title,
    'Proofs of Theorem 4');
});

test('an appendix numbered but unnamed keeps the only words it has', () => {
  assert.deepEqual(headingFromText('APPENDIX 5'), {
    number: '5', title: 'APPENDIX 5', level: 0, appendix: true,
  });
  assert.equal(headingFromText('Appendix B: Proofs')?.title, 'Proofs');
});

test('numbering that is not the paper\'s own is thrown out as a body', () => {
  // A numbered list, deep in a paper, that looks like sections one by one.
  const noise = [
    { level: 0, number: '1', title: 'Random malfunction', page: 19, y: 0.7 },
    { level: 0, number: '2', title: 'Malicious intelligence', page: 19, y: 0.4 },
    { level: 0, number: '', title: 'References', page: 20, y: 0.9 },
  ];
  assert.deepEqual(
    coherentSections(noise, { pageCount: 20 }).map((section) => section.title),
    ['References'],
  );
});

test('a number that repeats or goes backwards leaves the run', () => {
  const sections = [
    { level: 0, number: '1', title: 'Introduction', page: 1, y: 0.9 },
    { level: 0, number: '2', title: 'Method', page: 2, y: 0.9 },
    { level: 1, number: '2.1', title: 'Setup', page: 2, y: 0.5 },
    { level: 0, number: '1', title: 'A numbered list item', page: 3, y: 0.5 },
    { level: 0, number: '3', title: 'Results', page: 4, y: 0.9 },
  ];
  assert.deepEqual(
    coherentSections(sections, { pageCount: 6 }).map((section) => section.title),
    ['Introduction', 'Method', 'Setup', 'Results'],
  );
});

test('an unnumbered heading is found at the size the paper sets headings', () => {
  const headings = [
    { number: '1', title: 'Introduction', page: 1, y: 0.9, size: 12 },
    { number: '2', title: 'Method', page: 2, y: 0.9, size: 12 },
  ];
  const loose = [
    { number: '', title: 'Attention Visualizations', page: 9, y: 0.9, size: 12 },
    // A figure label, set larger than any heading in the paper.
    { number: '', title: 'Input Input Layer', page: 9, y: 0.5, size: 19.6 },
    // Body prose that happens to be short and capitalised.
    { number: '', title: 'We Then Compute', page: 3, y: 0.4, size: 10 },
  ];
  assert.deepEqual(
    promoteTitles(headings, loose, { bodySize: 10 }).map((heading) => heading.title),
    ['Introduction', 'Method', 'Attention Visualizations'],
  );
});

test('a paper whose headings are set at body size is not guessed at', () => {
  const headings = [{ number: '1', title: 'Introduction', page: 1, y: 0.9, size: 10 }];
  const loose = [{ number: '', title: 'Table Column Header', page: 4, y: 0.5, size: 10 }];
  assert.deepEqual(
    promoteTitles(headings, loose, { bodySize: 10 }).map((heading) => heading.title),
    ['Introduction'],
  );
});

test('nothing follows a bibliography but the back of the paper', () => {
  const marked = markParts([
    { level: 0, number: '1', title: 'Introduction', page: 1, y: 0.9 },
    { level: 0, number: '', title: 'References', page: 7, y: 0.9 },
    { level: 0, number: '', title: 'Attention Visualizations', page: 9, y: 0.9 },
  ]);
  assert.deepEqual(marked.map((section) => section.appendix), [false, false, true]);
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

test('the outline answers when the paper carries one', async () => {
  const doc = {
    numPages: 12,
    getOutline: async () => [
      { title: '1 Introduction', dest: 'a' },
      { title: 'Appendix A: Proofs', dest: 'b' },
    ],
    getDestination: async (name) => (name === 'a'
      ? [{ num: 3 }, { name: 'XYZ' }, 72, 700, null]
      : [{ num: 9 }, { name: 'XYZ' }, 72, 396, null]),
    getPageIndex: async (ref) => (ref.num === 3 ? 0 : 8),
    getPage: async () => ({
      view: [0, 0, 612, 792],
      getTextContent: async () => ({ items: [], styles: {} }),
      cleanup: () => {},
    }),
  };
  const read = await readSections(doc);
  assert.equal(read.from, 'outline');
  assert.deepEqual(read.sections.map((s) => [s.number, s.title, s.page, s.appendix]), [
    ['1', 'Introduction', 1, false],
    ['', 'Appendix A: Proofs', 9, true],
  ]);
});

test('a paper with no outline is read from its text', async () => {
  const at = (str, x, y, size) => ({
    str, width: str.length * size * 0.5, height: size,
    transform: [size, 0, 0, size, x, y], fontName: 'f1',
  });
  const pages = [
    [at('Abstract', 40, 700, 13), at('We show that '.repeat(12), 40, 600, 10)],
    [at('1 Introduction', 40, 700, 13), at('Papers are long. '.repeat(12), 40, 600, 10)],
    [at('2 Method', 40, 700, 13), at('We optimise the loss. '.repeat(12), 40, 600, 10)],
  ];
  const doc = {
    numPages: pages.length,
    getOutline: async () => null,
    getPage: async (number) => ({
      view: [0, 0, 612, 792],
      getTextContent: async () => ({ items: pages[number - 1], styles: {} }),
      cleanup: () => {},
    }),
  };
  const read = await readSections(doc, { yieldToMain: async () => {} });
  assert.equal(read.from, 'text');
  assert.deepEqual(read.sections.map((section) => section.title), [
    'Abstract', 'Introduction', 'Method',
  ]);
  assert.deepEqual(read.sections.map((section) => section.page), [1, 2, 3]);
});

test('a cancelled read resolves to nothing at all', async () => {
  const doc = {
    numPages: 2,
    getOutline: async () => null,
    getPage: async () => ({ view: [0, 0, 612, 792], getTextContent: async () => ({ items: [] }) }),
  };
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
