import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// What a project is about rides the bar: one quiet line after its name, a
// keeper writing it in place, any other member reading it, none showing
// nothing.
const page = readFileSync(new URL('./components/ProjectPage.jsx', import.meta.url), 'utf8');
const about = page.slice(page.indexOf('function ProjectDescription'), page.indexOf('function ProjectTitle'));
const styles = readFileSync(new URL('../../shared/applicationStyles.js', import.meta.url), 'utf8');

test('the description follows the name in the bar on the web and in the toolbar on the Mac', () => {
  assert.match(page, /<div className="project-title-row">\s*\{title\}\s*<ExperimentalBadge \/>\s*\{about\}\s*<\/div>/);
  assert.match(page, /<div className="project-toolbar talk-host" data-toolbar-title>\s*\{title\}\s*<ExperimentalBadge \/>\s*\{about\}\s*<\/div>/);
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

test('it is one line that gives way before the faces', () => {
  assert.match(styles, /\.project-description \{[^}]*flex: 1 1 0; min-width: 8rem;[^}]*text-overflow: ellipsis; white-space: nowrap;/);
});
