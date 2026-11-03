// pdf.js reads a page's text with `for await (const chunk of stream)` over a
// ReadableStream. WebKit has no async iterator on ReadableStream (Safari
// 26.6 still, and so the Mac app's webview), so getTextContent throws there:
// the viewer built no text layer, and the upload form's reading of a PDF's
// title block and DOI (printed.js) came back empty, leaving the form the
// file's name. This supplies the iterator where the browser does not;
// printed.js and the viewer's entry import it.

export async function* iterateReadableStream({ preventCancel = false } = {}) {
  const reader = this.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    // Leaving the loop early cancels the stream, as the native iterator does;
    // once the stream has finished, cancelling is a harmless no-op.
    if (!preventCancel) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function installReadableStreamIteration(target = globalThis.ReadableStream) {
  if (!target || target.prototype[Symbol.asyncIterator]) return false;
  const descriptor = { value: iterateReadableStream, writable: true, configurable: true };
  if (!target.prototype.values) Object.defineProperty(target.prototype, 'values', descriptor);
  Object.defineProperty(target.prototype, Symbol.asyncIterator, descriptor);
  return true;
}

installReadableStreamIteration();
