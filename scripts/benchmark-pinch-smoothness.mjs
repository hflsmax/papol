import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const viewerRoot = join(root, 'viewer');
const pdfPath = join(root, 'frontend/public/assets/demo/papers/attention.pdf');
const chromePath = process.env.PAPOL_BENCHMARK_CHROME
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const hash = 'bdfaa68d8984f0dc02beaca527b76f207d99b666d31d1da728ee0728182df697';
const runs = Math.max(1, Number(process.env.PAPOL_BENCHMARK_RUNS) || 3);
const cpuThrottle = Math.max(1, Number(process.env.PAPOL_BENCHMARK_CPU) || 1);

const { createServer } = await import(pathToFileURL(
  join(viewerRoot, 'node_modules/vite/dist/node/index.js'),
));

const vite = await createServer({
  root: viewerRoot,
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'papol-pinch-benchmark-pdf',
    configureServer(server) {
      server.middlewares.use('/benchmark-pdf.pdf', (_request, response) => {
        response.setHeader('Content-Type', 'application/pdf');
        createReadStream(pdfPath).pipe(response);
      });
    },
  }],
});

const profile = await mkdtemp(join(tmpdir(), 'papol-pinch-benchmark-'));
let chrome;

function chromeEndpoint(child) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Chrome did not expose DevTools')), 10_000);
    child.stderr.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (!match) return;
      clearTimeout(timer);
      resolve(match[1]);
    });
    child.once('exit', (code) => reject(new Error(`Chrome exited before startup (${code})`)));
  });
}

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    };
  }

  async ready() {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.socket.onopen = resolve;
      this.socket.onerror = reject;
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() { this.socket.close(); }
}

const benchmarkSource = `
(async () => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const deadline = performance.now() + 15000;
  while ((!document.querySelector('.pdf-page[data-painted]')
    || !performance.getEntriesByName('papol-viewer:first-page-text-ready', 'mark').length)
    && performance.now() < deadline) {
    await sleep(10);
  }
  const pages = document.querySelector('.pages');
  if (!pages) throw new Error(document.querySelector('.error')?.textContent || 'Viewer did not load');

  const longTasks = [];
  const observer = typeof PerformanceObserver === 'function'
    ? new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => entry.duration)))
    : null;
  try { observer?.observe({ type: 'longtask', buffered: false }); } catch {}

  const positions = [0.72, 0.18, 0.86, 0.35];
  const responseLatency = [];
  const frameIntervals = [];
  const sessions = [];
  let missedVisualUpdates = 0;
  const event = deltaY => pages.dispatchEvent(new WheelEvent('wheel', {
    deltaY,
    ctrlKey: true,
    clientX: pages.getBoundingClientRect().left + pages.clientWidth * 0.52,
    clientY: pages.getBoundingClientRect().top + pages.clientHeight * 0.48,
    bubbles: true,
    cancelable: true,
  }));

  for (let session = 0; session < positions.length; session += 1) {
    pages.scrollTop = (pages.scrollHeight - pages.clientHeight) * positions[session];
    pages.dispatchEvent(new Event('scroll'));
    const direction = session % 2 === 0 ? -0.25 : 0.25;
    const startScale = Number(pages.dataset.scale);
    let priorScale = startScale;
    let updates = 0;
    let previousFrame = null;

    // Deliberately no yield between the scroll above and this first burst.
    for (let frame = 0; frame < 60; frame += 1) {
      const inputAt = performance.now();
      for (let burst = 0; burst < 4; burst += 1) event(direction);
      const frameAt = await new Promise(requestAnimationFrame);
      responseLatency.push(performance.now() - inputAt);
      if (previousFrame != null) frameIntervals.push(frameAt - previousFrame);
      previousFrame = frameAt;
      const scale = Number(pages.dataset.scale);
      if (scale === priorScale) missedVisualUpdates += 1;
      else updates += 1;
      priorScale = scale;
    }
    sessions.push({
      position: positions[session],
      startScale,
      endScale: Number(pages.dataset.scale),
      visualUpdates: updates,
      lazyPagesRemaining: pages.querySelectorAll('[data-lazy-page]').length,
    });
    await sleep(300);
  }
  observer?.disconnect();
  const frameWork = performance.getEntriesByName('papol-viewer:pinch-frame-work', 'measure')
    .map(entry => entry.duration);
  const previewInterrupts = performance
    .getEntriesByName('papol-viewer:preview-interrupted', 'mark').length;
  return {
    responseLatency, frameIntervals, frameWork, longTasks,
    missedVisualUpdates, previewInterrupts, sessions,
  };
})()`;

