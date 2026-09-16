import { appPath } from '../appUrls.js';
import { jsonRequest, request } from '../httpClient.js';
import { onServer } from './serverOperation.js';

// ---------- Sharables (a reader's reading of one edition, given by link) ----------

// A sharable lives only on the service: the link has to open for someone
// who is not this reader, on a machine that is not this one, so there is
// nothing for the local replica to answer. Desktop callers publish their
// pending work first, since the link names notes and ink that must have
// arrived before anyone follows it.
export function createSharable(paperUuid, { includeMarks = false } = {}) {
  return onServer(() => jsonRequest(
    `/papers/${paperUuid}/sharable`, 'POST', { include_marks: includeMarks },
  ));
}

// Downwards only: a link that has been lean is never enriched again,
// because the people holding it were not promised the marks.
export function leanSharable(sharableUuid) {
  return onServer(() => request(`/sharables/${sharableUuid}/lean`, { method: 'POST' }));
}

export function revokeSharable(sharableUuid) {
  return onServer(() => request(`/sharables/${sharableUuid}`, { method: 'DELETE' }));
}

// No credential is sent or needed. Whoever holds the link may read it, and
// the viewer that follows one may never have met this reader.
export function readSharable(sharableUuid) {
  return request(`/shared/${sharableUuid}`);
}

// Where a link leads: the viewer, opened on what the link carries. Absolute,
// because the only use for it is being given to someone else.
export function sharableHref(sharableUuid) {
  const path = appPath(`/viewer/?share=${sharableUuid}`);
  if (typeof window === 'undefined') return path;
  return `${window.location.origin}${path}`;
}

// Whether the reader following this link already keeps the paper. Answered
// only for someone signed in; a visitor with no account has no nook to be
// asked about, and the link stays readable either way.
export function sharedInNook(sharableUuid) {
  return onServer(() => request(`/shared/${sharableUuid}/nook`));
}

// The paper, into this reader's nook, with none of the sharer's marks on
// it. The link is the authorization, so no paper needs to be visible for
// this to work — which is the whole point of having been given one.
export function addSharedToNook(sharableUuid) {
  return onServer(() => request(`/shared/${sharableUuid}/add-to-nook`, { method: 'POST' }));
}
