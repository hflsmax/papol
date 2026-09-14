import test from 'node:test';
import assert from 'node:assert/strict';

import {
  citationNumbers, consolidateCitations, destinationY, pageOverlays, referenceAt,
} from './references.js';

test('expands every reference in numeric citation ranges', () => {
  assert.deepEqual(citationNumbers('1–7'), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(citationNumbers('2, 4-6; 9'), [2, 4, 5, 6, 9]);
});

test('consolidates linked range endpoints into one navigable citation', async () => {
  const page = {
    getViewport: () => ({ width: 100, height: 100, scale: 1, transform: [1, 0, 0, 1, 0, 0] }),
    getAnnotations: async () => [
      { subtype: 'Link', dest: 'first', rect: [10, 10, 12, 12] },
      { subtype: 'Link', dest: 'last', rect: [18, 10, 20, 12] },
    ],
    getTextContent: async () => ({ items: [{ str: '[1–7]', width: 10, transform: [1, 0, 0, 2, 10, 12] }] }),
  };
  const doc = {
    getPage: async () => page,
    getDestination: async (dest) => [{ dest }, { name: 'XYZ' }, 0, dest === 'first' ? 99 : 93],
    getPageIndex: async () => 0,
  };
  const references = Array.from({ length: 7 }, (_, index) => ({
    uuid: index + 100, index, page: 1, y: index === 0 ? 0.01 : index === 6 ? 0.07 : 0.04,
  }));

  const overlays = await pageOverlays(doc, 1, { references, citations: [], links: [] });
  assert.equal(overlays.citations.length, 1);
  assert.deepEqual(overlays.citations[0].referenceUuids, [100, 101, 102, 103, 104, 105, 106]);
});

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

  assert.equal(destinationY([page, { name: 'XYZ' }, 0, 730.917, null]), 730.917);
  assert.equal(destinationY([page, { name: 'FitH' }, 730.917]), 730.917);
  assert.equal(destinationY([page, { name: 'FitBH' }, 730.917]), 730.917);
  assert.equal(destinationY([page, { name: 'Fit' }]), null);
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

test('turns an analyzed figure reference into an internal PDF link', async () => {
  const doc = {
    getPage: async () => ({ getAnnotations: async () => [] }),
  };
  const analysis = {
    references: [],
    citations: [],
    links: [{
      kind: 'figure', label: '2', page: 2,
      x: 0.28, y: 0.41, w: 0.01, h: 0.02,
      target_page: 2, target_y: 0.55,
    }],
  };

  const overlays = await pageOverlays(doc, 2, analysis);
  assert.deepEqual(overlays.links, [{
    kind: 'figure', label: '2',
    x: 0.28, y: 0.41, w: 0.01, h: 0.02,
    spot: { page: 2, y: 0.55 },
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
