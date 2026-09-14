import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

const dist = resolve('dist');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname.startsWith('/api/')) {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end('{"detail":"Not authenticated"}');
      return;
    }
    const relative = url.pathname === '/papol/'
      ? 'index.html'
      : url.pathname.replace(/^\/papol\//, '');
    const file = resolve(dist, relative);
    if (!file.startsWith(`${dist}/`) || !(await stat(file)).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream' });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404).end();
  }
});

await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const { port } = server.address();
const profile = await mkdtemp(join(tmpdir(), 'papol-browser-smoke-'));
const chromium = process.env.CHROME || 'chromium';
const child = spawn(chromium, [
  '--headless',
  '--no-sandbox',
  '--disable-gpu',
  `--user-data-dir=${profile}`,
  '--virtual-time-budget=7000',
  '--enable-logging=stderr',
  '--v=0',
  '--dump-dom',
  `http://127.0.0.1:${port}/papol/`,
]);

let html = '';
let errors = '';
child.stdout.on('data', (chunk) => { html += chunk; });
child.stderr.on('data', (chunk) => { errors += chunk; });
const exitCode = await new Promise((resolveExit) => child.on('close', resolveExit));
server.close();
await rm(profile, { recursive: true, force: true });

if (exitCode !== 0) throw new Error(`Chromium exited with status ${exitCode}\n${errors}`);
if (/Uncaught (?:ReferenceError|TypeError|SyntaxError)/.test(errors)) {
  throw new Error(`Browser runtime error:\n${errors}`);
}
if (!/<div id="root"><style>/.test(html)
    || !/class="app"/.test(html)
    || !/class="topnav"/.test(html)) {
  throw new Error(`Production build did not render the Papol app.\n${errors}`);
}

console.log('Production browser smoke test rendered the Papol app.');
