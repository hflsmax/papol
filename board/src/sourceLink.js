// Board backlinks are stored as canonical viewer URLs so they work on the
// web. Desktop needs the same viewer path on its local app origin instead.
export function localViewerBacklink(sourceUrl, appPath) {
  try {
    const url = new URL(sourceUrl);
    const marker = url.pathname.includes('/demo/viewer/') ? '/demo/viewer/' : '/viewer/';
    const markerAt = url.pathname.indexOf(marker);
    if (markerAt < 0) return null;
    return appPath(`${url.pathname.slice(markerAt)}${url.search}${url.hash}`);
  } catch {
    return null;
  }
}
