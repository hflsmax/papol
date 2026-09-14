export function selectionMode(event) {
  return event.shiftKey || event.metaKey || event.ctrlKey ? 'toggle' : 'replace';
}

export function mergeSelection(base, hits, mode) {
  if (mode === 'replace') return hits;
  const next = new Set(base);
  hits.forEach((uuid) => {
    if (next.has(uuid)) next.delete(uuid);
    else next.add(uuid);
  });
  return [...next];
}

function distanceToRect(point, rect) {
  const outsideX = Math.max(rect.left - point.x, 0, point.x - rect.right);
  const outsideY = Math.max(rect.top - point.y, 0, point.y - rect.bottom);
  return Math.hypot(outsideX, outsideY);
}

export function nearestCardWithin(cards, point, halo) {
  let nearest = null;
  for (const card of cards) {
    const distance = distanceToRect(point, card);
    if (distance > halo) continue;
    if (!nearest || distance < nearest.distance || (distance === nearest.distance && card.z > nearest.z)) {
      nearest = { ...card, distance };
    }
  }
  return nearest;
}

export function cardsIntersectingRect(cards, rect) {
  return [...cards]
    .filter((card) => card.left <= rect.right && card.right >= rect.left
      && card.top <= rect.bottom && card.bottom >= rect.top)
    .map((card) => card.itemUuid);
}
