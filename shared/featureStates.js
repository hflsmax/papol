// What Papol has already shown a user, or been told by them, remembered in
// this browser. The viewer lives on the same origin as the app, so it and
// Admin read the same storage: the viewer sets these as they happen, and
// Admin can flip them to see a lesson again or bring back what was hidden.
// A new remembered state belongs here, so Admin lists it without changes.
//
// What belongs is a choice or a lesson: something a user said once, that goes
// on being true until they say otherwise, and that they must be able to take
// back. Three other things live in a browser's storage and none of them are
// that, which is the whole of the rule for deciding:
//
//   * A preference is the live state of a control, not an answer given once —
//     the ink width and colour, the tool in hand, the rail's width, the animal,
//     where a paper was left open (`papol_viewer_position_…`), where a board
//     was panned to (`papol_board_view_…`). Setting one again is how it is
//     undone, and the control that sets it is where that belongs.
//   * Anything in sessionStorage is one tab's memory, and this list is shown
//     in a different tab, which could neither read it nor clear it: the
//     handoff bar's "Not now", `papol.newBoardHint`, `papol.paperBrowserOpen`.
//     "Not now" is deliberately absent for that reason, and it is gone when
//     that tab closes anyway.
//   * Identity and machinery are not the user's answers to anything:
//     `papol_token`, `papol.localAccountUuid`, `papol.syncPreference`,
//     `papol.clientCompatibility`.
import { RETIRED_KEY } from './macHandoff.js';

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

export const MAC_HANDOFF_RETIRED = {
  key: RETIRED_KEY,
  value: '1',
  name: 'Papol for Mac offer retired',
  description: 'The user answered “Don’t ask again” to the bar offering to open this paper or board in Papol for Mac. Their profile offers the same undo.',
  setLabel: 'Retired',
  unsetLabel: 'Offered',
};

export const MACOS_DOWNLOAD_BANNER_DISMISSED = {
  key: 'papol.macosDownloadBannerDismissed',
  value: '1',
  name: 'macOS download banner dismissed',
  description: 'The user closed the banner announcing the Mac app. It advertises the app in general, unlike the handoff bar, which offers to open the document in front of them.',
  setLabel: 'Dismissed',
  unsetLabel: 'Shown',
};

export const FEATURE_STATES = [
  LINK_NAVIGATION_TIP,
  RETURN_PILL_HIDDEN,
  MAC_HANDOFF_RETIRED,
  MACOS_DOWNLOAD_BANNER_DISMISSED,
];

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
