import test from 'node:test';
import assert from 'node:assert/strict';
import { destinationHeight } from './sections.js';

import {
  columnsOnPage, consolidateCitations, destinationNumber,
  pageOverlays, readNamedReference, referenceAt, stillToLookUp,
} from './references.js';

test('consolidates analyzer rows for one continuous citation range', () => {
  const citations = Array.from({ length: 19 }, (_, index) => ({
    referenceUuid: 700 + index,
    label: `[${7 + index}]`,
    x: index === 0 ? 0.4605 : index === 18 ? 0.4688 : 0.4647,
    y: 0.7126,
    w: index === 0 ? 0.0042 : index === 18 ? 0.0083 : 0.0041,
    h: 0.0069,
    exact: true,
  }));

  const consolidated = consolidateCitations(citations);
  assert.equal(consolidated.length, 1);
  assert.deepEqual(
    consolidated[0].referenceUuids,
    Array.from({ length: 19 }, (_, index) => 700 + index),
  );
  assert.equal(consolidated[0].referenceUuid, 700);
});

test('consolidates adjacent PDF annotation fragments into one citation link', async () => {
  const page = {
    getViewport: () => ({
      width: 100, height: 100, scale: 1, transform: [1, 0, 0, 1, 0, 0],
      convertToViewportPoint: (x, y) => [x, 100 - y],
    }),
    getAnnotations: async () => [
      { subtype: 'Link', dest: 'cite.paper', rect: [10, 80, 14, 82] },
      { subtype: 'Link', dest: 'cite.paper', rect: [14, 80, 18, 82] },
      { subtype: 'Link', dest: 'cite.paper', rect: [18, 80, 22, 82] },
    ],
  };
  const doc = { getPage: async () => page };

  const overlays = await pageOverlays(doc, 1, null);

  assert.equal(overlays.citations.length, 1);
  assert.equal(overlays.citations[0].referenceUuid, 'pdf:cite.paper');
  assert.deepEqual(overlays.citations[0].referenceUuids, ['pdf:cite.paper']);
  assert.equal(overlays.citations[0].x, 0.1);
  assert.equal(overlays.citations[0].w, 0.12);
});

test('reads the vertical position from each PDF destination shape', () => {
  const page = { num: 275, gen: 0 };

  assert.equal(destinationHeight([page, { name: 'XYZ' }, 0, 730.917, null]), 730.917);
  assert.equal(destinationHeight([page, { name: 'FitH' }, 730.917]), 730.917);
  assert.equal(destinationHeight([page, { name: 'FitBH' }, 730.917]), 730.917);
  assert.equal(destinationHeight([page, { name: 'Fit' }]), null);
});

test('distinguishes tightly spaced references using the raised-link offset', () => {
  const references = [
    { uuid: 407, page: 15, y: 0.5584217171717172, title: 'CodeT5' },
    { uuid: 398, page: 15, y: 0.5622474747474747, title: 'Synchromesh' },
  ];

  assert.equal(
    referenceAt(references, { page: 15, y: 0.5515151515151515 }).uuid,
    407,
  );
  assert.equal(
    referenceAt(references, { page: 15, y: 0.5553472222222222 }).uuid,
    398,
  );
});

test('turns an analyzed figure reference into a link to the float it names', async () => {
  const doc = {
    getPage: async () => ({ getAnnotations: async () => [] }),
  };
  const analysis = {
    references: [],
    citations: [],
    floats: [{ uuid: 'f-2', kind: 'figure', label: '2', page: 3, x: 0.1, y: 0.55, w: 0.8, h: 0.3 }],
    links: [{
      float_uuid: 'f-2', label: '2a', page: 2,
      x: 0.28, y: 0.41, w: 0.01, h: 0.02,
    }],
  };

  const overlays = await pageOverlays(doc, 2, analysis);
  assert.deepEqual(overlays.links, [{
    kind: 'figure', label: '2a',
    x: 0.28, y: 0.41, w: 0.01, h: 0.02,
    spot: { page: 3, y: 0.55, kind: 'figure', box: { x: 0.1, y: 0.55, w: 0.8, h: 0.3 } },
  }]);
});

test('recognizes Springer Nature superscript reference destinations without analysis', async () => {
  const dest = 'springernature_natcomputsci_673.indd:\uFEFF12.\uFEFF\tBertoldi, K. et al. Flexible mechanical metamaterials.:65';
  const page = {
    getViewport: () => ({
      width: 100, height: 100, scale: 1, transform: [1, 0, 0, 1, 0, 0],
      convertToViewportPoint: (x, y) => [x, 100 - y],
    }),
    getAnnotations: async () => [
      { subtype: 'Link', dest, rect: [80, 20, 83, 25] },
    ],
  };
  const doc = { getPage: async () => page };

  const overlays = await pageOverlays(doc, 1, null);

  assert.equal(overlays.links.length, 0);
  assert.equal(overlays.citations.length, 1);
  assert.equal(overlays.citations[0].reference.key, '12');
  assert.equal(overlays.citations[0].reference.dest, dest);
});


