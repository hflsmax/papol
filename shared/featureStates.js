// What Papol has already shown a user, or been told by them, remembered in
// this browser and shared with the user's other devices through Papol. The viewer lives on the same origin as the app, so it and
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
import { flagsFromPapol, rememberState, sendUserStateNow } from './userState.js';

export const LINK_NAVIGATION_TIP = {
  key: 'papol_learn_link_navigation',
  value: 'seen',
  name: 'Link navigation tip',
  description: 'The Learn Papol card that explains the return pill, shown the first time a user follows a link in the viewer.',
  setLabel: 'Shown',
  unsetLabel: 'Not shown',
};

export const VISIBILITY_TIP = {
  key: 'papol_learn_visibility',
  value: 'seen',
  name: 'Visibility tip',
  description: 'The Learn Papol card that says each part of a paper in the nook can be private or public, shown the first time a user opens one of their own papers.',
  setLabel: 'Shown',
  unsetLabel: 'Not shown',
};

export const PROJECT_VISIBILITY_TIP = {
  key: 'papol_learn_project_visibility',
  value: 'seen',
  name: 'Project visibility tip',
  description: 'The Learn Papol card that says who in a project sees your digs and ink, shown when a user opens a paper with a project on, until they dismiss it with “Do not show again” ticked.',
  setLabel: 'Dismissed',
  unsetLabel: 'Not dismissed',
};

export const DARK_PAGES_TIP = {
  key: 'papol_learn_dark_pages',
  value: 'seen',
  name: 'Dark pages tip',
  description: 'The Learn Papol card under the viewer’s gear that says dark mode can be turned on there, shown until the user dismisses it, opens the gear or turns dark pages on.',
  setLabel: 'Shown',
  unsetLabel: 'Not shown',
};

export const LOUNGE_TIP = {
  key: 'papol_learn_lounge',
  value: 'seen',
  name: 'Lounge tip',
  description: 'The Learn Papol card under the way into the Lounge that says friends’ news is there, shown until the user dismisses it or goes to the Lounge.',
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

export const ANNOTATION_STORAGE_NOTICE_HIDDEN = {
  key: 'papol_annotation_storage_notice',
  value: 'hidden',
  name: 'Annotation storage notice hidden',
  description: 'The user ticked “Don’t show again” on the viewer notice that annotations are kept apart from the PDF file.',
  setLabel: 'Hidden',
  unsetLabel: 'Shown',
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
  VISIBILITY_TIP,
  PROJECT_VISIBILITY_TIP,
  DARK_PAGES_TIP,
  LOUNGE_TIP,
  RETURN_PILL_HIDDEN,
  ANNOTATION_STORAGE_NOTICE_HIDDEN,
  MAC_HANDOFF_RETIRED,
  MACOS_DOWNLOAD_BANNER_DISMISSED,
];

// Storage can be unavailable in a locked-down browser; a state that cannot be
// read counts as not set, and one that cannot be written reports false.
export function isFeatureStateSet(state) {
  try { return localStorage.getItem(state.key) === state.value; }
  catch { return false; }
}

// Set here at once, and shared with the user's other devices: a tip seen
// on the website is seen in the Mac app too (userState.js).
export function setFeatureState(state, on) {
  if (!writeFeatureState(state, on)) return false;
  rememberState('flag', state.key, on ? state.value : null);
  return true;
}

function writeFeatureState(state, on) {
  try {
    if (on) localStorage.setItem(state.key, state.value);
    else localStorage.removeItem(state.key);
    return true;
  } catch {
    return false;
  }
}

// Told on `window` when what another device set has been taken here, for a
// screen already showing a tip to look again.
export const FEATURE_STATES_TAKEN = 'papol:feature-states-taken';

// What the user's other devices set, taken here: asked once as Papol
// opens. A state this device changed and has not yet sent keeps its own.
// One set here that Papol has never heard of, from before devices shared
// them, is told to Papol now. Returns whether anything changed here.
export async function takeFeatureStatesFromPapol() {
  const flags = await flagsFromPapol();
  if (!flags) return false;
  const known = new Set(flags.map((flag) => flag.key));
  let changed = false;
  for (const { key, value } of flags) {
    const state = FEATURE_STATES.find((one) => one.key === key);
    if (!state) continue;
    const on = value === state.value;
    if (on === isFeatureStateSet(state)) continue;
    changed = writeFeatureState(state, on) || changed;
  }
  for (const state of FEATURE_STATES) {
    if (!known.has(state.key) && isFeatureStateSet(state)) rememberState('flag', state.key, state.value);
  }
  if (changed && typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new Event(FEATURE_STATES_TAKEN));
  }
  return changed;
}

// As any part of Papol opens: send what this device changed while it was
// closed or offline, and take what the user's other devices set.
export function startSharingUserState() {
  void sendUserStateNow();
  void takeFeatureStatesFromPapol().catch(() => {});
}
