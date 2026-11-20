// How long ago a paper on the member's own desk was last read, as a step
// its row is shaded by (frontend/DESIGN.md, Color): 0 is read within a day
// and keeps the plain card; 1 to 4 are a week, a month, three months and
// longer; 5 is never read. Reading is the viewer's recorded time on the
// paper (shared/activity.js), so a paper opened is a paper read.
const DAY_MS = 24 * 60 * 60 * 1000;
const STEPS = [1, 7, 30, 90].map((days) => days * DAY_MS);
export const READ_AGE_NEVER = STEPS.length + 1;

// `effort` is the paper's { seconds, last_at } from the nook, null when it
// was never read, or undefined where the nook does not say (the Mac's
// replica keeps no reading time): then there is no step, and no shade.
export function readAge(effort, now = Date.now()) {
  if (effort === undefined) return null;
  const at = Date.parse(effort?.last_at ?? '');
  if (!Number.isFinite(at)) return READ_AGE_NEVER;
  const since = Math.max(0, now - at);
  const step = STEPS.findIndex((limit) => since < limit);
  return step === -1 ? STEPS.length : step;
}

// What the shade says, for the row's tooltip.
export function readAgeLabel(effort, now = Date.now()) {
  const step = readAge(effort, now);
  if (step == null) return undefined;
  if (step === READ_AGE_NEVER) return 'Not read yet';
  const days = Math.floor(Math.max(0, now - Date.parse(effort.last_at)) / DAY_MS);
  if (days === 0) return 'Read today';
  if (days === 1) return 'Last read yesterday';
  if (days < 14) return `Last read ${days} days ago`;
  if (days < 60) return `Last read ${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `Last read ${Math.floor(days / 30)} months ago`;
  return 'Last read over a year ago';
}
