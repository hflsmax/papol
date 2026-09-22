// "Download my data": the export, put together here in the browser.
//
// The server sends the data as a tar with a manifest of the files; the
// files are fetched one URL at a time and the zip is built here (see
// shared/exportArchive.js for why). This lives in the frontend rather
// than in shared/api because the zip comes from fflate, a dependency of
// this app alone; the macOS app bundles this frontend, so it runs in the
// webview too, on nothing but fetch, Blob and URL.

import { runtimeFetch } from '../../shared/connectivity.js';
import { API_BASE, authHeaders, handleResponse } from '../../shared/httpClient.js';
import { backendPath } from '../../shared/appUrls.js';
import { assembleExport } from '../../shared/exportArchive.js';
import { holdFullBar } from '../../shared/waiting.js';

// A response's bytes, read as they arrive so the wait can be measured;
// `onBytes` hears the running count. A body that cannot be streamed is
// read whole and reported once.
async function readBody(response, onBytes) {
  if (!response.body?.getReader) {
    const whole = new Uint8Array(await response.arrayBuffer());
    onBytes(whole.length);
    return whole;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onBytes(loaded);
  }
  const whole = new Uint8Array(loaded);
  let at = 0;
  for (const chunk of chunks) { whole.set(chunk, at); at += chunk.length; }
  return whole;
}

/**
 * Download everything Papol holds about the user, as a zip.
 *
 * Fetched rather than linked: the export needs the bearer token, and a
 * plain <a href> cannot carry one. The blob is handed to the browser
 * through a link that is clicked and thrown away — the only way to name a
 * downloaded file from script.
 *
 * `onProgress` hears each step as { phase, done, total, bytes, totalBytes }:
 * 'gathering' while the data is fetched, 'fetching' with the counts while
 * the files are, 'packing' while the zip is made. Answers the zip's size
 * and the paths of the files that could not be fetched.
 */
export async function downloadMyData(onProgress = () => {}) {
  onProgress({ phase: 'gathering' });
  const response = await runtimeFetch(`${API_BASE}/auth/export`, {
    headers: authHeaders(),
  });
  if (!response.ok) await handleResponse(response);
  // The server names the file; fall back to the same shape if the header
  // is missing (a proxy may strip it).
  const disposition = response.headers.get('Content-Disposition') || '';
  const named = /filename="?([^"]+)"?/.exec(disposition);
  const stem = named ? named[1].replace(/\.tar$/, '') : `papol-export-${new Date().toISOString().slice(0, 10)}`;
  const tar = new Uint8Array(await response.arrayBuffer());

  // A PDF needs no session, its name being a digest nobody guesses, and
  // is fetched from wherever the manifest says — the bucket's own address,
  // as a rule; a board file is private, and its route asks who is asking.
  const fetchFile = async ({ url }, onBytes) => {
    const where = /^https?:/.test(url) ? url : backendPath(url);
    const answer = await runtimeFetch(where, { headers: url.startsWith('/api/') ? authHeaders() : {} });
    if (!answer.ok) throw new Error(`Error ${answer.status}`);
    return readBody(answer, onBytes);
  };
  // The bar is held full for a moment before the zip's spinner takes its
  // place (docs/waiting.md).
  let fullAt = null;
  const { entries, failed } = await assembleExport(tar, fetchFile, {
    onProgress: (counts) => {
      if (fullAt == null && counts.done === counts.total) fullAt = Date.now();
      onProgress({ phase: 'fetching', ...counts });
    },
  });
  if (fullAt != null) await holdFullBar(fullAt);

  onProgress({ phase: 'packing' });
  // Let the page paint that before the zip, which holds the thread.
  await new Promise((resolve) => setTimeout(resolve, 0));
  // Loaded when it is needed: the page does not carry fflate otherwise.
  const { zipSync } = await import('fflate');
  const blob = new Blob([zipSync(entries)], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${stem}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // WebKit may not consume the URL until after the click handler returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { bytes: blob.size, failed };
}
