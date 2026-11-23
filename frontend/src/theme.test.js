import assert from 'node:assert/strict';
import test from 'node:test';

import { darkTokens, designTokens, themedTokens } from '../../shared/designTokens.js';
import { applicationStyles } from '../../shared/applicationStyles.js';
import { applyTheme, chooseTheme, readTheme, THEME_KEY } from '../../shared/theme.js';

const colourTokens = (sheet) => new Set([...sheet.matchAll(/(--[a-z0-9-]+):\s*(#|rgba?\()/gi)].map((match) => match[1]));

test('every colour the light theme sets, the dark theme sets too', () => {
  const light = colourTokens(designTokens);
  const dark = colourTokens(darkTokens);
  const missing = [...light].filter((token) => !dark.has(token));
  assert.deepEqual(missing, [], `no dark value for ${missing.join(', ')}`);
});

test('dark follows the system unless light was chosen, and a choice of dark always wins', () => {
  const sheet = themedTokens();
  assert.match(sheet, /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme='light'\]\)/);
  assert.match(sheet, /:root\[data-theme='dark'\] \{/);
  assert.match(applicationStyles, /:root\[data-theme='dark'\] \{[\s\S]*--chrome-lounge:/);
});

test('the choice is kept per device and worn on <html>', () => {
  const kept = new Map();
  globalThis.localStorage = {
    getItem: (key) => kept.get(key) ?? null,
    setItem: (key, value) => kept.set(key, String(value)),
    removeItem: (key) => kept.delete(key),
  };
  const before = globalThis.document;
  globalThis.document = { documentElement: { dataset: {} } };
  try {
    assert.equal(readTheme(), 'system');
    assert.equal(chooseTheme('dark'), 'dark');
    assert.equal(kept.get(THEME_KEY), 'dark');
    assert.equal(document.documentElement.dataset.theme, 'dark');
    chooseTheme('system');
    assert.equal(kept.has(THEME_KEY), false);
    assert.equal('theme' in document.documentElement.dataset, false);
    kept.set(THEME_KEY, 'sepia');
    assert.equal(readTheme(), 'system');
    applyTheme('light');
    assert.equal(document.documentElement.dataset.theme, 'light');
  } finally {
    globalThis.document = before;
    delete globalThis.localStorage;
  }
});
