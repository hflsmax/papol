// What a PDF dropped on the window now goes into, when a page takes drops
// itself: 'project' while a member's project page is open. The window's
// drop feedback says so; null is the nook, as everywhere else.
let target = null;

export function setDropTarget(next) {
  target = next;
}

export function dropTarget() {
  return target;
}
