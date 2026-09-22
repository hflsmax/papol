// One way to wait (docs/waiting.md): the numbers a wait shows, formatted
// in one place so every bar in every app reads the same.
//
// A measured wait says how far it is in the unit it is measured in: bytes
// ("12 MB of 30 MB") when the sizes are known, a count ("12 of 26 files")
// when they are not. Nothing here renders; the components in
// shared/ui/Waiting.js do, and take the strings these functions make.

// How long a bar that has reached the end stays on screen before the caller
// takes it down. Long enough to be seen full, short enough not to be a
// wait of its own.
export const PROGRESS_HOLD_MS = 300;

const UNITS = [
  { name: 'GB', size: 1024 ** 3 },
  { name: 'MB', size: 1024 ** 2 },
  { name: 'KB', size: 1024 },
];

// The unit a number of bytes is best read in.
function unitFor(bytes) {
  return UNITS.find((unit) => bytes >= unit.size) || null;
}

// A number in a unit, with at most one decimal and no trailing ".0": "12 MB",
// "1.5 GB", "340 KB", "12 bytes".
function inUnit(bytes, unit) {
  if (!unit) return `${Math.round(bytes)} ${Math.round(bytes) === 1 ? 'byte' : 'bytes'}`;
  const value = bytes / unit.size;
  const shown = value >= 100 ? Math.round(value).toString() : value.toFixed(1).replace(/\.0$/, '');
  return `${shown} ${unit.name}`;
}

// A byte count, readable: "12 MB", "1.5 GB", "340 KB", "12 bytes".
export function formatBytes(bytes) {
  const count = Math.max(0, Number(bytes) || 0);
  return inUnit(count, unitFor(count));
}

// The fraction of a measured wait, or null when it cannot be measured (no
// total, or a total of nothing). A null fraction is the signal to show
// `Working` rather than a bar.
export function progressFraction(loaded, total) {
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(loaded)) return null;
  return Math.max(0, Math.min(1, loaded / total));
}

// What a bar says on its right: the numbers, in the unit the wait is
// measured in.
//
//   formatProgressDetail({ loaded: 12 * MB, total: 30 * MB })      "12 MB of 30 MB"
//   formatProgressDetail({ loaded: 12, total: 26, unit: 'files' })  "12 of 26 files"
//   formatProgressDetail({ loaded: 1, total: 26, unit: 'file' })    "1 of 26 files"
//
// Bytes are shown in the total's unit, so "0.4 MB of 30 MB" rather than
// "410 KB of 30 MB": the two numbers are read against each other.
export function formatProgressDetail({ loaded, total, unit = 'bytes' }) {
  const done = Math.max(0, Math.min(Number(loaded) || 0, Number(total) || 0));
  const all = Math.max(0, Number(total) || 0);
  if (unit === 'bytes') {
    const scale = unitFor(all);
    return `${inUnit(done, scale)} of ${inUnit(all, scale)}`;
  }
  const noun = all === 1 ? unit.replace(/s$/, '') : unit.replace(/s$/, '') + 's';
  return `${Math.round(done)} of ${Math.round(all)} ${noun}`;
}

// A rate, for a detail that has room for it: "2.1 MB/s".
export function formatRate(bytesPerSecond) {
  return `${formatBytes(bytesPerSecond)}/s`;
}

// Wait out the hold on a bar that has reached the end. `reachedAt` is when
// the bar was first shown full (Date.now()); the promise settles once
// PROGRESS_HOLD_MS have passed since then, at once if they already have.
export function holdFullBar(reachedAt) {
  const remaining = reachedAt + PROGRESS_HOLD_MS - Date.now();
  if (remaining <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, remaining));
}
