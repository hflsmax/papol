// How the admin's Users panel words a time and a length of reading. Dates
// arrive as ISO strings; a missing one is "never".

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// "just now", "12 min ago", "5 h ago", "3 days ago", "2 months ago".
export function ago(iso, now = Date.now()) {
  const at = Date.parse(iso ?? '');
  if (!Number.isFinite(at)) return 'never';
  const since = Math.max(0, now - at);
  if (since < MINUTE_MS) return 'just now';
  if (since < HOUR_MS) return `${Math.floor(since / MINUTE_MS)} min ago`;
  if (since < DAY_MS) return `${Math.floor(since / HOUR_MS)} h ago`;
  const days = Math.floor(since / DAY_MS);
  if (days === 1) return 'yesterday';
  if (days < 60) return `${days} days ago`;
  if (days < 730) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

// "—" for none, "45s", "12m", "3h 05m", "128h": short, to sit in a column.
export function readingTime(seconds) {
  const s = Math.round(Number(seconds) || 0);
  if (s <= 0) return '—';
  if (s < 60) return `${s}s`;
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours >= 100) return `${hours}h`;
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
}

// The windows the panel offers, in days.
export const USER_WINDOWS = [1, 7, 30, 90, 365];

export function windowLabel(days) {
  if (days === 1) return 'last 24 hours';
  if (days === 7) return 'last 7 days';
  if (days === 365) return 'last year';
  return `last ${days} days`;
}
