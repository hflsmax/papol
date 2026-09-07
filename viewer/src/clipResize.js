const MIN_FRAME_WIDTH = 0.08;
const MIN_CLIP_WIDTH = 54;
const MIN_CLIP_HEIGHT = 48;
const MAX_FRAME_SIZE = 0.9;

/** Resize a bottom-right handle while restoring the PDF selection's ratio. */
export function resizeClipFrame(frame, rendered, delta, aspect, container) {
  if (!aspect || !container.width || !container.height) return frame;

  // Project the dragged corner onto the diagonal for the source selection.
  // Using its intrinsic ratio (rather than the current box ratio) also repairs
  // clips saved with distorted dimensions.
  const pointerWidth = rendered.width + delta.x;
  const pointerHeight = rendered.height + delta.y;
  const requestedWidth = (
    pointerWidth + pointerHeight / aspect
  ) / (1 + 1 / aspect ** 2);
  const minimumWidth = Math.max(
    MIN_CLIP_WIDTH,
    MIN_CLIP_HEIGHT * aspect,
    MIN_FRAME_WIDTH * container.width,
  );
  const maximumWidth = Math.min(
    MAX_FRAME_SIZE * container.width,
    MAX_FRAME_SIZE * container.height * aspect,
  );
  const width = Math.min(maximumWidth, Math.max(minimumWidth, requestedWidth));
  const height = width / aspect;

  return {
    ...frame,
    w: width / container.width,
    h: height / container.height,
  };
}
