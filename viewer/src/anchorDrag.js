const clamp = (value) => Math.min(1, Math.max(0, value));

/** Convert a viewport point to an anchor spot on the page beneath it. */
export function anchorSpotAtPage(pages, clientX, clientY, grab = { x: 0, y: 0 }) {
  const anchorX = clientX - grab.x;
  const anchorY = clientY - grab.y;
  const page = pages.find(({ rect }) => (
    clientX >= rect.left && clientX <= rect.right &&
    clientY >= rect.top && clientY <= rect.bottom
  ));
  if (!page || !page.rect.width || !page.rect.height) return null;
  return {
    page: page.page,
    anchor: {
      type: 'point',
      x: clamp((anchorX - page.rect.left) / page.rect.width),
      y: 1 - clamp((anchorY - page.rect.top) / page.rect.height),
    },
  };
}