test('a section link lands on its heading at the top of the window, not centred like a figure', async () => {
  const doc = { getPage: async () => ({ getAnnotations: async () => [] }) };
  const analysis = {
    references: [],
    citations: [],
    floats: [{ uuid: 's-2.1', kind: 'section', label: '2.1', page: 2, x: 0.09, y: 0.3, w: 0.3, h: 0.015 }],
    links: [{ float_uuid: 's-2.1', label: '2.1', page: 1, x: 0.5, y: 0.6, w: 0.08, h: 0.015 }],
  };

  const overlays = await pageOverlays(doc, 1, analysis);
  assert.deepEqual(overlays.links.map((l) => [l.kind, l.label, l.spot]), [['section', '2.1', { page: 2, y: 0.3, kind: 'section', box: { x: 0.09, y: 0.3, w: 0.3, h: 0.015 } }]]);
});

// A Nature page: the publisher links only the first number of a
// superscript marker, and only the number of a figure mention.
function natureLinks() {
  const dest = (n) => `springernature_nature_3623.indd:\uFEFF${n}.\uFEFF\tAuthor, A. Title ${n}.:1${n}`;
  return {
    getViewport: () => ({
      width: 100, height: 100, scale: 1, transform: [1, 0, 0, 1, 0, 0],
      convertToViewportPoint: (x, y) => [x, 100 - y],
    }),
    getAnnotations: async () => [
      { subtype: 'Link', dest: dest(66), rect: [10, 80, 12, 82] }, // "66" of "66–73"
      { subtype: 'Link', dest: dest(76), rect: [40, 80, 42, 82] }, // "76" of "76,77"
      { subtype: 'Link', dest: dest(90), rect: [70, 80, 72, 82] }, // a marker the analyzer missed
    ],
  };
}

test("an analyzed marker wins over the publisher's link to its first number", async () => {
  const page = natureLinks();
  const doc = { getPage: async () => page };
  const cite = (uuid, x, w, label) => ({ reference_uuid: uuid, label, page: 1, x, y: 0.18, w, h: 0.02, inferred: false });
  const range = ['r66', 'r67', 'r68', 'r69', 'r70', 'r71', 'r72', 'r73'].map((uuid) => cite(uuid, 0.1, 0.05, '66–73'));
  const list = ['r76', 'r77'].map((uuid) => cite(uuid, 0.4, 0.04, '76,77'));

  const overlays = await pageOverlays(doc, 1, { references: [], citations: [...range, ...list], links: [] });

  const labels = overlays.citations.map((c) => [c.label, c.referenceUuids?.length ?? 1]);
  assert.deepEqual(labels.slice(0, 2), [['66–73', 8], ['76,77', 2]]);
  // The one the analyzer did not read is still the publisher's.
  assert.equal(overlays.citations.length, 3);
  assert.equal(overlays.citations[2].reference.key, '90');
});

test("an analyzed figure mention wins over the publisher's link to its number", async () => {
  const page = {
    getViewport: () => ({
      width: 100, height: 100, scale: 1, transform: [1, 0, 0, 1, 0, 0],
      convertToViewportPoint: (x, y) => [x, 100 - y],
    }),
    getAnnotations: async () => [{ subtype: 'Link', dest: 'Fig3', rect: [34, 80, 38, 82] }], // "3b"
  };
  const doc = {
    getPage: async () => page,
    getDestination: async () => [{}, { name: 'XYZ' }, 0, 700],
    getPageIndex: async () => 4,
  };
  const analysis = {
    references: [],
    citations: [],
    floats: [{ uuid: 'f-3', kind: 'figure', label: '3', page: 5, x: 0.1, y: 0.1, w: 0.8, h: 0.4 }],
    links: [{ float_uuid: 'f-3', label: '3b', page: 1, x: 0.28, y: 0.18, w: 0.1, h: 0.02 }], // "Fig. 3b"
  };

  const overlays = await pageOverlays(doc, 1, analysis);

  assert.deepEqual(overlays.links.map((l) => [l.label, l.x, l.w]), [['3b', 0.28, 0.1]]);
});

