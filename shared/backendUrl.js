// A configured backend is a directory URL, never a filename. Keeping the
// trailing slash means URL resolution preserves a mounted deployment such as
// https://mc-pony.com/papol/ instead of silently falling back to the origin.
export function normalizeBackendBase(value) {
  const source = String(value || '').trim();
  return source ? `${source.replace(/\/+$/, '')}/` : '';
}

export function backendUrl(base, path = '/') {
  const normalized = normalizeBackendBase(base);
  if (!normalized) return null;
  return new URL(String(path).replace(/^\/+/, ''), normalized).toString();
}
