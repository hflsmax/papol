import { DESKTOP } from './desktopShell';

// Right-click in Papol macOS.
//
// Papol has no right-click menus: what can be done to an item is in the
// options bar that appears once it is selected. So a right-click shows
// nothing, as in a native app, rather than the web view's own menu with its
// Reload and Inspect Element. Text fields, links and selected text keep the
// system's menu (Cut, Copy, Paste, Look Up), and ⌥ brings the web view's
// back anywhere.
//
// On the web a right-click keeps the browser's own menu, which is what
// people there expect. Imported once by each app's entry for this effect.
if (DESKTOP) {
  document.addEventListener('contextmenu', (event) => {
    if (event.defaultPrevented || event.altKey) return;
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    if (target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), a[href]')) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    event.preventDefault();
  });
}
