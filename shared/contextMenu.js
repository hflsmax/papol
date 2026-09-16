import { DESKTOP } from './desktopShell';
import { menuEntries, menuPosition, nextEnabled, submenuPosition } from './menuModel';

// Right-click menus for Papol macOS.
//
// The menu is drawn by the page, not asked of macOS. A native menu would mean
// granting the hosted page another Tauri permission, and the window
// deliberately grants it only window dragging and zoom (desktop/README.md).
// So it is made to behave like one instead: it opens below-right of the
// pointer, the arrow keys move through it and into submenus, Return chooses
// and Escape closes, and a click anywhere else, a scroll or the window losing
// focus dismisses it.
//
// Only inside Papol macOS. On the web a right-click keeps the browser's own
// menu, which is what people there expect; ⌥ brings that menu back in the app
// too (it has Inspect Element).
//
//   <li onContextMenu={contextMenuHandler(() => [
//     { label: 'Open', onSelect: open },
//     { separator: true },
//     { label: 'Move to', submenu: shelves.map(…) },
//     canDelete && { label: 'Delete…', onSelect: remove },
//   ])}>
//
// Entries are described in shared/menuModel.js. An entry's onSelect runs once
// the menu has gone, so it may open a confirmation sheet of its own.

const STYLE_ID = 'papol-menu-style';

const STYLE = `
.papol-menu {
  position: fixed; z-index: 10001; min-width: 190px; max-width: 320px;
  max-height: calc(100vh - 8px); overflow-y: auto;
  padding: 5px; box-sizing: border-box;
  border-radius: 8px;
  background: rgba(248, 248, 250, 0.96);
  -webkit-backdrop-filter: blur(20px) saturate(1.6); backdrop-filter: blur(20px) saturate(1.6);
  box-shadow: 0 10px 32px rgba(20, 25, 35, 0.22), 0 0 0 0.5px rgba(20, 25, 35, 0.22);
  color: var(--ink, #1d2129);
  font-family: var(--font-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif);
  font-size: 13px; line-height: 1;
  cursor: default; user-select: none; -webkit-user-select: none;
  outline: none;
  animation: papol-menu-in 0.08s ease-out;
}
.papol-menu-item {
  display: flex; align-items: center; gap: 6px;
  height: 22px; padding: 0 10px 0 4px; border-radius: 4px;
  white-space: nowrap;
}
.papol-menu-check { width: 14px; flex: none; text-align: center; font-size: 11px; }
.papol-menu-label { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.papol-menu-shortcut { flex: none; margin-left: 18px; color: var(--ink-faint, #7a8391); }
.papol-menu-arrow { flex: none; margin-left: 14px; font-size: 11px; color: var(--ink-faint, #7a8391); }
.papol-menu-item.active { background: var(--accent, #2b4a6f); color: #fff; }
.papol-menu-item.active .papol-menu-shortcut,
.papol-menu-item.active .papol-menu-arrow { color: rgba(255, 255, 255, 0.85); }
.papol-menu-item[aria-disabled="true"] { color: var(--ink-faint, #7a8391); opacity: 0.6; }
.papol-menu-separator { height: 1px; margin: 5px 6px; background: rgba(20, 25, 35, 0.12); }
@keyframes papol-menu-in { from { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .papol-menu { animation: none; } }
`;

let current = null;

export function closeContextMenu() {
  current?.close();
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.appendChild(style);
}

