import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { nextVersion, stamp, VERSION_FIELDS } from './release-version.mjs';

test('the next release counts on from the latest one', () => {
  assert.equal(nextVersion('patch', '0.5.5', '0.5.5'), '0.5.6');
  assert.equal(nextVersion('minor', '0.5.5', '0.5.5'), '0.6.0');
  assert.equal(nextVersion('major', '0.5.5', '0.5.5'), '1.0.0');
  assert.equal(nextVersion('0.7.0', '0.5.5', '0.5.5'), '0.7.0');
});

test('the releases say which came last, not the committed files', () => {
  // A release no longer commits its version, so the files fall behind.
  assert.equal(nextVersion('patch', '0.6.2', '0.5.5'), '0.6.3');
  // Before any release, counting starts from what is committed.
  assert.equal(nextVersion('patch', '', '0.5.5'), '0.5.6');
});

test('a release only moves forwards, and names a stable version', () => {
  assert.throws(() => nextVersion('0.5.5', '0.5.5', '0.5.5'), /not after/);
  assert.throws(() => nextVersion('0.4.9', '0.5.5', '0.5.5'), /not after/);
  assert.throws(() => nextVersion('0.6.0-beta', '0.5.5', '0.5.5'), /patch, minor, major/);
  assert.throws(() => nextVersion('', '0.5.5', '0.5.5'), /patch, minor, major/);
});

test('every file that carries the version carries it exactly once', () => {
  for (const [file, pattern] of VERSION_FIELDS) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const stamped = stamp(source, pattern, '9.8.7', file);
    assert.match(stamped, /9\.8\.7/, file);
    assert.equal(stamped.length - source.length, '9.8.7'.length - pattern.exec(source)[0].match(/\d+\.\d+\.\d+/)[0].length, file);
  }
});

test('a file with the field missing or doubled is refused', () => {
  const [, pattern] = VERSION_FIELDS[0];
  assert.throws(() => stamp('{\n  "name": "x",\n}', pattern, '1.0.0', 'package.json'), /found 0/);
  assert.throws(() => stamp('  "version": "1",\n  "version": "2",', pattern, '1.0.0', 'package.json'), /found 2/);
});
