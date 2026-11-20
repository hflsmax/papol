// Every top-level page, as it starts: a PDF says so in its content type,
// whatever its address looks like (a "download?id=7", a DOI resolver's
// redirect). The background decides what to do about it.
(() => {
  if (window.top !== window) return;
  if (document.contentType !== 'application/pdf') return;
  const api = globalThis.browser ?? globalThis.chrome;
  try {
    const sent = api.runtime.sendMessage({ type: 'pdf-document' });
    if (sent?.catch) sent.catch(() => {});
  } catch { /* the extension is being reloaded */ }
})();
