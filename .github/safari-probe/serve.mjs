// Temporary: serves the viewer fixture with a probe page around it, for a
// real-Safari check on a GitHub macOS runner (safari-cursor-probe.yml).
// The probe page holds the viewer in a same-origin frame, reports where
// things are on the screen, and reports the viewer's state as it changes.
import { createServer } from 'node:http';
import { PAPER, viewerServer } from '../../viewer/scripts/fixtures/projectViewer.mjs';

const server = await viewerServer();
let spots = null;
const states = [];
const html = `<!doctype html><meta charset="utf-8"><title>probe</title>
<style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%;display:block}</style>
<iframe id="v" src="/viewer/?pdf=${PAPER}"></iframe>
<script>
const f = document.getElementById('v');
// Reported to another host name than the viewer's: Safari keeps six
// connections a host and port, and the viewer's own can hold them all.
const post = (path, body) => fetch('http://127.0.0.1:5200' + path, { method: 'POST', mode: 'no-cors', body: JSON.stringify(body) });
const screenOf = (x, y) => {
  const top = window.screenY + (window.outerHeight - window.innerHeight);
  const left = window.screenX + (window.outerWidth - window.innerWidth) / 2;
  return { x: Math.round(left + x), y: Math.round(top + y) };
};
const describe = (t) => (t && ((t.className && String(t.className.baseVal ?? t.className)) || t.tagName)) || 'none';
const queue = [];
const watch = (d, where) => {
  if (d.__probe) return;
  d.__probe = true;
  for (const type of ['mouseover', 'pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick']) {
    d.addEventListener(type, (e) => {
      queue.push({ where, type, detail: e.detail, x: e.clientX, y: e.clientY, target: describe(e.target),
        cursor: e.target.nodeType === 1 ? getComputedStyle(e.target).cursor : '',
        selected: String(f.contentWindow.getSelection() || '').length, prevented: e.defaultPrevented, at: Date.now() % 100000 });
    }, true);
  }
};
watch(document, 'top');
const tick = async () => {
  const d = f.contentDocument;
  if (d && d.body) {
    watch(d, 'viewer');
    if (!d.getElementById('probe-style')) {
      // The "open in the Mac app" bar comes and goes over the page; kept away, the page holds still.
      const st = d.createElement('style'); st.id = 'probe-style';
      st.textContent = '.mac-handoff-bar{display:none!important}';
      d.head.append(st);
    }
  }
  const page = d && d.querySelector('.pdf-page[data-page="1"]');
  const spans = page ? [...page.querySelectorAll('.textLayer span')] : [];
  const find = (t) => spans.find((s) => s.textContent.includes(t));
  if (find('dominant') && find('illia') && find('Abstract')) {
    if (!window.scrolled) {
      window.scrolled = true;
      // The word, the bare paper above the Abstract and the gap all in view.
      find('Abstract').scrollIntoView({ block: 'center' });
      await new Promise((r) => setTimeout(r, 1500));
    }
    const w = find('dominant').getBoundingClientRect();
    const a = find('illia').getBoundingClientRect();
    const b = find('Abstract').getBoundingClientRect();
    const box = page.getBoundingClientRect();
    const at = (x, y) => ({ ...screenOf(x, y), client: [Math.round(x), Math.round(y)], under: describe(d.elementFromPoint(x, y)) });
    await post('/probe/spots', {
      word: at(w.left + w.width * 0.3, w.top + w.height / 2),
      bare: at(box.left + box.width * 0.3, (a.bottom + b.top) / 2),
      bare2: at(box.left + box.width * 0.75, (a.bottom + b.top) / 2),
      window: { screenX: window.screenX, screenY: window.screenY, outer: [window.outerWidth, window.outerHeight], inner: [window.innerWidth, window.innerHeight] },
    }).catch(() => {});
  }
  if (queue.length) await post('/probe/event', queue.splice(0)).catch(() => {});
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
tick();
</script>`;
// Ahead of Vite's own handlers, which answer 404 outside the viewer's base.
const probe = (req, res) => {
  const path = req.url.split('?')[0].replace(/^\/probe/, '');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const value = JSON.parse(body || '{}');
      if (path === '/event') for (const e of [].concat(value)) console.log('event', JSON.stringify(e));
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
};
server.middlewares.stack.unshift({ route: '/probe', handle: probe });
// The page's reports come in on a port of their own (see post above).
createServer(probe).listen(5200, '127.0.0.1');
await server.listen(5199);
console.log('probe server on http://127.0.0.1:5199/probe/');
