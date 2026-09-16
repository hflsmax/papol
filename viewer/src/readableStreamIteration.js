// pdf.js reads a page's text with `for await (const chunk of stream)` over a
// ReadableStream. WebKit before Safari 26 (and so Papol macOS's macOS
// webview) has no async iterator on ReadableStream, so getTextContent threw,
// no text layer was built, and the PDF could be seen but not selected or
// searched. This supplies the iterator where the browser does not.

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
