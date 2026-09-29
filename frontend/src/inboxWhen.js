// When a notification came, as short as a mail list says it: the time
// today, the day this year, the day and year before that. The full date
// and time go in its title.
export function inboxWhen(dateString, now = new Date()) {
  const at = new Date(dateString);
  if (at.toDateString() === now.toDateString()) {
    return at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  const sameYear = at.getFullYear() === now.getFullYear();
  return at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

export function inboxWhenFull(dateString) {
  return new Date(dateString).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}
