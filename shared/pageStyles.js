// Rules a shared piece of UI brings with it, added to the page once.
//
// As a constructed sheet, not a <style> element. Tauri hashes the inline
// <style> in a page's HTML into that window's Content-Security-Policy
// (the viewer's index.html has one), and once style-src carries a hash
// WebKit ignores 'unsafe-inline': a <style> element added later is kept in
// the document with none of its rules applied. Papol's "Delete this?" sheet
// came up as bare text and buttons at the foot of the reader that way.
// Constructed sheets are not subject to style-src, which is why the viewer
// installs its own stylesheet like this (viewer/src/main.jsx).
//
// Where constructed sheets are missing (the unit tests' stand-in document),
// a <style> element is the fallback.

const added = new Set();

export function addPageStyles(id, css) {
  if (typeof document === 'undefined' || added.has(id)) return;
  added.add(id);
  if (typeof CSSStyleSheet === 'function' && 'adoptedStyleSheets' in document) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      return;
    } catch {
      // An engine without constructable sheets falls through to <style>.
    }
  }
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = css;
  document.head.appendChild(style);
}
