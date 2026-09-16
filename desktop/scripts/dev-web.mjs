import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeBackendBase } from '../../shared/backendUrl.js';

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rootDir = resolve(desktopDir, '..');
const backend = normalizeBackendBase(process.env.PAPOL_BACKEND_URL || 'http://127.0.0.1:8000');
const apps = [
  ['frontend', '5173'],
  ['viewer', '5174'],
  ['board', '5175'],
];
const children = [];
let stopping = false;

function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill(signal);
}

for (const [app, port] of apps) {
  const child = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', port, '--strictPort'], {
    cwd: resolve(rootDir, app),
    env: { ...process.env, VITE_PAPOL_BACKEND: backend },
    stdio: 'inherit',
  });
  children.push(child);
  child.once('error', (error) => {
    console.error(`[${app}] could not start: ${error.message}`);
    stop();
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    if (stopping) return;
    console.error(`[${app}] development server stopped (${signal || `exit ${code}`})`);
    stop();
    process.exitCode = code || 1;
  });
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.once(signal, () => stop(signal));
}

console.log(`Papol macOS development UI uses backend ${backend}`);

await Promise.all(children.map((child) => new Promise((resolveChild) => child.once('exit', resolveChild))));
