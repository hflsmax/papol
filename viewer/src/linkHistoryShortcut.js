/** Return the viewer-history direction for an unmodified bracket key. */
export function linkHistoryDirection(event) {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null;
  if (event.code === 'BracketLeft' || event.key === '[') return 'back';
  if (event.code === 'BracketRight' || event.key === ']') return 'forward';
  return null;
}
