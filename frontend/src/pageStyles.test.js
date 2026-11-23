import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('shared rules go on as a constructed sheet, once', async () => {
  const realDocument = globalThis.document;
  const realSheet = globalThis.CSSStyleSheet;
  const appended = [];
  globalThis.CSSStyleSheet = class { replaceSync(css) { this.css = css; } };
  globalThis.document = {
    adoptedStyleSheets: [],
    getElementById: () => null,
    createElement: () => ({}),
    head: { appendChild: (node) => appended.push(node) },
  };
  try {
    const { addPageStyles } = await import('../../shared/pageStyles.js');
    addPageStyles('test-sheet', '.a { color: red; }');
    addPageStyles('test-sheet', '.a { color: red; }');
    assert.equal(globalThis.document.adoptedStyleSheets.length, 1);
    assert.equal(globalThis.document.adoptedStyleSheets[0].css, '.a { color: red; }');
    assert.equal(appended.length, 0, 'no <style> element, which a hashed style-src would leave unapplied');
  } finally {
    globalThis.document = realDocument;
    globalThis.CSSStyleSheet = realSheet;
  }
});

test('the "Delete this?" sheet and the syncing status bring their rules through it', () => {
  for (const path of ['../../shared/confirmAction.js', '../../shared/ui/DesktopSyncingStatus.jsx']) {
    const text = source(path);
    assert.match(text, /addPageStyles\(STYLE_ID, STYLE\)/, path);
    assert.doesNotMatch(text, /createElement\('style'\)/, path);
  }
});

test('removing a dig takes it off the card at once, without waiting on a reload', () => {
  const talk = source('../../shared/ui/Talk.jsx');
  const remove = talk.slice(talk.indexOf('const remove = async'), talk.indexOf('// The dig\'s own words come first'));
  assert.match(remove, /await removeDig\(post\.uuid\);[\s\S]*setDiscussion\(after\);\s*report\(after, rest\);/);
});
