import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { applicationStyles } from '../../shared/applicationStyles.js';
import { compatibilityStyles } from '../../shared/compatibilityStyles.js';
import { macHandoffStyles } from '../../shared/macHandoffStyles.js';

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
    'preview-ratio', 'shelf-color',
  ]);
  const unresolved = [...new Set(
    [...applicationStyles.matchAll(/var\(--([\w-]+)/g)].map((match) => match[1]),
  )].filter((token) => !declared.has(token) && !runtime.has(token));

  assert.deepEqual(unresolved, []);
});

// The handoff bar is shown by two applications with two stylesheets, and it
// once reached the viewer — the surface it appears on most — with no rules
// at all behind it: a line of run-together default-serif text above the
// reading. So the rules live in one shared partial, every class the bar
// names has one, and every sheet that can show the bar pulls the partial in.
// The sheets are read rather than imported: an application never imports
// another application, not even in a test (dependencyBoundaries.test.js).
test('every surface that shows the Mac handoff bar styles it', () => {
  const read = (from) => readFileSync(new URL(from, import.meta.url), 'utf8');
  const bar = read('../../shared/ui/MacHandoffBar.jsx');
  const named = [...new Set(
    [...bar.matchAll(/className="(mac-handoff-[\w-]+)"/g)].map((match) => match[1]),
  )];

  assert.ok(named.length >= 3, 'the bar should still name its parts with classes');
  for (const name of named) {
    assert.match(macHandoffStyles, new RegExp(`\\.${name}[\\s,:{]`), `${name} has no rule`);
  }

  // The library and the board build from applicationStyles; the viewer has a
  // sheet of its own. Both mount the bar, so both carry the partial.
  assert.match(applicationStyles, /\.mac-handoff-bar[\s,:{]/);
  assert.match(read('../../viewer/src/styles.js'), /\$\{macHandoffStyles\}/);
});

// The update panel is mounted in all three applications, and reached the
// viewer unstyled the same way the handoff bar once did.
test('every surface that shows the update panel styles it', () => {
  const read = (from) => readFileSync(new URL(from, import.meta.url), 'utf8');
  const gate = read('../../shared/ui/CompatibilityGate.jsx');
  const named = [...new Set(
    [...gate.matchAll(/className="(compatibility-[\w-]+)"/g)].map((match) => match[1]),
  )];

  assert.ok(named.length >= 3, 'the panel should still name its parts with classes');
  for (const name of named) {
    assert.match(compatibilityStyles, new RegExp(`\\.${name}[\\s,:{]`), `${name} has no rule`);
  }
  assert.match(applicationStyles, /\.compatibility-stop[\s,:{]/);
  assert.match(read('../../viewer/src/styles.js'), /\$\{compatibilityStyles\}/);
});
