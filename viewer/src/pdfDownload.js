// A hosted PDF, fetched by the viewer itself the moment its address is
// known. Left to pdf.js, the download could not begin until pdf.js had
// loaded — most of the viewer's JavaScript — so on a slow connection the
// reader watched an unmeasured spinner before any bar appeared. Fetched
// here, the file and pdf.js arrive side by side, and the bar starts with
// the first byte.
//
// `onProgress` hears `{ loaded, total }` as bytes arrive; `total` is 0
// when the server did not say, or said the size of a compressed body.

export async function downloadPdf(url, { onProgress, signal, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, { signal });
  if (!response.ok) throw new Error(`The PDF could not be downloaded (error ${response.status}).`);
  const encoded = (response.headers.get('content-encoding') || 'identity') !== 'identity';
  const length = Number(response.headers.get('content-length'));
  const total = !encoded && Number.isFinite(length) && length > 0 ? length : 0;
  if (!response.body?.getReader) {
    const whole = new Uint8Array(await response.arrayBuffer());
    onProgress?.({ loaded: whole.length, total: total || whole.length });
    return whole;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  onProgress?.({ loaded, total });
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.({ loaded, total });
  }
  const whole = new Uint8Array(loaded);
  let at = 0;
  for (const chunk of chunks) { whole.set(chunk, at); at += chunk.length; }
  return whole;
}
