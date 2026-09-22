import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXTERNAL_HOSTS, pageHosts, pluginHosts } from '../../shared/externalHosts.js';

// What the application lets its own pages and its HTTP plugin reach.
// Papol's code asks a handful of hosts by name (shared/externalHosts.js);
// inside the Mac application both a content security policy and the
// plugin's scope stand in the way, and a host missing from either is
// refused with nothing more than "Load failed" — which is how a video
// card lost its title and a PDF its upload, in two shipped releases.
const tauriRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..', 'desktop', 'src-tauri');
const read = async (...where) => JSON.parse(await readFile(path.join(tauriRoot, ...where), 'utf8'));

test('the pages may connect to every host Papol asks for, in both the shipped app and development', async () => {
  const { app: { security } } = await read('tauri.conf.json');
  for (const [which, policy] of Object.entries({ csp: security.csp, devCsp: security.devCsp })) {
    const allowed = policy['connect-src'].split(/\s+/);
    for (const host of pageHosts()) {
      assert.ok(allowed.includes(host), `${which} connect-src is missing ${host}`);
    }
    // 'self' is the app's own pages; ipc: is how the plugin is called.
    assert.ok(allowed.includes("'self'") && allowed.includes('ipc:'), `${which} connect-src lost its own origin`);
  }
});

test('the HTTP plugin may reach every host Papol asks it for, from every window', async () => {
  for (const file of ['desk.json', 'documents.json']) {
    const capability = await read('capabilities', file);
    const http = capability.permissions.find((permission) => permission?.identifier === 'http:default');
    assert.ok(http, `${file} grants no http:default`);
    const scope = http.allow.map((entry) => entry.url);
    for (const host of pluginHosts()) {
      assert.ok(scope.some((url) => url === `${host}/**` || url === host), `${file} scope is missing ${host}`);
    }
  }
});

test('every host Papol asks for says which way it is asked, and why', () => {
  for (const entry of EXTERNAL_HOSTS) {
    assert.match(entry.host, /^https:\/\/[a-z0-9*.-]+$/, `${entry.host} is not a plain https host`);
    assert.ok(['page', 'plugin'].includes(entry.by), `${entry.host} is asked in no known way`);
    assert.ok(entry.why.length > 20, `${entry.host} does not say why`);
  }
  // The R2 upload address and YouTube are the two a release shipped without.
  assert.ok(pageHosts().some((host) => host.endsWith('.r2.cloudflarestorage.com')));
  assert.ok(pageHosts().includes('https://www.youtube.com'));
});
