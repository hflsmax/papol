// What Papol has already shown a user, or been told by them, remembered in
// this browser. The viewer lives on the same origin as the app, so it and
// Admin read the same storage: the viewer sets these as they happen, and
// Admin can flip them to see a lesson again or bring back what was hidden.
// A new remembered state belongs here, so Admin lists it without changes.

export const LINK_NAVIGATION_TIP = {
  key: 'papol_learn_link_navigation',
  value: 'seen',
  name: 'Link navigation tip',
  description: 'The Learn Papol card that explains the return pill, shown the first time a user follows a link in the viewer.',
  setLabel: 'Shown',
  unsetLabel: 'Not shown',
};

export const RETURN_PILL_HIDDEN = {
  key: 'papol_link_return_pill',
  value: 'hidden',
  name: 'Return pill hidden',
  description: 'The user hid the viewer’s return pill; [ and ] still move through followed links.',
  setLabel: 'Hidden',
  unsetLabel: 'Visible',
};

export const FEATURE_STATES = [LINK_NAVIGATION_TIP, RETURN_PILL_HIDDEN];

// Storage can be unavailable in a locked-down browser; a state that cannot be
// read counts as not set, and one that cannot be written reports false.
export function isFeatureStateSet(state) {
  try { return localStorage.getItem(state.key) === state.value; }
  catch { return false; }
}

export function setFeatureState(state, on) {
  try {
    if (on) localStorage.setItem(state.key, state.value);
    else localStorage.removeItem(state.key);
    return true;
  } catch {
    return false;
  }
}
