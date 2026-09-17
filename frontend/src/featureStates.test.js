// The registry is what Admin's "Feature introductions" lists, so a choice
// missing from it is a choice nobody can take back from there. The Mac
// handoff's "Don't ask again" was such a choice: remembered for the whole
// browser, undoable only from the user's own profile page.
import test from 'node:test';
import assert from 'node:assert/strict';

const stored = new Map();
global.localStorage = {
  getItem: (key) => stored.get(key) ?? null,
  setItem: (key, value) => stored.set(key, String(value)),
  removeItem: (key) => stored.delete(key),
};

const {
  FEATURE_STATES, MACOS_DOWNLOAD_BANNER_DISMISSED, MAC_HANDOFF_RETIRED,
  isFeatureStateSet, setFeatureState,
} = await import('../../shared/featureStates.js');
const { RETIRED_KEY } = await import('../../shared/macHandoff.js');

test('every remembered state is described well enough to be listed', () => {
  for (const state of FEATURE_STATES) {
    for (const field of ['key', 'value', 'name', 'description', 'setLabel', 'unsetLabel']) {
      assert.ok(state[field], `${state.name || state.key} has no ${field}`);
    }
  }
});

test('two states never share a key', () => {
  const keys = FEATURE_STATES.map((state) => state.key);
  assert.equal(new Set(keys).size, keys.length);
});

test('every state can be set and taken back again', () => {
  for (const state of FEATURE_STATES) {
    stored.clear();
    assert.equal(isFeatureStateSet(state), false);
    assert.equal(setFeatureState(state, true), true);
    assert.equal(isFeatureStateSet(state), true);
    assert.equal(setFeatureState(state, false), true);
    assert.equal(isFeatureStateSet(state), false);
  }
});

// The two answers a browser keeps about the Mac app. "Not now" is the third
// and is deliberately absent: it lives in one tab's sessionStorage, which the
// page showing this list cannot read or clear.
test('the answers a user gave about the Mac app are listed', () => {
  assert.equal(MAC_HANDOFF_RETIRED.key, RETIRED_KEY);
  for (const state of [MAC_HANDOFF_RETIRED, MACOS_DOWNLOAD_BANNER_DISMISSED]) {
    assert.ok(FEATURE_STATES.includes(state), `${state.name} is not listed`);
  }
});

// The dismissal is written by the library and read back by Admin, so both
// have to mean the same key. Spelled twice, they drifted apart silently.
test('the download banner is remembered under the registry key', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /'papol\.macosDownloadBannerDismissed'/);
  assert.match(app, /MACOS_DOWNLOAD_BANNER_DISMISSED/);
});
