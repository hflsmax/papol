// node probe-run.cjs <webkit|chromium> <pdf>: runs probe.html (vite preview on 5198) in that browser.
const pw = require(process.env.PW || 'playwright'); const fs = require('fs');
(async () => {
  const b = await pw[process.argv[2]].launch(); const p = await b.newPage();
  p.on('console', (m) => console.log('console:', m.text().slice(0, 500)));
  p.on('pageerror', (e) => console.log('pageerror', e.message));
  await p.goto('http://127.0.0.1:5198/probe.html'); await p.waitForFunction(() => window.ready);
  const b64 = fs.readFileSync(process.argv[3]).toString('base64');
  const r = await p.evaluate((b64) => window.probe(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))), b64);
  console.log(b.version(), JSON.stringify(r, null, 1)); await b.close();
})();
