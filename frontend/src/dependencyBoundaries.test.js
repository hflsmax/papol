import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const applicationRoots = ['frontend', 'viewer', 'board']
  .map((name) => ({ name, path: path.join(repositoryRoot, name, 'src') }));

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return /\.(?:js|jsx|mjs)$/.test(entry.name) ? [entryPath] : [];
  }));
  return nested.flat();
}

function relativeImports(source) {
  const imports = [];
  const pattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) {
    if (match[1].startsWith('.')) imports.push(match[1]);
  }
  return imports;
}

test('applications depend on shared modules, never on another application', async () => {
  const violations = [];
  for (const application of applicationRoots) {
    for (const file of await sourceFiles(application.path)) {
      const source = await readFile(file, 'utf8');
      for (const specifier of relativeImports(source)) {
        const target = path.resolve(path.dirname(file), specifier);
        const owner = applicationRoots.find(({ path: root }) =>
          target === root || target.startsWith(`${root}${path.sep}`));
        if (owner && owner.name !== application.name) {
          violations.push(`${path.relative(repositoryRoot, file)} -> ${specifier}`);
        }
      }
    }
  }

  assert.deepEqual(violations, [], `cross-application imports:\n${violations.join('\n')}`);
});