// Opens a menu for a contextmenu event. Returns whether it did: outside
// Papol macOS, with ⌥ held, or with nothing to offer, the event is left
// alone and the browser shows its own menu.
export function openContextMenu(event, items) {
  if (!DESKTOP || event.altKey) return false;
  const target = event.target instanceof Element ? event.target : event.target?.parentElement;
  if (target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return false;
  // A menu attached to a larger row or page must not replace the useful
  // system menu of a link inside it. A link with its own explicit handler
  // (the desktop source list, for example) is still allowed to opt in.
  const link = target?.closest('a[href]');
  if (link && event.currentTarget !== link) return false;
  const selection = window.getSelection();
  // A selection belongs to the system menu even when it lives inside a row
  // that has a Papol menu of its own. This keeps Copy and Look Up available
  // on paper titles, notes and card text, not only on otherwise quiet text.
  if (selection && !selection.isCollapsed) return false;
  const entries = menuEntries(items);
  if (!entries.some((entry) => !entry.separator)) return false;
  event.preventDefault();
  event.stopPropagation();
  closeContextMenu();
  ensureStyle();

  const returnFocus = document.activeElement;
  const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
  // One level for the menu, one more for each submenu open beside it.
  const levels = [];

  const setActive = (level, index) => {
    level.active = index;
    level.rows.forEach((row, rowIndex) => row?.classList.toggle('active', rowIndex === index));
  };

  const closeFrom = (depth) => {
    while (levels.length > depth) levels.pop().element.remove();
  };

  const close = () => {
    if (current?.close !== close) return;
    current = null;
    closeFrom(0);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('scroll', close, true);
    window.removeEventListener('resize', close);
    window.removeEventListener('blur', close);
  };

  const choose = (entry) => {
    close();
    if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
    // After the menu is gone and this event is over, so an action that opens
    // a sheet or moves focus does not have it snatched back.
    window.setTimeout(() => entry.onSelect?.(), 0);
  };

  const openLevel = (levelEntries, place) => {
    const depth = levels.length;
    const element = document.createElement('div');
    element.className = 'papol-menu';
    element.setAttribute('role', 'menu');
    element.style.visibility = 'hidden';
    const level = { element, entries: levelEntries, rows: [], active: -1 };
    levelEntries.forEach((entry, index) => {
      if (entry.separator) {
        const line = document.createElement('div');
        line.className = 'papol-menu-separator';
        line.setAttribute('role', 'separator');
        element.append(line);
        level.rows.push(null);
        return;
      }
      const row = document.createElement('div');
      row.className = 'papol-menu-item';
      row.setAttribute('role', entry.checked != null ? 'menuitemcheckbox' : 'menuitem');
      if (entry.checked != null) row.setAttribute('aria-checked', String(Boolean(entry.checked)));
      if (entry.disabled) row.setAttribute('aria-disabled', 'true');
      if (entry.submenu) row.setAttribute('aria-haspopup', 'menu');
      const check = document.createElement('span');
      check.className = 'papol-menu-check';
      check.textContent = entry.checked ? '✓' : '';
      const label = document.createElement('span');
      label.className = 'papol-menu-label';
      label.textContent = entry.label;
      row.append(check, label);
      if (entry.shortcut) {
        const shortcut = document.createElement('span');
        shortcut.className = 'papol-menu-shortcut';
        shortcut.textContent = entry.shortcut;
        row.append(shortcut);
      }
      if (entry.submenu) {
        const arrow = document.createElement('span');
        arrow.className = 'papol-menu-arrow';
        arrow.textContent = '▸';
        row.append(arrow);
      }
      row.addEventListener('mouseenter', () => {
        closeFrom(depth + 1);
        if (entry.disabled) {
          setActive(level, -1);
          return;
        }
        setActive(level, index);
        if (entry.submenu) openSubmenu(level, index);
      });
      row.addEventListener('click', () => {
        if (entry.disabled) return;
        if (entry.submenu) openSubmenu(level, index);
        else choose(entry);
      });
      element.append(row);
      level.rows.push(row);
    });
    element.addEventListener('mouseleave', (leave) => {
      // Leaving for a submenu keeps the entry that opened it lit.
      if (levels.some((other) => other.element.contains(leave.relatedTarget))) return;
      if (levels.length === depth + 1) setActive(level, -1);
    });
    element.addEventListener('contextmenu', (inner) => inner.preventDefault());
    document.body.append(element);
    const { left, top } = place({ width: element.offsetWidth, height: element.offsetHeight });
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    element.style.visibility = '';
    levels.push(level);
    return level;
  };

  function openSubmenu(parent, index) {
    const depth = levels.indexOf(parent);
    closeFrom(depth + 1);
    const rect = parent.rows[index].getBoundingClientRect();
    return openLevel(parent.entries[index].submenu, (size) => submenuPosition(rect, size, viewport()));
  }

  function onKey(key) {
    const level = levels[levels.length - 1];
    if (!level) return;
    const entry = level.entries[level.active];
    switch (key.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        setActive(level, nextEnabled(level.entries, level.active, key.key === 'ArrowDown' ? 1 : -1));
        break;
      case 'ArrowRight':
        if (entry?.submenu && !entry.disabled) {
          const sub = openSubmenu(level, level.active);
          setActive(sub, nextEnabled(sub.entries, -1, 1));
        }
        break;
      case 'ArrowLeft':
        if (levels.length > 1) closeFrom(levels.length - 1);
        break;
      case 'Enter':
      case ' ':
        if (entry && !entry.disabled) {
          if (entry.submenu) {
            const sub = openSubmenu(level, level.active);
            setActive(sub, nextEnabled(sub.entries, -1, 1));
          } else {
            choose(entry);
          }
        }
        break;
      case 'Escape':
        if (levels.length > 1) closeFrom(levels.length - 1);
        else close();
        break;
      case 'Tab':
        close();
        break;
      default:
        // Other keys are the menu's while it is open, so a tool shortcut or
        // a text field does not act underneath it; modified keys still pass.
        if (key.metaKey || key.ctrlKey) return;
    }
    key.preventDefault();
    key.stopImmediatePropagation();
  }

  function onPointerDown(down) {
    if (levels.some((level) => level.element.contains(down.target))) return;
    close();
  }

  current = { close };
  openLevel(entries, (size) => menuPosition({ x: event.clientX, y: event.clientY }, size, viewport()));
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('scroll', close, true);
  window.addEventListener('resize', close);
  window.addEventListener('blur', close);
  return true;
}

// An onContextMenu handler that builds its menu when the menu is wanted, so
// what it offers is worked out from the state at that moment.
export function contextMenuHandler(build) {
  return (event) => {
    if (!DESKTOP || event.altKey) return;
    openContextMenu(event, build(event));
  };
}

// Anywhere without a menu of its own, a right-click in Papol macOS shows
// nothing, as in a native app — the web view's menu offers Reload and Inspect
// Element. Text fields, links and selected text keep the system's menu (Cut,
// Copy, Paste, Look Up), and ⌥ brings the web view's back anywhere.
let quietInstalled = false;
if (DESKTOP && typeof document !== 'undefined' && !quietInstalled) {
  quietInstalled = true;
  document.addEventListener('contextmenu', (event) => {
    if (event.defaultPrevented) return;
    closeContextMenu();
    if (event.altKey) return;
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    if (target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), a[href]')) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    event.preventDefault();
  });
}
