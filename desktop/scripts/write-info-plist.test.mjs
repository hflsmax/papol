import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { handoffScheme, identifierFor, infoPlist } from './write-info-plist.mjs';

// The scheme is the one thing a build cannot share with the Papol a user
// already has installed, because LaunchServices gives it to one application.
test('each build answers a scheme of its own', () => {
  assert.equal(handoffScheme('com.mc-pony.papol'), 'papol');
  assert.equal(handoffScheme('com.mc-pony.papol.dev'), 'papol-dev');
  assert.notEqual(handoffScheme('com.mc-pony.papol'), handoffScheme('com.mc-pony.papol.dev'));
});

test('a build reads its identifier the way tauri --config merges it', () => {
  assert.equal(identifierFor(), 'com.mc-pony.papol');
  assert.equal(identifierFor('src-tauri/tauri.dev.conf.json'), 'com.mc-pony.papol.dev');
});

test('the scheme reaches the bundle that is meant to answer it', () => {
  assert.match(infoPlist('com.mc-pony.papol'), /<string>papol<\/string>/);
  assert.match(infoPlist('com.mc-pony.papol.dev'), /<string>papol-dev<\/string>/);
  assert.ok(!infoPlist('com.mc-pony.papol.dev').includes('<string>papol</string>'));
});

// Whatever is committed is what an unregenerated build would ship, so it had
// better be the release scheme rather than the last one a developer built.
test('the committed Info.plist is the one the release build would write', () => {
  assert.equal(readFileSync('src-tauri/Info.plist', 'utf8'), infoPlist(identifierFor()));
});
