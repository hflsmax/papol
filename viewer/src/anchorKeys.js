// The keyboard's part in holding an anchor. A pin that has been clicked is
// the one the viewer has in hand — its card is open beside it — and while
// it is, Delete and Backspace take it away and Escape puts it down again.
// Nothing here fires while the user is writing: in a field, Backspace is
// Backspace, and Escape belongs to the field it is pressed in.

/** Whether keystrokes at this element are text being typed, not commands. */
export function isEditingTarget(el) {
  return Boolean(
    el?.isContentEditable ||
    el?.tagName === 'INPUT' ||
    el?.tagName === 'TEXTAREA' ||
    el?.tagName === 'SELECT',
  );
}

/**
 * What an unmodified key does to the anchor in hand: 'delete', 'deselect'
 * or null. Only the plain key acts — with a modifier held it is somebody
 * else's shortcut — and a reading that cannot be written on has nothing
 * to delete, only something to put down.
 */
export function anchorKeyAction(event, { selected, readOnly = false }) {
  if (!selected) return null;
  if (isEditingTarget(event.target)) return null;
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (event.key === 'Escape') return 'deselect';
  if (!readOnly && (event.key === 'Delete' || event.key === 'Backspace')) return 'delete';
  return null;
}
