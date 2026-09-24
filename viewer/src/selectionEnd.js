// Where a text selection goes when the pointer is over no word.
//
// A text layer is a page-sized box of absolutely placed spans with nothing
// between them. Drag past the end of a short last line and the pointer is
// over the box itself; the browser has no word there, resolves the point
// to the nearest thing in document order — often the end of the page, or
// back to the start — and the selection leaps. pdf.js's own viewer
// answers this in TextLayerBuilder with an unselectable "endOfContent"
// block, which Papol's slice-built TextLayer never gets. This is that
// answer, unchanged in substance:
//
// - While a selection is being made in a layer, the block (styled by
//   pdf_viewer.css) stretches over the whole layer, so the empty space
//   between spans is something that cannot be selected, and the selection
//   stays where it last was.
// - Where the browser does not do that on its own (WebKit — Safari and the
//   macOS app — and Chromium before 148), the block is also moved in the
//   DOM to just after the span holding the moving end of the selection.
//   Empty space then resolves to "right after the last word reached", not
//   to wherever the page's text ends.

const layers = new Map();
let installed = false;
let native;
let previous = null;

const reset = (end, layer) => {
  layer.append(end);
  end.style.width = '';
  end.style.height = '';
  end.style.userSelect = '';
  layer.classList.remove('selecting');
};

const resetAll = () => {
  for (const [layer, end] of layers) {
    if (layer.isConnected) reset(end, layer);
    else layers.delete(layer);
  }
};

// Firefox, and Chromium from 148, keep a selection put over an unselectable
// block by themselves; pdf.js tells them apart the same way.
const selectsNatively = (layer) => {
  if (getComputedStyle(layer).getPropertyValue('-moz-user-select') === 'none') return true;
  const chromium = navigator.userAgentData
    ? navigator.userAgentData.brands.find(({ brand }) => brand === 'Chromium')?.version
    : /\bChrome\/(\d+)\b/.exec(navigator.userAgent)?.[1];
  return !!chromium && parseInt(chromium, 10) >= 148;
};

function follow() {
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0) {
    resetAll();
    return;
  }
  const active = new Set();
  for (let i = 0; i < selection.rangeCount; i += 1) {
    const range = selection.getRangeAt(i);
    for (const layer of layers.keys()) {
      if (!active.has(layer) && range.intersectsNode(layer)) active.add(layer);
    }
  }
  for (const [layer, end] of layers) {
    if (!layer.isConnected) layers.delete(layer);
    else if (active.has(layer)) layer.classList.add('selecting');
    else reset(end, layer);
  }
  if (!layers.size) return;
  native ??= selectsNatively(layers.keys().next().value);
  if (native) return;

  // Which end is moving: the start, when the end has not changed since last
  // time (a drag upward, or back past where it began).
  const range = selection.getRangeAt(0);
  const movingStart = previous && (
    range.compareBoundaryPoints(Range.END_TO_END, previous) === 0
    || range.compareBoundaryPoints(Range.START_TO_END, previous) === 0
  );
  let anchor = movingStart ? range.startContainer : range.endContainer;
  if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode;
  // An end at offset 0 sits before its node: the last word reached is the
  // text before it.
  if (!movingStart && range.endOffset === 0) {
    do {
      while (anchor && !anchor.previousSibling) anchor = anchor.parentNode;
      anchor = anchor?.previousSibling;
    } while (anchor && !anchor.childNodes.length);
  }
  const layer = anchor?.parentElement?.closest('.textLayer');
  const end = layers.get(layer);
  if (end) {
    end.style.width = layer.style.width;
    end.style.height = layer.style.height;
    end.style.userSelect = 'text';
    anchor.parentElement.insertBefore(end, movingStart ? anchor : anchor.nextSibling);
  }
  previous = range.cloneRange();
}

function install() {
  if (installed) return;
  installed = true;
  let pointerDown = false;
  document.addEventListener('pointerdown', () => { pointerDown = true; });
  document.addEventListener('pointerup', () => {
    pointerDown = false;
    resetAll();
  });
  window.addEventListener('blur', () => {
    pointerDown = false;
    resetAll();
  });
  document.addEventListener('keyup', () => {
    if (!pointerDown) resetAll();
  });
  document.addEventListener('selectionchange', follow);
}

// Give a rendered text layer its end-of-content block.
export function keepSelectionSteady(layer) {
  install();
  const end = document.createElement('div');
  end.className = 'endOfContent';
  layer.append(end);
  layer.addEventListener('mousedown', () => layer.classList.add('selecting'));
  layers.set(layer, end);
}
