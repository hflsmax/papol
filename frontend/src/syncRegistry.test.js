import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// tag_uuids is not a copies column. It stands for the copy_tags links, which
// updatePaper rewrites through that table rather than patching onto the copy.
const NOT_COPY_COLUMNS = new Set(['tag_uuids']);

// The replica refuses a write to any copies column the registry does not list,
// so a field updatePaper decides to write locally has to be one of them. Drift
// here does not fail quietly: the save stops with "Client cannot write
// copies.<field>" on Papol macOS, while the website goes on working.
test('every field updatePaper writes locally is one the replica accepts', async () => {
  const registry = JSON.parse(
    await readFile(path.join(repositoryRoot, 'schema/sync_registry.json'), 'utf8'),
  );
  const writable = new Set(registry.tables.copies.client_writable);
  const source = await readFile(path.join(repositoryRoot, 'shared/api/papers.js'), 'utf8');

  const literal = source.match(/const localFields = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(literal, 'updatePaper no longer declares localFields');
  const localFields = [...literal[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  assert.ok(localFields.length > 0, 'localFields is empty');

  const rejected = localFields.filter(
    (field) => !NOT_COPY_COLUMNS.has(field) && !writable.has(field),
  );
  assert.deepEqual(rejected, [], `the replica rejects: ${rejected.join(', ')}`);
});