// A two-column bibliography, as Elsevier and ACM set them. Entries run down
// the left column and then down the right, so y climbs and then falls back to
// the top of the page at r25 — which is the only sign, from where entries
// sit, that r25 and r26 are printed beside r18 and r19 rather than below.
function columnedBibliography() {
  return [
    // left column
    { uuid: 'r18', index: 18, page: 10, y: 0.16483 },
    { uuid: 'r19', index: 19, page: 10, y: 0.19493 },
    { uuid: 'r20', index: 20, page: 10, y: 0.20498 },
    // right column, back at the top of the page
    { uuid: 'r25', index: 25, page: 10, y: 0.15434 },
    { uuid: 'r26', index: 26, page: 10, y: 0.17442 },
  ];
}

test('refuses a cross-column guess rather than naming the wrong entry', () => {
  // KinetiX's "[20]" destination lands here. The right column's [27] is
  // nearer this height than the left column's [20] is, and a destination
  // carries no x to tell them apart.
  const picked = referenceAt(columnedBibliography(), { page: 10, y: 0.17624 });
  assert.equal(picked, null);
});

test('still matches by height when the bibliography is one column', () => {
  // The same entries with no column break: y only ever climbs.
  const singleColumn = columnedBibliography().filter((r) => r.index <= 20);
  const picked = referenceAt(singleColumn, { page: 10, y: 0.18800 });
  assert.equal(picked.uuid, 'r19');
});

test('reads the column break out of where the entries sit', () => {
  const column = columnsOnPage(columnedBibliography(), 10);
  const of = (uuid) => [...column].find(([r]) => r.uuid === uuid)[1];
  assert.equal(of('r18'), 0);
  assert.equal(of('r20'), 0);
  assert.equal(of('r25'), 1, 'y falls back to the top: a new column');
  assert.equal(of('r26'), 1);
});

test('reads the entry number out of a publisher destination name', () => {
  assert.equal(destinationNumber('bib0020'), 20);
  assert.equal(destinationNumber('c20'), 20);
  assert.equal(destinationNumber('cite.20'), 20);
  assert.equal(destinationNumber('cite.Parreaux2022'), null);
  assert.equal(destinationNumber('fig0003'), null);
});

test('a numbered destination names its entry despite a columned bibliography', async () => {
  const references = columnedBibliography();
  const page = {
    getViewport: () => ({
      width: 100, height: 100, scale: 1, transform: [1, 0, 0, 1, 0, 0],
      convertToViewportPoint: (x, y) => [x, 100 - y],
    }),
    getAnnotations: async () => [
      { subtype: 'Link', dest: 'bib0020', rect: [30, 44, 34, 46] },
    ],
  };
  const doc = {
    getPage: async () => page,
    // Where the geometric match would have landed on the right column.
    getDestination: async () => [{}, { name: 'XYZ' }, 0, 82.376],
    getPageIndex: async () => 9,
  };

  const overlays = await pageOverlays(doc, 1, { references, citations: [], links: [] });

  assert.equal(overlays.citations.length, 1);
  assert.equal(overlays.citations[0].referenceUuid, 'r19');
});

test("prefers the analyzer's labelled marker over where a link points", async () => {
  const references = columnedBibliography();
  const page = {
    getViewport: () => ({
      width: 100, height: 100, scale: 1, transform: [1, 0, 0, 1, 0, 0],
      convertToViewportPoint: (x, y) => [x, 100 - y],
    }),
    getAnnotations: async () => [
      { subtype: 'Link', dest: 'cite.opaque', rect: [30, 44, 34, 46] },
    ],
  };
  const doc = {
    getPage: async () => page,
    getDestination: async () => [{}, { name: 'XYZ' }, 0, 82.376],
    getPageIndex: async () => 9,
  };
  // The analyzer read this very marker and knows it says "[20]".
  const citations = [
    { reference_uuid: 'r19', label: '[20]', page: 1, x: 0.30, y: 0.54, w: 0.04, h: 0.02, inferred: false },
  ];

  const overlays = await pageOverlays(doc, 1, { references, citations, links: [] });

  const cite = overlays.citations.find((c) => c.referenceUuid === 'r19');
  assert.ok(cite, 'the analyzer\'s reading should win');
  assert.equal(cite.label, '[20]');
});

