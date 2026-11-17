import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('./components/ProjectPage.jsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../../shared/api/projects.js', import.meta.url), 'utf8');

test('a project has a Manage tab, last after Papers, Boards and Digs', () => {
  assert.match(page, /\['digs', 'Digs'\], \['manage', 'Manage'\]\]/);
  assert.match(page, /view === 'manage' && \(\s*<ProjectManage/);
});

test('only a keeper is offered Delete project, and it asks first', () => {
  const manage = page.slice(page.indexOf('function ProjectManage'), page.indexOf('function ManageField'));
  assert.match(manage, /\{keeper && \(\s*<div className="project-manage-row">[\s\S]*Delete project/);
  assert.match(manage, /confirmAction\([\s\S]*confirmLabel: 'Delete project', destructive: true/);
  assert.match(manage, /if \(!ok\) return;[\s\S]*deleteProject\(project\.uuid\)/);
  assert.match(manage, /onDeleted\?\.\(\)/);
  assert.match(api, /export function deleteProject\(uuid\) \{\s*return request\(`\/projects\/\$\{uuid\}`, \{ method: 'DELETE' \}\);/);
});

test('deleting leaves the papers where they are, and says so', () => {
  const manage = page.slice(page.indexOf('function ProjectManage'), page.indexOf('function ManageField'));
  assert.match(manage, /papers in it stay in each member/);
  assert.doesNotMatch(manage, /removePaper|deletePaper/);
});

test('Manage holds the name, description, members, invitation and leaving', () => {
  const manage = page.slice(page.indexOf('function ProjectManage'), page.indexOf('function ManageField'));
  for (const piece of ['label="Name"', 'label="Description"', '<MemberList', '<AddPerson', '<Invitation', 'leaveProject(']) {
    assert.ok(manage.includes(piece), piece);
  }
});

test('a project has one keeper: Make keeper hands it on, asked first, and there is no Not keeper', () => {
  const list = page.slice(page.indexOf('export function MemberList'), page.indexOf('// The keeper of a project others are in'));
  assert.doesNotMatch(page, /Not keeper/);
  assert.match(list, /confirmAction\([\s\S]*A project has one keeper[\s\S]*confirmLabel: 'Make keeper'/);
  assert.match(list, /if \(ok\) await act\(\(\) => setKeeper\(project\.uuid, user\.uuid, true\)\)/);
  assert.match(page, /function keeperStays\(project\) \{\s*return Boolean\(project\.is_keeper\) && project\.members\.length > 1;/);
  assert.match(list, /disabled=\{stuck\}/);
});
