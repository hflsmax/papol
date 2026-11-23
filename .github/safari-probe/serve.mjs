// Temporary: serves the viewer fixture with a probe page around it, for a
// real-Safari check on a GitHub macOS runner (safari-cursor-probe.yml).
// The probe page holds the viewer in a same-origin frame, reports where
// things are on the screen, and reports the viewer's state as it changes.
import { PAPER, viewerServer } from '../../viewer/scripts/fixtures/projectViewer.mjs';

const server = await viewerServer();
let spots = null;
const states = [];
const html = `<!doctype html><meta charset="utf-8"><title>probe</title>
<style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%;display:block}</style>
<iframe id="v" src="/viewer/?pdf=${PAPER}"></iframe>
<script>
const f = document.getElementById('v');
const post = (path, body) => fetch(path, { method: 'POST', body: JSON.stringify(body) });
const screenOf = (x, y) => {
  const top = window.screenY + (window.outerHeight - window.innerHeight);
  const left = window.screenX + (window.outerWidth - window.innerWidth) / 2;
  return { x: Math.round(left + x), y: Math.round(top + y) };
};
const tick = async () => {
  const d = f.contentDocument;
  const page = d && d.querySelector('.pdf-page[data-page="1"]');
  const spans = page ? [...page.querySelectorAll('.textLayer span')] : [];
  const find = (t) => spans.find((s) => s.textContent.includes(t));
  if (!window.sent && find('dominant') && find('illia') && find('Abstract')) {
    page.scrollIntoView({ block: 'start' });
    await new Promise((r) => setTimeout(r, 800));
    const w = find('dominant').getBoundingClientRect();
    const a = find('illia').getBoundingClientRect();
    const b = find('Abstract').getBoundingClientRect();
    const box = page.getBoundingClientRect();
    window.sent = true;
    await post('/probe/spots', {
      word: screenOf(w.left + w.width * 0.3, w.top + w.height / 2),
      bare: screenOf(box.left + box.width * 0.3, (a.bottom + b.top) / 2),
      bare2: screenOf(box.left + box.width * 0.75, (a.bottom + b.top) / 2),
      window: { screenX: window.screenX, screenY: window.screenY, outer: [window.outerWidth, window.outerHeight], inner: [window.innerWidth, window.innerHeight] },
    });
  }
  if (d) {
    const sel = f.contentWindow.getSelection();
    await post('/probe/state', {
      at: Date.now(),
      pins: d.querySelectorAll('.pdf-page[data-page="1"] .pin').length,
      selected: String(sel || '').length,
      actions: !!d.querySelector('.selection-actions'),
      selecting: !!d.querySelector('.textLayer.selecting'),
    }).catch(() => {});
  }
  setTimeout(tick, 400);
};
f.addEventListener('load', () => {
  const d = f.contentDocument;
  for (const type of ['mouseover', 'mousedown', 'mouseup', 'click', 'dblclick']) {
    d.addEventListener(type, (e) => {
      const t = e.target;
      post('/probe/event', { type, detail: e.detail, x: e.clientX, y: e.clientY,
        target: (t.className && String(t.className.baseVal ?? t.className)) || t.tagName,
        cursor: getComputedStyle(t).cursor, selected: String(f.contentWindow.getSelection() || '').length,
        prevented: e.defaultPrevented });
    }, true);
  }
  tick();
});
</script>`;
// Ahead of Vite's own handlers, which answer 404 outside the viewer's base.
server.middlewares.stack.unshift({ route: '/probe', handle: (req, res) => {
  const path = req.url.split('?')[0];
  if (req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const value = JSON.parse(body || '{}');
      if (path === '/event') console.log('event', JSON.stringify(value));
      else if (path === '/spots') spots = value;
      else states.push(value);
      res.end('{}');
    });
    return;
  }
  if (path === '/spots') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(spots)); return; }
  if (path === '/state') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(states.at(-1) ?? null)); return; }
  res.setHeader('Content-Type', 'text/html');
  res.end(html);
} });
await server.listen(5199);
console.log('probe server on http://127.0.0.1:5199/probe/');
