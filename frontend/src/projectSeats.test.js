import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// On a project's tabs row each face is its own way to that person's nook.
// The member list is in Manage: no button after the faces opens it, and
// past five faces the count of the rest leads there.
const page = readFileSync(new URL('./components/ProjectPage.jsx', import.meta.url), 'utf8');
const row = page.slice(page.indexOf('className="project-seat-row"'), page.indexOf('className="project-invite-open"'));

test('each face on the tabs row links to its person', () => {
  assert.match(row, /<a className="project-seat" key=\{user\.uuid\} href=\{appPath\(`\/u\/\$\{user\.uuid\}`\)\}/);
});

test('no button after the faces opens a member list; the rest lead to Manage', () => {
  assert.match(page, /<div className="project-seat-row"/);
  assert.doesNotMatch(page, /<button[^>]*className="project-seat-row"/);
  assert.doesNotMatch(row, /aria-controls="project-people"|ActionGlyph name="more"/);
  assert.match(row, /people\.length > 5 && \(\s*<button type="button" className="project-seat-more"[^>]*onClick=\{\(\) => setView\('manage'\)\}/);
});
