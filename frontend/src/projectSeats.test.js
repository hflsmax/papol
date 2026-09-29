import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// On a project's tabs row each face is its own way to that person's nook,
// and the member list opens from its own button after them, never from the
// faces as one control.
const page = readFileSync(new URL('./components/ProjectPage.jsx', import.meta.url), 'utf8');
const row = page.slice(page.indexOf('className="project-seat-row"'), page.indexOf('className="project-invite-open"'));

test('each face on the tabs row links to its person', () => {
  assert.match(row, /<a className="project-seat" key=\{user\.uuid\} href=\{appPath\(`\/u\/\$\{user\.uuid\}`\)\}/);
});

test('the member list opens from its own button, not from the faces', () => {
  assert.match(page, /<div className="project-seat-row"/);
  assert.doesNotMatch(page, /<button[^>]*className="project-seat-row"/);
  assert.match(row, /className="project-seat-more"[^>]*aria-controls="project-people"/);
});
