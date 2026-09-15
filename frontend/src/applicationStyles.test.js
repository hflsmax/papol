import assert from 'node:assert/strict';
import test from 'node:test';

import { applicationStyles } from '../../shared/applicationStyles.js';

test('shared application styles can be evaluated outside the app module', () => {
  assert.match(applicationStyles, /--chrome: #[0-9a-f]{6};/i);
  assert.doesNotMatch(applicationStyles, /desktopChrome/);
});

test('shared application styles reference only declared or runtime tokens', () => {
  const declared = new Set(
    [...applicationStyles.matchAll(/--([\w-]+)\s*:/g)].map((match) => match[1]),
  );
  const runtime = new Set([
    'active-shelf-color', 'board-card-paint-state', 'board-grid-dot',
    'board-grid-size', 'board-grid-x', 'board-grid-y', 'board-ui-scale',
    'cubby-color', 'lesson-color', 'lesson-wash', 'shelf-color',
  ]);
  const unresolved = [...new Set(
    [...applicationStyles.matchAll(/var\(--([\w-]+)/g)].map((match) => match[1]),
  )].filter((token) => !declared.has(token) && !runtime.has(token));

  assert.deepEqual(unresolved, []);
});
