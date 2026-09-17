/**
 * When a thing was last touched, in the reader's own locale.
 *
 * The year is left off within this year, because a date a reader can place
 * without being told the year is shorter and reads faster; across a year
 * boundary it is the whole of what distinguishes the two dates.
 */

// The backend writes naive UTC timestamps, so one without a zone is UTC
// rather than local — which is a difference of hours, and on the wrong side
// of midnight, of a day.
export const browserDate = (value) => new Date(
  /[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`,
);

export function lastEdited(value) {
  const when = browserDate(value);
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: when.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(when);
}
