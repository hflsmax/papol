// How the host intends to run the seminar. Keys mirror the backend's
// SEMINAR_STYLES; labels and descriptions are what readers see.
export const SEMINAR_STYLES = [
  {
    key: 'walkthrough',
    label: 'A Presentation',
    desc: 'The host presents the paper start to finish — no prep needed.',
  },
  {
    key: 'questions',
    label: 'Bring your questions',
    desc: 'Everyone arrives with questions and confusions; the group untangles them together.',
  },
  {
    key: 'guided',
    label: 'Guided discussion',
    desc: 'Skim the paper beforehand; the host steers with prepared questions.',
  },
  {
    key: 'critique',
    label: 'Deep critique',
    desc: 'Read closely beforehand; the session debates merits, flaws, and implications.',
  },
];

// A style is either a preset key or the host's own free text.
export function styleLabel(key) {
  return SEMINAR_STYLES.find((s) => s.key === key)?.label || key || null;
}

export function styleDesc(key) {
  return SEMINAR_STYLES.find((s) => s.key === key)?.desc || null;
}

// Description of a room's style: preset text, or the host's own.
export function roomStyleDesc(room) {
  return styleDesc(room.style) || room.style_desc || null;
}
