// The parts of a right-click menu that are not the page: what its entries
// are, which one the arrow keys move to, and where it opens. Kept free of the
// DOM so they can be tested on their own (frontend/src/menuModel.test.js).
//
// An entry is { label, onSelect, disabled, checked, shortcut, submenu } or
// { separator: true }.

// A menu as described by its caller, tidied: falsy entries are dropped, so a
// caller can write `condition && { … }`; a submenu with nothing in it goes;
// and separators are never doubled, leading or trailing.
export function menuEntries(items) {
  const entries = [];
  for (const item of items || []) {
    if (!item) continue;
    if (item.separator) {
      if (entries.length && !entries[entries.length - 1].separator) entries.push({ separator: true });
      continue;
    }
    if (item.submenu) {
      const submenu = menuEntries(item.submenu);
      if (!submenu.some((entry) => !entry.separator)) continue;
      entries.push({ ...item, submenu });
      continue;
    }
    entries.push(item);
  }
  while (entries.length && entries[entries.length - 1].separator) entries.pop();
  return entries;
}

// The enabled entry after `from` (or before it, direction -1), wrapping round.
// From -1 the first way in is the top or the bottom. -1 when there is none.
export function nextEnabled(entries, from, direction) {
  const count = entries.length;
  if (!count) return -1;
  const start = from < 0 ? (direction > 0 ? -1 : count) : from;
  for (let step = 1; step <= count; step += 1) {
    const index = (((start + direction * step) % count) + count) % count;
    if (!entries[index].separator && !entries[index].disabled) return index;
  }
  return -1;
}

// Where a menu opens for a right-click at `point`: below and to the right of
// the pointer, as macOS opens one, moved left or up only as far as it must be
// to stay inside the window.
export function menuPosition(point, size, viewport, margin = 4) {
  let left = point.x;
  if (left + size.width > viewport.width - margin) left = Math.max(margin, point.x - size.width);
  let top = point.y;
  if (top + size.height > viewport.height - margin) {
    top = point.y - size.height >= margin
      ? point.y - size.height
      : Math.max(margin, viewport.height - margin - size.height);
  }
  return { left, top };
}

// Where a submenu opens beside the entry that holds it: to its right, or to
// its left where the right has no room, its first entry level with the one it
// came from.
export function submenuPosition(itemRect, size, viewport, margin = 4) {
  let left = itemRect.right - 2;
  if (left + size.width > viewport.width - margin) left = Math.max(margin, itemRect.left - size.width + 2);
  let top = itemRect.top - 5;
  if (top + size.height > viewport.height - margin) top = Math.max(margin, viewport.height - margin - size.height);
  return { left, top };
}
