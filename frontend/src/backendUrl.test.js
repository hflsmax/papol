import test from 'node:test';
import assert from 'node:assert/strict';
import { backendUrl, normalizeBackendBase } from '../../shared/backendUrl.js';

test('configured backend bases are directory URLs', () => {
  assert.equal(normalizeBackendBase('https://mc-pony.com/papol'), 'https://mc-pony.com/papol/');
  assert.equal(normalizeBackendBase('https://mc-pony.com/papol///'), 'https://mc-pony.com/papol/');
  assert.equal(normalizeBackendBase('http://127.0.0.1:8000'), 'http://127.0.0.1:8000/');
});

test('backend paths preserve a production mount and a development root', () => {
  assert.equal(
    backendUrl('https://mc-pony.com/papol', '/api/sync/snapshot'),
    'https://mc-pony.com/papol/api/sync/snapshot',
  );
  assert.equal(
    backendUrl('http://127.0.0.1:8000/', '/api/sync/snapshot'),
    'http://127.0.0.1:8000/api/sync/snapshot',
  );
});
