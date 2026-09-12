/**
 * The page being read at a line some way down the window: the page that
 * line crosses, or, in the gap between two pages, the nearer of them.
 * pages: [{ page, top, bottom }] in the same coordinates as the line.
 */
export function pageAtLine(line, pages) {
  let found = null;
  let nearest = Infinity;
  for (const { page, top, bottom } of pages) {
    const distance = line < top ? top - line : Math.max(0, line - bottom);
    if (distance < nearest) {
      nearest = distance;
      found = page;
    }
  }
  return found;
}
