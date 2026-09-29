import {
  ANNOTATION_STORAGE_NOTICE_HIDDEN, isFeatureStateSet, setFeatureState,
} from '../../shared/featureStates.js';

// Anchors, ink, clips and digs live in Papol, not in the PDF: a downloaded or
// shared file carries none of them. The viewer says so each time a paper
// opens that could hold them, until the reader ticks "Don't show again".
// Only to someone signed in: a visitor has no annotations yet to keep. A
// paper nobody can ever write on has nothing to warn about either.
export function showsAnnotationStorageNotice({ signedIn, neverAnnotatable }) {
  return signedIn && !neverAnnotatable && !isFeatureStateSet(ANNOTATION_STORAGE_NOTICE_HIDDEN);
}

// However it is closed, only a tick keeps it away; without one it is back
// the next time a paper opens.
export function closeAnnotationStorageNotice(dontShowAgain) {
  if (dontShowAgain) setFeatureState(ANNOTATION_STORAGE_NOTICE_HIDDEN, true);
}
