import { appPath } from '../appUrls.js';
import { request } from '../httpClient.js';
import { onServer } from './serverOperation.js';

// ---------- Sharables (a reader's reading of one edition, given by link) ----------

// A sharable lives only on the service: the link has to open for someone
// who is not this reader, on a machine that is not this one, so there is
// nothing for the local replica to answer. Desktop callers publish their
// pending work first, since the link names notes and ink that must have
// arrived before anyone follows it.
export function createSharable(paperUuid) {
  return onServer(() => request(`/papers/${paperUuid}/sharable`, { method: 'POST' }));
}

export function revokeSharable(sharableUuid) {
  return onServer(() => request(`/sharables/${sharableUuid}`, { method: 'DELETE' }));
}

// No credential is sent or needed. Whoever holds the link may read it, and
// the viewer that follows one may never have met this reader.
export function readSharable(sharableUuid) {
  return request(`/shared/${sharableUuid}`);
}

// Where a link leads: the viewer, in its read-only shape. Absolute, because
// the only use for it is being given to someone else.
export function sharableHref(sharableUuid) {
  const path = appPath(`/viewer/?share=${sharableUuid}`);
  if (typeof window === 'undefined') return path;
  return `${window.location.origin}${path}`;
}
