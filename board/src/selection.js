export function selectionMode(event) {
  return event.shiftKey || event.metaKey || event.ctrlKey ? 'toggle' : 'replace';
}

export function mergeSelection(base, hits, mode) {
  if (mode === 'replace') return hits;
  const next = new Set(base);
  hits.forEach((id) => {
    if (next.has(id)) next.delete(id);
    else next.add(id);
  });
  return [...next];
}
