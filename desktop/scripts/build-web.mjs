import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rootDir = resolve(desktopDir, '..');
const outputDir = join(desktopDir, 'dist');
const backend = (process.env.PAPOL_BACKEND_URL || 'https://mc-pony.com/papol').replace(/\/$/, '');

function build(name) {
  const result = spawnSync('npm', ['run', 'build'], {
    cwd: join(rootDir, name),
    env: { ...process.env, VITE_PAPOL_BACKEND: backend },
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function copyApp(name, destination) {
  const target = join(outputDir, destination);
  mkdirSync(target, { recursive: true });
  cpSync(join(rootDir, name, 'dist'), target, { recursive: true });
}

for (const name of ['frontend', 'viewer', 'board']) build(name);

rmSync(outputDir, { recursive: true, force: true });
copyApp('frontend', '.');
copyApp('viewer', 'viewer');
copyApp('viewer', 'demo/viewer');
copyApp('board', 'boards');
copyApp('board', 'demo/boards');

console.log(`Bundled Papol web apps for backend ${backend}`);
