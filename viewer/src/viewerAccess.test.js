import test from 'node:test';
import assert from 'node:assert/strict';
import { canOpenPrivateSource } from './viewerAccess.js';

test('a signed-in local account can open its cached paper without a network token', () => {
  assert.equal(canOpenPrivateSource({
    requiresSignIn: true, token: null, localAccount: true,
  }), true);
});

test('a private remote source still requires authentication', () => {
  assert.equal(canOpenPrivateSource({
    requiresSignIn: true, token: null, localAccount: false,
  }), false);
});
