// Placement belongs to the viewer, while movement belongs to cow.js. Keeping
// construction here prevents App from needing to know the animation engine's
// complete mutable record shape.
export function createPlacedAnimal({ id, kind, page, x, y, activityScale, now = performance.now() }) {
  const facing = Math.random() < 0.5 ? 1 : -1;
  return {
    id,
    kind,
    page,
    x,
    y,
    facing,
    act: null,
    until: 0,
    held: false,
    tvx: 0,
    tvy: 0,
    vx: 0,
    vy: 0,
    turn: facing === 1 ? -1 : 1,
    gait: 0,
    stride: Math.random(),
    travelAngle: 0,
    head: 0,
    tilt: 0,
    sink: 0,
    earTo: 0,
    swish: 0,
    paw: 0,
    pawWag: 0,
    pawPhase: 0,
    pawLeg: null,
    wasWalk: null,
    wasStill: null,
    activityScale,
    specialAt: activityScale > 0 ? 0 : null,
    specialCount: 0,
    tailPhase: Math.random() * Math.PI * 2,
    wagPhase: 0,
    ear: 0,
    earAt: 0,
    earTill: 0,
    tailAt: 0,
    tailTill: 0,
    born: now,
    seed: Math.random(),
    pace: 0.85 + Math.random() * 0.3,
  };
}

const distanceToRect = (point, rect) => {
  const dx = point.x < rect.left ? rect.left - point.x : Math.max(0, point.x - rect.right);
  const dy = point.y < rect.top ? rect.top - point.y : Math.max(0, point.y - rect.bottom);
  return Math.hypot(dx, dy);
};

// Produce page-relative landing points from the current browser viewport.
// Coordinates deliberately extend a little beyond a sheet so visible gray
// gutters remain valid places for an animal to land.
export function randomViewportPlacements(scroller, kinds, count = 10) {
  if (!scroller || !kinds.length || count < 1) return [];
  const pages = [...scroller.querySelectorAll('.pdf-page')]
    .map((el) => ({ el, rect: el.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width > 10 && rect.height > 10);
  if (!pages.length) return [];

  const viewport = scroller.getBoundingClientRect();
  const screenPoints = [];
  return Array.from({ length: count }, (_, index) => {
    let point;
    for (let attempt = 0; attempt < 24; attempt += 1) {
      point = {
        x: viewport.left + viewport.width * (0.07 + Math.random() * 0.86),
        y: viewport.top + viewport.height * (0.07 + Math.random() * 0.86),
      };
      if (screenPoints.every((other) => Math.hypot(other.x - point.x, other.y - point.y) > 64)) break;
    }
    screenPoints.push(point);
    const page = pages.reduce((best, candidate) => (
      !best || distanceToRect(point, candidate.rect) < best.distance
        ? { ...candidate, distance: distanceToRect(point, candidate.rect) }
        : best
    ), null);
    return {
      kind: kinds[(index + Math.floor(Math.random() * kinds.length)) % kinds.length],
      page: Number(page.el.dataset.page),
      x: Math.max(-0.08, Math.min(1.08, (point.x - page.rect.left) / page.rect.width)),
      y: Math.max(-0.15, Math.min(1.15, 1 - (point.y - page.rect.top) / page.rect.height)),
    };
  });
}
