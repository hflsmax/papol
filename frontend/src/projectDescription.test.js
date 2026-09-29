import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// What a project is about rides the bar: one quiet line after its name, a
// keeper writing it in place, any other member reading it, none showing
// nothing.
const page = readFileSync(new URL('./components/ProjectPage.jsx', import.meta.url), 'utf8');
const about = page.slice(page.indexOf('function ProjectDescription'), page.indexOf('function ProjectTitle'));
const styles = readFileSync(new URL('../../shared/applicationStyles.js', import.meta.url), 'utf8');

test('the description sits under the name in the bar on the web and in the toolbar on the Mac', () => {
  const line = String.raw`<div className="project-title-line">\s*\{title\}\s*<ExperimentalBadge \/>\s*<\/div>\s*\{about\}\s*<\/div>`;
  assert.match(page, new RegExp(String.raw`<div className="project-title-row">\s*` + line));
  assert.match(page, new RegExp(String.raw`<div className="project-toolbar talk-host" data-toolbar-title>\s*` + line));
  assert.match(styles, /\.project-title-row \{ display: flex; flex-direction: column;/);
  assert.doesNotMatch(page, /\{about\}\s*\{tabs\}/);
});

test('a keeper writes it in place, named only by its placeholder', () => {
  assert.match(about, /if \(!project\.is_keeper\) return saved \? <p className="project-description" title=\{saved\}>\{saved\}<\/p> : null;/);
  assert.match(about, /<input\s+className="project-description project-description-input"/);
  assert.match(about, /placeholder="Description"/);
  assert.match(about, /maxLength=\{appLimits\.text\.project_description\}/);
  assert.match(about, /onBlur=\{keep\}/);
  assert.match(about, /e\.key === 'Escape'/);
});

test('it is one line under a smaller name, its words level with the name', () => {
  assert.match(styles, /\.project-description \{[^}]*margin: 0 0 0 calc\(-1 \* var\(--space-2\)\); padding: 0 var\(--space-2\);[^}]*text-overflow: ellipsis; white-space: nowrap;/);
  assert.match(styles, /#way-slot \.project-title \{ font-size: var\(--fs-2xl\);/);
});

test('on the Mac the three views sit over the list, as on the web, not in the toolbar', () => {
  assert.match(page, /\{seats\}\s*<\/InToolbar>\s*\{tabs\}/);
  assert.doesNotMatch(styles, /\.desktop-toolbar \.project-tabs/);
});
