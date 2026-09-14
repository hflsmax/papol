const isTextEditor = (element) => (
  element?.isContentEditable
  || element?.tagName === 'INPUT'
  || element?.tagName === 'TEXTAREA'
  || element?.tagName === 'SELECT'
);

/**
 * Put Papol's durable PDF-selection snapshot on the system clipboard.
 *
 * The viewer removes the native Range after selection so virtualized PDF
 * text layers can be discarded safely. WebKit therefore has no native
 * selection left when macOS sends Copy; this supplies the snapshotted text.
 */
export function copySelectionSnapshot(event, text, nativeSelection) {
  if (!text || isTextEditor(event.target) || (nativeSelection && !nativeSelection.isCollapsed)) {
    return false;
  }
  if (!event.clipboardData?.setData) return false;
  event.clipboardData.setData('text/plain', text);
  event.preventDefault();
  return true;
}
