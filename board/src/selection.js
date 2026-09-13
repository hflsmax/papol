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
