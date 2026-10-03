import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('./components/ProjectPage.jsx', import.meta.url), 'utf8');
const brief = readFileSync(new URL('./components/PaperBrief.jsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../../shared/api/projects.js', import.meta.url), 'utf8');
const tags = page.slice(page.indexOf('function ProjectPaperTags('), page.indexOf('// Each paper is a row'));
const papers = page.slice(page.indexOf('function ProjectPapers('), page.indexOf('// Every dig'));

test('project tags use project routes, apart from private paper tags', () => {
  assert.match(api, /createProjectTag[\s\S]*`\/projects\/\$\{uuid\}\/tags`/);
  assert.match(api, /addProjectPaperTag[\s\S]*`\/projects\/\$\{uuid\}\/papers\/\$\{paperSha256\}\/tags\/\$\{tagUuid\}`/);
  assert.match(api, /removeProjectPaperTag[\s\S]*method: 'DELETE'/);
});

test('a paper can take an existing project tag or make a new one', () => {
  assert.match(tags, /createProjectTag\(project\.uuid, draft\.trim\(\)\)/);
  assert.match(tags, /addProjectPaperTag\(project\.uuid, paper\.sha256, tag\.uuid\)/);
  assert.match(tags, /removeProjectPaperTag\(project\.uuid, paper\.sha256, tag\.uuid\)/);
  assert.match(tags, /placeholder="Add a tag…"/);
  assert.doesNotMatch(tags, />Done<|project-tag-editor/);
});

test('paper rows show tags while editing belongs to the open brief', () => {
  assert.match(papers, /tags={<ProjectPaperTags project={project} paper={paper} onChanged={onChanged} \/>}/);
  assert.match(papers, /paper\.tags\.map[\s\S]*className="project-paper-tag-label"/);
  assert.match(brief, /{tags && <div className="paper-brief-tags">{tags}<\/div>}/);
});

test('the shared vocabulary filters papers without deleting tags from the papers view', () => {
  assert.match(papers, /usedTagUuids = new Set\(project\.papers\.flatMap/);
  assert.match(papers, /usedTags = \(project\.tags \?\? \[\]\)\.filter\(\(item\) => usedTagUuids\.has\(item\.uuid\)\)/);
  assert.match(papers, /project\.papers\.filter\(\(paper\) => paper\.tags\?\.some\(\(item\) => item\.uuid === selectedTag\)\)/);
  assert.match(papers, /{usedTags\.map\(\(item\) => \(/);
  assert.match(papers, /aria-label="Filter papers by project tag"/);
  assert.doesNotMatch(papers, /deleteProjectTag|project-tag-delete/);
});
