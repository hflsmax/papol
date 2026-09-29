import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// What a project is about sits under its name, above the tabs: a keeper
// writes it in place, any other member reads it, and none shows nothing.
const page = readFileSync(new URL('./components/ProjectPage.jsx', import.meta.url), 'utf8');
const about = page.slice(page.indexOf('function ProjectDescription'), page.indexOf('function ProjectTitle'));
const styles = readFileSync(new URL('../../shared/applicationStyles.js', import.meta.url), 'utf8');

test('the description comes before the tabs on the web and under the toolbar on the Mac', () => {
  assert.match(page, /\{about\}\s*\{tabs\}\s*<\/header>/);
  assert.match(page, /<\/InToolbar>\s*\{about\}/);
});

test('a keeper writes it in place, named only by its placeholder', () => {
  assert.match(about, /if \(!project\.is_keeper\) return saved \? <p className="project-description">\{saved\}<\/p> : null;/);
  assert.match(about, /placeholder="Description"/);
  assert.match(about, /maxLength=\{appLimits\.text\.project_description\}/);
  assert.match(about, /onBlur=\{keep\}/);
  assert.match(about, /e\.key === 'Escape'/);
});

test('its words keep their lines and start level with the tabs', () => {
  assert.match(styles, /\.project-description \{[^}]*white-space: pre-wrap;/);
  assert.match(styles, /\.project-description \{[^}]*padding: var\(--space-1\) var\(--space-3\);[^}]*border: 1px solid transparent;/);
  assert.match(styles, /\.project-tab \{[^}]*padding: 5px var\(--space-3\); border: 1px solid transparent;/);
  assert.match(styles, /\.project-head > \.project-description \+ \.project-tabs \{ flex-basis: 100%; \}/);
});
