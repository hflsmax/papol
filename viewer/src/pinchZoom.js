export const PINCH_SETTLE_MS = 220;

/**
 * Coalesces high-frequency pinch input into one visual update per frame and
 * owns the gesture lifetime. Native WebKit gestures do not settle until the
 * matching gestureend, even when gesturechange delivery pauses temporarily.
 */
export function createPinchScheduler({
  onFrame,
  onCommit,
  onActivity = () => {},
  settleMs = PINCH_SETTLE_MS,
  requestFrame = requestAnimationFrame,
  cancelFrame = cancelAnimationFrame,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let factor = 1;
  let at = null;
  let frame = null;
  let timer = null;
  let nativeGesture = false;

  const clearCommit = () => {
    if (timer != null) clearTimer(timer);
    timer = null;
  };

  const commit = () => {
    timer = null;
    if (nativeGesture) return;
    if (frame != null) {
      timer = setTimer(commit, 0);
      return;
    }
    onCommit();
  };

  const armCommit = (delay = settleMs) => {
    clearCommit();
    if (!nativeGesture) timer = setTimer(commit, delay);
  };

  const update = (nextFactor, nextAt) => {
    if (!Number.isFinite(nextFactor) || nextFactor <= 0) return;
    factor *= nextFactor;
    at = nextAt;
    onActivity();
    armCommit();
    if (frame != null) return;
    frame = requestFrame(() => {
      frame = null;
      const combinedFactor = factor;
      const latestAt = at;
      factor = 1;
      at = null;
      onFrame(combinedFactor, latestAt);
    });
  };

  return {
    update,
    startNative() {
      nativeGesture = true;
      clearCommit();
      onActivity();
    },
    endNative() {
      if (!nativeGesture) return;
      nativeGesture = false;
      armCommit(0);
    },
    cancel() {
      clearCommit();
      if (frame != null) cancelFrame(frame);
      frame = null;
      factor = 1;
      at = null;
      nativeGesture = false;
    },
  };
}

/** Cache stable page/inner pairs so a pinch frame does no selector work. */
export function createZoomPageCache() {
  let root = null;
  let pages = [];

  return {
    get(nextRoot) {
      if (root !== nextRoot) {
        root = nextRoot;
        pages = nextRoot
          ? [...nextRoot.querySelectorAll('.pdf-page')].map((page) => ({
            page,
            inner: page.querySelector(':scope > .page-inner'),
          }))
          : [];
      }
      return pages;
    },
    invalidate() {
      root = null;
      pages = [];
    },
  };
}
