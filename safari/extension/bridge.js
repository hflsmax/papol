// On Papol's viewer page: the viewer's way to the bytes of a PDF the
// extension sent it (viewer/src/fetchedPdf.js is the other end).
//
// The page sees the extension through an attribute on <html>: "pending"
// while the background is asked whether this is the reader's Papol, then
// "ready", or gone. Requests and answers go over window.postMessage on this
// page's own origin; the bytes are transferred, not copied.
(() => {
  if (!/\/viewer\/?$/.test(location.pathname)) return;
  const api = globalThis.browser ?? globalThis.chrome;
  const ATTRIBUTE = 'data-papol-extension';
  const root = document.documentElement;
  if (!root) return;
  root.setAttribute(ATTRIBUTE, 'pending');

  const send = (message) => api.runtime.sendMessage(message);
  const reply = (id, message, transfer) => window.postMessage(
    { source: 'papol-extension', id, ...message }, location.origin, transfer || [],
  );

  function decode(text, into, at) {
    const binary = atob(text);
    for (let i = 0; i < binary.length; i += 1) into[at + i] = binary.charCodeAt(i);
    return binary.length;
  }

  async function fetchFor(id, url) {
    const requestId = id;
    const progress = (message) => {
      if (message?.type === 'fetch-progress' && message.requestId === requestId) {
        reply(id, { type: 'progress', loaded: message.loaded, total: message.total });
      }
    };
    api.runtime.onMessage.addListener(progress);
    try {
      const head = await send({ type: 'fetch-pdf', url, requestId });
      if (!head || head.error) {
        reply(id, { type: 'error', error: head?.error || 'The extension did not answer.', status: head?.status });
        return;
      }
      const bytes = new Uint8Array(head.size);
      let at = 0;
      for (let index = 0; index < head.chunks; index += 1) {
        const piece = await send({ type: 'chunk', token: head.token, index });
        if (!piece || piece.error) throw new Error(piece?.error || 'The PDF stopped arriving.');
        at += decode(piece.data, bytes, at);
        reply(id, { type: 'progress', loaded: at, total: head.size });
      }
      reply(id, { type: 'pdf', bytes: bytes.buffer }, [bytes.buffer]);
    } catch (failure) {
      reply(id, { type: 'error', error: String(failure?.message || failure) });
    } finally {
      api.runtime.onMessage.removeListener(progress);
    }
  }

  function listen(event) {
    if (event.origin !== location.origin) return;
    const message = event.data;
    if (message?.source !== 'papol-viewer') return;
    if (message.type === 'fetch-pdf' && typeof message.url === 'string') fetchFor(message.id, message.url);
  }

  Promise.resolve(send({ type: 'hello' })).then((answer) => {
    if (!answer?.papol) {
      root.removeAttribute(ATTRIBUTE);
      return;
    }
    window.addEventListener('message', listen);
    root.setAttribute(ATTRIBUTE, 'ready');
    const from = new URLSearchParams(location.search).get('from');
    if (from) send({ type: 'viewing', from });
  }, () => root.removeAttribute(ATTRIBUTE));
})();
