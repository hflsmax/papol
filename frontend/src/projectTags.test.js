import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('./components/ProjectPage.jsx', import.meta.url), 'utf8');
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
  assert.match(tags, /placeholder="Find or create a tag…"/);
});

test('the shared vocabulary filters papers and only a keeper can delete from it', () => {
  assert.match(papers, /project\.papers\.filter\(\(paper\) => paper\.tags\?\.some\(\(item\) => item\.uuid === tag\)\)/);
  assert.match(papers, /aria-label="Filter papers by project tag"/);
  assert.match(papers, /project\.is_keeper && \(/);
  assert.match(papers, /deleteProjectTag\(project\.uuid, item\.uuid\)/);
});
