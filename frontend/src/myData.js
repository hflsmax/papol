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

/**
 * Download everything Papol holds about the user, as a zip.
 *
 * Fetched rather than linked: the export needs the bearer token, and a
 * plain <a href> cannot carry one. The blob is handed to the browser
 * through a link that is clicked and thrown away — the only way to name a
 * downloaded file from script.
 *
 * `onProgress` hears each step as { phase, done, total }. Answers the
 * zip's size and the paths of the files that could not be fetched.
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

  // A PDF needs no session, its name being a digest nobody guesses; a
  // board file is private, and its route asks who is asking.
  const fetchFile = async ({ url }) => {
    const answer = await runtimeFetch(backendPath(url), { headers: url.startsWith('/api/') ? authHeaders() : {} });
    if (!answer.ok) throw new Error(`Error ${answer.status}`);
    return new Uint8Array(await answer.arrayBuffer());
  };
  const { entries, failed } = await assembleExport(tar, fetchFile, {
    onProgress: ({ done, total }) => onProgress({ phase: 'fetching', done, total }),
  });

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
