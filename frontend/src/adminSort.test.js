import test from 'node:test';
import assert from 'node:assert/strict';

import { compareValues, nextSort, sortIndicator, sortRows } from './adminSort.js';

const order = (rows, sort, column) => sortRows(rows, sort).map((row) => row[column]);

test('a column counts up numerically, not as text', () => {
  const rows = [{ n: 100 }, { n: 9 }, { n: 20 }];
  assert.deepEqual(order(rows, { column: 'n', direction: 'asc' }, 'n'), [9, 20, 100]);
  assert.deepEqual(order(rows, { column: 'n', direction: 'desc' }, 'n'), [100, 20, 9]);
});

test('numbers stored as strings still count up', () => {
  const rows = [{ id: '100' }, { id: '9' }, { id: '20' }];
  assert.deepEqual(order(rows, { column: 'id', direction: 'asc' }, 'id'), ['9', '20', '100']);
});

test('a timestamp is read as text, so it sorts chronologically', () => {
  const rows = [
    { created_at: '2025-03-01T00:00:00' },
    { created_at: '2024-12-31T23:59:59' },
    { created_at: '2025-01-15T08:00:00' },
  ];
  assert.deepEqual(order(rows, { column: 'created_at', direction: 'asc' }, 'created_at'), [
    '2024-12-31T23:59:59',
    '2025-01-15T08:00:00',
    '2025-03-01T00:00:00',
  ]);
});

test('booleans sort false before true', () => {
  const rows = [{ is_admin: true }, { is_admin: false }, { is_admin: true }];
  assert.deepEqual(order(rows, { column: 'is_admin', direction: 'asc' }, 'is_admin'),
    [false, true, true]);
});

test('blanks sit at the bottom whichever way the column points', () => {
  const rows = [{ name: 'b' }, { name: null }, { name: 'a' }, { name: '' }];
  assert.deepEqual(order(rows, { column: 'name', direction: 'asc' }, 'name'),
    ['a', 'b', null, '']);
  assert.deepEqual(order(rows, { column: 'name', direction: 'desc' }, 'name'),
    ['b', 'a', null, '']);
});

test('text sorts case-insensitively', () => {
  const rows = [{ email: 'Zoe@x' }, { email: 'adam@x' }];
  assert.deepEqual(order(rows, { column: 'email', direction: 'asc' }, 'email'),
    ['adam@x', 'Zoe@x']);
});

test('sorting leaves the rows it was given untouched', () => {
  const rows = [{ n: 3 }, { n: 1 }];
  sortRows(rows, { column: 'n', direction: 'asc' });
  assert.deepEqual(rows.map((row) => row.n), [3, 1]);
});

test('no sort means the table keeps its own order', () => {
  const rows = [{ n: 3 }, { n: 1 }];
  assert.equal(sortRows(rows, null), rows);
  assert.equal(sortRows(rows, { column: 'n', direction: null }), rows);
});

test('mixed types compare without throwing', () => {
  assert.equal(typeof compareValues(7, 'seven'), 'number');
  assert.equal(typeof compareValues(true, 'yes'), 'number');
});

test('a header walks ascending, descending, off', () => {
  const first = nextSort(null, 'uuid');
  assert.deepEqual(first, { column: 'uuid', direction: 'asc' });
  const second = nextSort(first, 'uuid');
  assert.deepEqual(second, { column: 'uuid', direction: 'desc' });
  assert.equal(nextSort(second, 'uuid'), null);
});

test('a different header starts that column at ascending', () => {
  const sort = { column: 'uuid', direction: 'desc' };
  assert.deepEqual(nextSort(sort, 'email'), { column: 'email', direction: 'asc' });
});

test('only the sorted column is announced as sorted', () => {
  const sort = { column: 'email', direction: 'desc' };
  assert.deepEqual(sortIndicator(sort, 'email'), { ariaSort: 'descending', arrow: '↓' });
  assert.deepEqual(sortIndicator(sort, 'uuid'), { ariaSort: 'none', arrow: '' });
  assert.deepEqual(sortIndicator(null, 'email'), { ariaSort: 'none', arrow: '' });
});
