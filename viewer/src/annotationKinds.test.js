import test from 'node:test';
import assert from 'node:assert/strict';
import { annotationKinds, inkIn, notesIn } from './annotationKinds.js';

function recorder(rows = []) {
  const calls = [];
  return {
    calls,
    annotations: {
      list: async (kind) => {
        calls.push(['list', kind]);
        return rows;
      },
      create: async (annotation) => {
        calls.push(['create', annotation]);
        return { uuid: 'new', ...annotation };
      },
      update: async (uuid, changes) => {
        calls.push(['update', uuid, changes]);
        return { uuid, kind: 'ink', body: { points: [] }, ...changes };
      },
      remove: async (uuid) => calls.push(['remove', uuid]),
    },
  };
}

test('each kind is asked for by name', async () => {
  const source = recorder();
  const kinds = annotationKinds(source.annotations);

  await kinds.notes.list();
  await kinds.ink.list();
  await kinds.clips.list();

  assert.deepEqual(source.calls, [
    ['list', 'note'],
    ['list', 'ink'],
    ['list', 'clip'],
  ]);
});

test('geometry is spread flat for the code that draws it', () => {
  const rows = [
    { uuid: 'a', kind: 'ink', page: 2, body: { points: [{ x: 0.1, y: 0.2 }], color: '#111111' } },
    { uuid: 'b', kind: 'note', page: 1, body: { anchor: { type: 'point', x: 0.3, y: 0.4 } } },
  ];

  assert.deepEqual(inkIn(rows)[0].points, [{ x: 0.1, y: 0.2 }]);
  assert.equal(inkIn(rows)[0].color, '#111111');
  assert.deepEqual(notesIn(rows)[0].anchor, { type: 'point', x: 0.3, y: 0.4 });
});

test('making an annotation names its kind and gathers its geometry', async () => {
  const source = recorder();
  const kinds = annotationKinds(source.annotations);

  await kinds.notes.create({ page: 3, anchor: { type: 'point', x: 0.5, y: 0.5 }, content: 'Here' });
  await kinds.ink.create({
    page: 2, points: [{ x: 0, y: 0 }], color: '#b3923d', width: 0.004, opacity: 1, shape: 'flat',
  });
  await kinds.clips.create({
    page: 4, source: { x: 0, y: 0, w: 0.2, h: 0.2 }, frame: { x: 0, y: 0, w: 0.2, h: 0.2 },
    floating: false,
  });

  const [note, ink, clip] = source.calls.map(([, annotation]) => annotation);
  assert.equal(note.kind, 'note');
  assert.deepEqual(note.body, { anchor: { type: 'point', x: 0.5, y: 0.5 } });
  assert.equal(ink.kind, 'ink');
  assert.equal(ink.page, 2);
  assert.deepEqual(ink.body.points, [{ x: 0, y: 0 }]);
  assert.equal(clip.kind, 'clip');
  assert.equal(clip.body.floating, false);
});

test('a move carries only what moved', async () => {
  const source = recorder();
  const kinds = annotationKinds(source.annotations);

  await kinds.ink.move('a', [{ x: 0.9, y: 0.9 }]);
  await kinds.notes.move('b', { page: 5, anchor: { type: 'point', x: 0.1, y: 0.1 } });
  await kinds.clips.move('c', { x: 1, y: 1, w: 2, h: 2 }, true);
  await kinds.notes.update('b', 'Reworded');

  assert.deepEqual(source.calls, [
    // The nib a stroke was drawn with is not part of where it now sits.
    ['update', 'a', { body: { points: [{ x: 0.9, y: 0.9 }] } }],
    ['update', 'b', { page: 5, body: { anchor: { type: 'point', x: 0.1, y: 0.1 } } }],
    ['update', 'c', { body: { frame: { x: 1, y: 1, w: 2, h: 2 }, floating: true } }],
    // Rewording never disturbs where a note sits.
    ['update', 'b', { content: 'Reworded' }],
  ]);
});

test('a read-only source offers reading and nothing else', () => {
  const kinds = annotationKinds({ list: async () => [] });

  assert.equal(typeof kinds.notes.list, 'function');
  assert.equal(kinds.notes.create, undefined);
  assert.equal(kinds.ink.move, undefined);
  assert.equal(kinds.clips.remove, undefined);
});

test('a source with no annotations at all has no kinds', () => {
  assert.equal(annotationKinds(undefined), null);
});
