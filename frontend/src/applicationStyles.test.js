import assert from 'node:assert/strict';
import test from 'node:test';

import { applicationStyles } from '../../shared/applicationStyles.js';

test('shared application styles can be evaluated outside the app module', () => {
  assert.match(applicationStyles, /--chrome: #[0-9a-f]{6};/i);
  assert.doesNotMatch(applicationStyles, /desktopChrome/);
});
