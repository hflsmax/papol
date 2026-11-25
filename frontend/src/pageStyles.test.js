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

// Papol for Mac 0.7.1 drew the library and the board bare: their HTML had
// gained an inline <style>, Tauri hashed it into the window's
// Content-Security-Policy, and WebKit then applied none of the <style>
// element the application rendered its whole stylesheet into.
test('no page of the Mac app renders its rules into a <style> element', async () => {
  const { readdirSync } = await import('node:fs');
  const roots = ['../../frontend/src/', '../../board/src/', '../../viewer/src/', '../../shared/'];
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${dir}${entry.name}/`);
      else if (/\.jsx?$/.test(entry.name) && !/\.test\./.test(entry.name) && entry.name !== 'pageStyles.js') {
        const text = source(`${dir}${entry.name}`).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
        if (/<style[\s>]|createElement\(\s*['"]style['"]/.test(text)) offenders.push(`${dir}${entry.name}`);
      }
    }
  };
  roots.forEach(walk);
  assert.deepEqual(offenders, []);
});

test('the library and the board adopt the application sheet before they mount, under the sheets their pieces bring', async () => {
  for (const path of ['./main.jsx', '../../board/src/main.jsx']) {
    const text = source(path);
    const adopt = text.indexOf("addPageStyles('papol-application', applicationStyles, { first: true })");
    assert.ok(adopt > 0, path);
    assert.ok(adopt < text.indexOf('createRoot('), path);
  }
  const realDocument = globalThis.document;
  const realSheet = globalThis.CSSStyleSheet;
  globalThis.CSSStyleSheet = class { replaceSync(css) { this.css = css; } };
  globalThis.document = { adoptedStyleSheets: [{ css: 'earlier' }] };
  try {
    const { addPageStyles } = await import('../../shared/pageStyles.js');
    addPageStyles('test-first', '.b {}', { first: true });
    assert.deepEqual(globalThis.document.adoptedStyleSheets.map((sheet) => sheet.css), ['.b {}', 'earlier']);
  } finally {
    globalThis.document = realDocument;
    globalThis.CSSStyleSheet = realSheet;
  }
});