const percentile = (values, quantile) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * quantile)];
};

function summarize(samples) {
  const response = samples.flatMap(sample => sample.responseLatency);
  const frames = samples.flatMap(sample => sample.frameIntervals);
  const frameWork = samples.flatMap(sample => sample.frameWork);
  const longTasks = samples.flatMap(sample => sample.longTasks);
  const round = value => Math.round(value * 100) / 100;
  return {
    runs: samples.length,
    pinchEvents: samples.length * 4 * 60 * 4,
    measuredFrames: frames.length,
    responseLatencyMs: {
      p50: round(percentile(response, 0.5)),
      p95: round(percentile(response, 0.95)),
      p99: round(percentile(response, 0.99)),
      max: round(Math.max(...response)),
    },
    frameIntervalMs: {
      p50: round(percentile(frames, 0.5)),
      p95: round(percentile(frames, 0.95)),
      p99: round(percentile(frames, 0.99)),
      max: round(Math.max(...frames)),
    },
    synchronousFrameWorkMs: {
      p50: round(percentile(frameWork, 0.5)),
      p95: round(percentile(frameWork, 0.95)),
      p99: round(percentile(frameWork, 0.99)),
      max: round(Math.max(...frameWork)),
    },
    framesOver20Ms: frames.filter(value => value > 20).length,
    framesOver33Ms: frames.filter(value => value > 33.34).length,
    missedVisualUpdates: samples.reduce((sum, sample) => sum + sample.missedVisualUpdates, 0),
    previewInterrupts: samples.reduce((sum, sample) => sum + sample.previewInterrupts, 0),
    longTasks: { count: longTasks.length, totalMs: round(longTasks.reduce((a, b) => a + b, 0)) },
    finalSessions: samples.at(-1).sessions,
  };
}

async function runPage(baseUrl, legacy) {
  const debugPort = new URL(await chromeEndpointPromise).port;
  const target = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, {
    method: 'PUT',
  }).then(response => response.json());
  const cdp = new Cdp(target.webSocketDebuggerUrl);
  try {
    await cdp.ready();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.__PAPOL_ENV__ = { runtime: 'desktop', surface: 'viewer', documentWindow: true };
      window.__TAURI_INTERNALS__ = {
        transformCallback: () => 1,
        invoke: async command => {
          if (command === 'opened_file_read') {
            const response = await fetch('/benchmark-pdf.pdf');
            return Array.from(new Uint8Array(await response.arrayBuffer()));
          }
          return null;
        }
      };
    ` });
    const query = legacy ? '&pinch_benchmark=legacy' : '&pinch_benchmark=optimized';
    await cdp.send('Page.navigate', {
      url: `${baseUrl}viewer/?pdf=${hash}&file=1&name=Attention.pdf${query}`,
    });
    const result = await cdp.send('Runtime.evaluate', {
      expression: benchmarkSource,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || 'Benchmark failed');
    }
    return result.result.value;
  } finally {
    cdp.close();
    await fetch(`http://127.0.0.1:${debugPort}/json/close/${target.id}`);
  }
}

let chromeEndpointPromise;
try {
  await vite.listen();
  const address = vite.httpServer.address();
  const baseUrl = `http://127.0.0.1:${address.port}/`;
  chrome = spawn(chromePath, [
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chromeEndpointPromise = chromeEndpoint(chrome);
  await chromeEndpointPromise;

  const legacy = [];
  const optimized = [];
  for (let run = 0; run < runs; run += 1) {
    // Alternate order to avoid consistently favouring the second warm run.
    const order = run % 2 ? [false, true] : [true, false];
    for (const baseline of order) {
      (baseline ? legacy : optimized).push(await runPage(baseUrl, baseline));
    }
  }
  console.log(JSON.stringify({
    scenario: 'scroll then immediately pinch while lazy pages and previews are still warming',
    cpuThrottle,
    legacy: summarize(legacy),
    optimized: summarize(optimized),
  }, null, 2));
} finally {
  if (chrome) {
    const exited = new Promise(resolve => chrome.once('exit', resolve));
    chrome.kill('SIGTERM');
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 2_000))]);
    if (chrome.exitCode == null) chrome.kill('SIGKILL');
  }
  await vite.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
