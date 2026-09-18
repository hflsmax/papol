import { inDemo, modePath } from '../appUrls.js';
import { jsonRequest, request } from '../httpClient.js';
import { onServer } from './serverOperation.js';
import { paperName } from '../paperName.js';

// ---------- Sharables (a user's reading of one paper, given by link) ----------

// A sharable lives only on the service: the link has to open for someone
// who is not this user, on a machine that is not this one, so there is
// nothing for the local replica to answer. Desktop callers publish their
// pending work first, since the link names notes and ink that must have
// arrived before anyone follows it.
export function createSharable(paperSha256, { includeAnnotations = false } = {}) {
  return onServer(() => jsonRequest(
    `/papers/${paperName(paperSha256)}/sharable`, 'POST', { include_annotations: includeAnnotations },
  ));
}

// The link this user already has out on a paper, asked for on its own.
// The paper carries it when the paper itself comes from the service; on the
// desktop it is read from the replica, which has no sharables to answer
// with, so this is how a shared paper there knows it is shared. A plain
// read with nothing of the user's pending on it, so unlike the operations
// above there is no work to publish first.
export function mySharable(paperSha256) {
  return request(`/papers/${paperName(paperSha256)}/sharable`);
}

// Downwards only: a link that has been lean is never enriched again,
// because the people holding it were not promised the annotations.
export function leanSharable(sharableUuid) {
  return onServer(() => request(`/sharables/${sharableUuid}/lean`, { method: 'POST' }));
}

export function revokeSharable(sharableUuid) {
  return onServer(() => request(`/sharables/${sharableUuid}`, { method: 'DELETE' }));
}

// No credential is sent or needed. Whoever holds the link may read it, and
// the viewer that follows one may never have met this user.
export function readSharable(sharableUuid) {
  return request(`/shared/${sharableUuid}`);
}

// Where a link leads: the viewer, opened on what the link carries. Absolute,
// because the only use for it is being given to someone else.
export function sharableHref(sharableUuid) {
  const path = modePath(`/viewer/?share=${sharableUuid}`, { demo: inDemo() });
  if (typeof window === 'undefined') return path;
  return `${window.location.origin}${path}`;
}

// Whether the user following this link already keeps the paper. Answered
// only for someone signed in; a visitor with no account has no nook to be
// asked about, and the link stays readable either way.
export function sharedInNook(sharableUuid) {
  return onServer(() => request(`/shared/${sharableUuid}/nook`));
}

// The paper, into this user's nook, with none of the sharer's annotations on
// it. The link is the authorization, so no paper needs to be visible for
// this to work — which is the whole point of having been given one.
export function addSharedToNook(sharableUuid) {
  return onServer(() => request(`/shared/${sharableUuid}/add-to-nook`, { method: 'POST' }));
}
