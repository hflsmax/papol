import { createHash } from 'node:crypto';
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync,
  renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { normalizeBackendBase } from '../../shared/appUrls.js';

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rootDir = resolve(desktopDir, '..');
const outputDir = join(desktopDir, 'dist');
const cacheDir = join(desktopDir, 'node_modules', '.cache', 'papol');
const inputMarker = join(cacheDir, 'build-web.sha256');
const backend = normalizeBackendBase(process.env.PAPOL_BACKEND_URL || 'https://papol.io');

function build(name) {
  const result = spawnSync('npm', ['run', 'build'], {
    cwd: join(rootDir, name),
    env: { ...process.env, VITE_PAPOL_BACKEND: backend },
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function copyApp(name, destination, root) {
  const target = join(root, destination);
  mkdirSync(target, { recursive: true });
  cpSync(join(rootDir, name, 'dist'), target, { recursive: true });
}

function copyDemoEntry(name, destination, sharedBase, root) {
  const target = join(root, destination);
  mkdirSync(target, { recursive: true });
  const html = readFileSync(join(rootDir, name, 'dist', 'index.html'), 'utf8');
  writeFileSync(join(target, 'index.html'), html.replace(
    /<head>/,
    `<head>\n    <base href="${sharedBase}">`,
  ));
}

function fingerprint(directory) {
  const hash = createHash('sha256');
  const visit = (current, relative = '') => {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name);
      const childRelative = join(relative, name);
      const stats = statSync(path);
      hash.update(`${childRelative}\0${stats.mode}\0`);
      if (stats.isDirectory()) visit(path, childRelative);
      else hash.update(readFileSync(path));
    }
  };
  visit(directory);
  return hash.digest('hex');
}

function inputFingerprint() {
  const hash = createHash('sha256');
  const roots = ['frontend', 'viewer', 'board', 'shared'];
  const visit = (path, relative) => {
    const stats = statSync(path);
    if (stats.isDirectory()) {
      for (const name of readdirSync(path).sort()) {
        if (name === 'dist' || name === 'node_modules') continue;
        visit(join(path, name), join(relative, name));
      }
      return;
    }
    hash.update(`${relative}\0${stats.mode}\0`);
    hash.update(readFileSync(path));
  };
  for (const name of roots) visit(join(rootDir, name), name);
  visit(fileURLToPath(import.meta.url), 'desktop/scripts/build-web.mjs');
  hash.update(`backend\0${backend}`);
  return hash.digest('hex');
}

const expectedInput = inputFingerprint();
if (existsSync(join(outputDir, 'index.html')) && existsSync(inputMarker)
    && readFileSync(inputMarker, 'utf8').trim() === expectedInput) {
  console.log(`Reusing unchanged desktop web payload for backend ${backend}`);
  process.exit(0);
}

for (const name of ['frontend', 'viewer', 'board']) build(name);

const stagedOutput = mkdtempSync(join(desktopDir, '.papol-dist.'));
copyApp('frontend', '.', stagedOutput);
copyApp('viewer', 'viewer', stagedOutput);
copyApp('board', 'boards', stagedOutput);
// Demo routes execute the identical viewer and board builds. A base element
// preserves those routes while sharing the already-embedded static files.
copyDemoEntry('viewer', 'demo/viewer', '../../viewer/', stagedOutput);
copyDemoEntry('board', 'demo/boards', '../../boards/', stagedOutput);

// Large read-only media is hydrated into the native content-addressed cache.
// Keep lightweight tutorial posters in the bundle so Learn remains useful
// while the videos download.
const learnAssets = join(stagedOutput, 'assets', 'learn');
if (existsSync(learnAssets)) {
  for (const name of readdirSync(learnAssets)) {
    if (name.endsWith('.mp4')) rmSync(join(learnAssets, name));
  }
}
rmSync(join(stagedOutput, 'assets', 'demo', 'papers'), { recursive: true, force: true });

if (existsSync(outputDir) && fingerprint(outputDir) === fingerprint(stagedOutput)) {
  rmSync(stagedOutput, { recursive: true, force: true });
  console.log('Desktop web payload is unchanged; preserving native build cache.');
} else {
  rmSync(outputDir, { recursive: true, force: true });
  renameSync(stagedOutput, outputDir);
}

mkdirSync(cacheDir, { recursive: true });
writeFileSync(inputMarker, `${expectedInput}\n`);
console.log(`Bundled Papol web apps for backend ${backend}`);