test('reads a bibliography entry without splicing in the next column', async () => {
  // Two columns, each with entries at the same heights, as Elsevier sets them.
  const span = (text, x, y) => ({ str: text, transform: [1, 0, 0, 1, x, y] });
  const page = {
    getViewport: () => ({ width: 600, height: 800, scale: 1 }),
    getTextContent: async () => ({
      items: [
        span('[20] Hoberman C. Hoberman sphere. 1990.', 58, 654),
        span('ISBN 978-1-4503-3634-5. Proc. UIST.', 327, 654),
        span('http://www.hoberman.com/ .', 58, 644),
        span('http://doi.acm.org/10.1145/2776880 .', 327, 644),
        span('[21] Fischer U. Tabula Rasa table. 1987.', 58, 634),
      ],
    }),
  };
  const doc = {
    getDestination: async () => [{}, { name: 'XYZ' }, 0, 654],
    getPageIndex: async () => 9,
    getPage: async () => page,
  };

  const raw = await readNamedReference(doc, 'bib0020');

  assert.match(raw, /Hoberman sphere/);
  assert.match(raw, /hoberman\.com/);
  assert.doesNotMatch(raw, /doi\.acm\.org/, 'the next column must not bleed in');
  assert.doesNotMatch(raw, /Tabula Rasa/, 'the next entry must not bleed in');
});

test('reads the entry a destination names, not the column it lands beside', async () => {
  // Elsevier sets "bib0027" some twenty points above entry [27], which puts
  // it nearer [26] in its own column and nearer still to [19] in the column
  // alongside. Where it landed cannot tell those apart; what it is called can.
  const span = (text, x, y) => ({ str: text, transform: [1, 0, 0, 1, x, y] });
  const page = {
    getViewport: () => ({ width: 600, height: 800, scale: 1 }),
    getTextContent: async () => ({
      items: [
        span('[26] Grima JN. Auxetic behaviour from connected squares.', 312, 666),
        span('[19] Wang P, Casadei F. Harnessing buckling to design tunable', 43, 658),
        span('locally resonant acoustic metamaterials. Phys Rev Lett.', 58, 650),
        span('[27] Coumans E. Bullet physics simulation. SIGGRAPH 2015.', 312, 650),
        span('[20] Hoberman C. Hoberman sphere. 1990.', 43, 634),
        span('[28] Mamou K. Github repository of v-hacd.', 312, 626),
      ],
    }),
  };
  const doc = {
    numPages: 10,
    getDestination: async () => [{}, { name: 'XYZ' }, 0, 670],
    getPageIndex: async () => 9,
    getPage: async () => page,
  };

  const raw = await readNamedReference(doc, 'bib0027');

  assert.match(raw, /Bullet physics simulation/);
  assert.doesNotMatch(raw, /Harnessing buckling/, 'the column alongside must not win');
  assert.doesNotMatch(raw, /Auxetic behaviour/, 'the entry above must not win');
  assert.doesNotMatch(raw, /v-hacd/, 'the next entry must not bleed in');
});

test('follows a destination set at a page break to the entry overleaf', async () => {
  // The first entry of a bibliography page has its annotation set at the foot of
  // the page before, where nothing is numbered at all.
  const span = (text, x, y) => ({ str: text, transform: [1, 0, 0, 1, x, y] });
  const printed = {
    9: [span('mechanism, we can create self-actuated structures.', 43, 60)],
    10: [
      span('[16] Lakes R, Elms K. Indentability of conventional foams.', 43, 730),
      span('[17] Choi JB. Fracture toughness of re-entrant foam.', 43, 706),
    ],
  };
  const doc = {
    numPages: 10,
    getDestination: async () => [{}, { name: 'XYZ' }, 0, 59],
    getPageIndex: async () => 8,
    getPage: async (number) => ({
      getViewport: () => ({ width: 600, height: 800, scale: 1 }),
      getTextContent: async () => ({ items: printed[number] }),
    }),
  };

  const raw = await readNamedReference(doc, 'bib0016');

  assert.match(raw, /Indentability of conventional/);
  assert.doesNotMatch(raw, /self-actuated/, 'the page it landed on prints no entry 16');
  assert.doesNotMatch(raw, /Fracture toughness/, 'the next entry must not bleed in');
});

test('a marker citing several works has the rest looked up with the one shown', () => {
  const known = new Map([
    ['r119', { uuid: 'r119' }],
    ['r120', { uuid: 'r120', resolved_status: 'ok' }],
    ['r121', { uuid: 'r121', resolved_status: null }],
    ['r122', { uuid: 'r122' }],
  ]);
  const underWay = new Set(['r122']);
  // Shown: 119. Already resolved: 120. Being asked for: 122. A PDF-only link has no row.
  assert.deepEqual(stillToLookUp(['r119', 'r120', 'r121', 'r122', 'pdf:cite.x'], 'r119', known, underWay), ['r121']);
  assert.deepEqual(stillToLookUp(['r76', 'r77'], 'r76', new Map(), new Set()), ['r77']);
});
