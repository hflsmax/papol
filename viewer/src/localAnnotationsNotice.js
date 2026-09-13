export const LOCAL_ANNOTATIONS_NOTICE_KEY = 'papol.localAnnotationsNotice';

export function localAnnotationsNoticeHidden(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(LOCAL_ANNOTATIONS_NOTICE_KEY) === 'hidden';
  } catch {
    // A blocked preference store should not prevent this important warning.
    return false;
  }
}

// Closing the notice is intentionally session-only unless the checkbox was
// selected. The next viewer window therefore tells the reader again.
export function rememberLocalAnnotationsNoticeChoice(
  doNotShowAgain,
  storage = globalThis.localStorage,
) {
  if (!doNotShowAgain) return;
  try {
    storage?.setItem(LOCAL_ANNOTATIONS_NOTICE_KEY, 'hidden');
  } catch {
    // The current window can still dismiss the notice when storage is blocked.
  }
}
