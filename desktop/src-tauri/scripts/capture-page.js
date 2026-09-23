// What the capture window's page is asked to do before its picture is
// taken (desktop/src-tauri/src/capture.rs, which embeds this file and
// then calls `papolCapture.watch()`).
//
// The window has no capabilities — it holds whatever site was pasted —
// so the page cannot call Papol. It says the one thing the application
// needs to hear, that it has stopped changing, by titling itself, which
// the application reads off the webview.
//
// Two things have to happen before a picture is worth taking. A page
// built by its scripts draws nothing for seconds after its load event,
// and a page that loads what is on screen only when scrolled to asks for
// nothing until something moves. Both were photographed blank.
(() => {
  const QUIET_TITLE = 'papol-capture-quiet';
  // Nothing changed for this long, and the document complete: quiet.
  const STILLNESS = 900;
  // However busy the page stays, its picture is taken by then.
  const LONGEST = 14000;

  // A picture the page holds but hides. A site that draws grey squares
  // until its own scripts are happy (Instagram, signed out) leaves the
  // pictures loaded and `visibility: hidden` behind them, and the card
  // then shows the squares. One that is loaded, big enough to matter and
  // in view is shown — never one inside something the page has put away,
  // which is a dialog waiting its turn, not the page.
  const hiddenPicture = (image, view) => {
    if (!image.complete || image.naturalWidth < 32) return false;
    const box = image.getBoundingClientRect();
    if (box.width < 32 || box.height < 32 || box.bottom < 0 || box.top > view) return false;
    if (getComputedStyle(image).visibility !== 'hidden') return false;
    return !image.closest('[aria-hidden="true"], [hidden], [role="dialog"], dialog');
  };

  const reveal = () => {
    for (const image of document.images) {
      if (hiddenPicture(image, innerHeight)) image.style.setProperty('visibility', 'visible', 'important');
    }
  };

  const watch = () => {
    const began = performance.now();
    let changed = performance.now();
    const touch = () => { changed = performance.now(); };
    // A glance down the page and back to the top, to ask for what is
    // only loaded once scrolled to.
    (async () => {
      const rest = (ms) => new Promise((done) => setTimeout(done, ms));
      for (const y of [innerHeight, innerHeight * 2, innerHeight, 0]) {
        try { scrollTo({ top: y, behavior: 'instant' }); } catch (e) { scrollTo(0, y); }
        await rest(200);
      }
      touch();
    })();
    try { new MutationObserver(touch).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true }); } catch (e) {}
    try { new PerformanceObserver(touch).observe({ type: 'resource', buffered: true }); } catch (e) {}
    // A picture asked for but not drawn yet is not quiet.
    const waiting = () => [...document.images].some((image) => {
      if (image.complete || !image.currentSrc) return false;
      const box = image.getBoundingClientRect();
      return box.bottom > 0 && box.top < innerHeight && box.width > 1 && box.height > 1;
    });
    let told = false;
    const tell = async () => {
      if (told) return;
      told = true;
      reveal();
      // Bytes that have arrived are not yet a picture on screen: WebKit
      // decodes a large one on another thread, and a snapshot taken
      // first draws the space where it will be.
      try { await Promise.all([...document.images].map((image) => image.decode?.().catch(() => {}))); } catch (e) {}
      document.title = QUIET_TITLE;
    };
    const watcher = setInterval(() => {
      const still = performance.now() - changed > STILLNESS && document.readyState === 'complete' && !waiting();
      if (still || performance.now() - began > LONGEST) {
        clearInterval(watcher);
        tell();
      }
    }, 120);
  };

  globalThis.papolCapture = { watch, reveal, hiddenPicture, QUIET_TITLE };
})();
