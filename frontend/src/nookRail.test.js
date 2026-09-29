import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// A project starts from the nook's rail by its name alone, and opens at
// once; the Bazaar only lists projects, and a paper's project menu starts
// one with that paper in it when there is none.
const desk = readFileSync(new URL('./components/NookDesk.jsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8');
const bazaar = readFileSync(new URL('./components/ProjectsPage.jsx', import.meta.url), 'utf8');
const picker = readFileSync(new URL('./components/ProjectPicker.jsx', import.meta.url), 'utf8');
const projects = desk.slice(desk.indexOf('aria-labelledby="desk-projects"'), desk.indexOf('aria-labelledby="desk-shelves"'));

test('the rail always has a Projects head with New, projects or not', () => {
  assert.match(projects, /<h3 id="desk-projects">Projects<\/h3>\s*\{!naming && <button type="button" className="desk-quiet" onClick=\{\(\) => setNaming\(true\)\}>New<\/button>\}/);
  assert.doesNotMatch(desk, /\{nook\.projects\?\.length > 0 && \(\s*<section/);
});

test('a new project asks only its name and opens at once', () => {
  const form = desk.slice(desk.indexOf('function ProjectCreate'), desk.indexOf('const youFirst'));
  assert.match(form, /createProject\(name\.trim\(\)\)/);
  assert.match(form, /placeholder="Project name"/);
  assert.equal((form.match(/<input/g) || []).length, 1);
  assert.doesNotMatch(form, /<button/);
  assert.match(projects, /onChanged\?\.\(\); onOpenProject\?\.\(p\.uuid\)/);
  assert.match(app, /onOpenProject=\{\(uuid\) => \{\s*setProjectsRevision\(\(r\) => r \+ 1\);\s*navigate\(`\/project\/\$\{uuid\}`\);/);
});

test('the Bazaar lists projects without starting one', () => {
  assert.match(bazaar, /projects && !naming && !section && \(\s*<button type="button" onClick=\{\(\) => setNaming\(true\)\}>New project<\/button>/);
});

test('with no project, the paper menu starts one with this paper in it', () => {
  assert.doesNotMatch(picker, /appPath\('\/projects'\)/);
  assert.match(picker, /const project = await createProject\(name\.trim\(\)\);\s*await addPaperToProject\(project\.uuid, paper\.sha256\);/);
});
