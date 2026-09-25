#!/usr/bin/env node
// What a letter to users about new features starts from
// (.claude/skills/feature-letter): every pull request merged to main since
// a day, and the pictures its description shows. The pictures live on the
// orphan <topic>-screenshots branches (UI changes carry them), linked from
// the description by commit; each is fetched by that commit through the
// API, so a private repository or a branch since deleted still gives it.
//
//   node scripts/feature-letter/gather.mjs --since 2026-09-21 --out <dir>
//
// Writes <dir>/prs.md (newest first: number, day, title, the pictures by
// file, the description's opening paragraph) and <dir>/pr-<n>/<file>.png.
// Needs gh, signed in.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  since: { type: 'string' },
  out: { type: 'string' },
  limit: { type: 'string', default: '300' },
} });
if (!values.since || !values.out) {
  console.error('usage: node scripts/feature-letter/gather.mjs --since YYYY-MM-DD --out <dir> [--limit 300]');
  process.exit(2);
}

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const prs = JSON.parse(gh('pr', 'list', '--state', 'merged', '--base', 'main', '--limit', values.limit,
  '--search', `merged:>=${values.since}`, '--json', 'number,title,mergedAt,body,labels'))
  .sort((a, b) => b.mergedAt.localeCompare(a.mergedAt));

// A picture in a description: markdown or an <img>, on raw.githubusercontent.
const PICTURE = /https:\/\/raw\.githubusercontent\.com\/([^/\s]+)\/([^/\s]+)\/([0-9a-f]{40})\/([^)"'\s]+\.(?:png|jpe?g|gif|webp))/gi;

function fetchPicture(owner, repo, sha, path, file) {
  const bytes = execFileSync('gh', ['api', '-H', 'Accept: application/vnd.github.raw',
    `repos/${owner}/${repo}/contents/${path}?ref=${sha}`], { maxBuffer: 64 * 1024 * 1024 });
  writeFileSync(file, bytes);
}

mkdirSync(values.out, { recursive: true });
const lines = [`# Merged to main since ${values.since}: ${prs.length} pull requests`, ''];
let fetched = 0;
for (const pr of prs) {
  const body = pr.body ?? '';
  const pictures = [...new Map([...body.matchAll(PICTURE)].map((m) => [m[0], m])).values()];
  const kept = [];
  if (pictures.length) mkdirSync(join(values.out, `pr-${pr.number}`), { recursive: true });
  for (const [, owner, repo, sha, path] of pictures) {
    const file = join(`pr-${pr.number}`, decodeURIComponent(path).replace(/[^\w.-]+/g, '-'));
    try {
      fetchPicture(owner, repo, sha, path, join(values.out, file));
      kept.push(file);
      fetched += 1;
    } catch (error) {
      kept.push(`${file} (could not fetch: ${String(error.message).split('\n')[0]})`);
    }
  }
  const opening = body.split(/\n\s*\n/).find((part) => part.trim() && !part.trim().startsWith('!['))?.trim() ?? '';
  const labels = pr.labels.map((label) => label.name).join(', ');
  lines.push(`## #${pr.number} ${pr.title}`, `${pr.mergedAt.slice(0, 10)}${labels ? ` · ${labels}` : ''}`, '');
  if (opening) lines.push(opening.slice(0, 600), '');
  for (const file of kept) lines.push(`- ${file}`);
  if (kept.length) lines.push('');
}
writeFileSync(join(values.out, 'prs.md'), lines.join('\n'));
console.log(`${prs.length} pull requests, ${fetched} pictures: ${join(values.out, 'prs.md')}`);
