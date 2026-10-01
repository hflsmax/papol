import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const page = fs.readFileSync(new URL('./components/ProjectPage.jsx', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('./App.jsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../../shared/applicationStyles.js', import.meta.url), 'utf8');

test('project member chips expose online status visually and accessibly', () => {
  assert.match(page, /data-online=\{user\.online \|\| undefined\}/);
  assert.match(page, /aria-label=\{`\$\{user\.display_name\}, \$\{user\.online \? 'online' : 'offline'\}`\}/);
  assert.match(page, /user\.online && <span className="project-presence-dot"/);
  assert.match(page, /user\.online && <span className="project-person-online">Online<\/span>/);
  // Its 7px coloured centre is the same size as the shared golden news dot;
  // the extra 4px are the two-pixel keyline on either side.
  assert.match(styles, /\.project-presence-dot \{[^}]*width: 11px; height: 11px;/);
});

test('presence renews while the app is visible and project status refreshes', () => {
  assert.match(app, /markPresent\(\)\.catch/);
  assert.match(app, /document\.addEventListener\('visibilitychange', heartbeat\)/);
  assert.match(page, /window\.setInterval\(refresh, 60_000\)/);
});
