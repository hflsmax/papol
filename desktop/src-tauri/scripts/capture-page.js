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

  // Whether something is where it can be seen: big enough to matter and
  // within the window as it will be photographed.
  const inView = (element) => {
    const box = element.getBoundingClientRect();
    return box.width > 32 && box.height > 32 && box.bottom > 0 && box.top < innerHeight;
  };

  // Not every page draws with words and pictures: one may be painted —
  // a coloured band, a hero behind the text, a shop's tiles as
  // backgrounds rather than `img`. This is how many different things the
  // page paints where they can be seen. One is a blank page: an expanse
  // of a single colour is what an empty shell and a wall both look like.
  const painted = () => {
    const fills = new Set();
    for (const element of document.querySelectorAll('body *')) {
      if (!inView(element)) continue;
      const style = getComputedStyle(element);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      if (style.backgroundImage && style.backgroundImage !== 'none') fills.add(style.backgroundImage);
      const colour = style.backgroundColor;
      if (colour && colour !== 'transparent' && !/^rgba\(.*,\s*0\)$/.test(colour)) fills.add(colour);
    }
    return fills.size;
  };

  // What the page is actually showing, as the application reads it off
  // the title: a page that shows nothing — a wall that never drew, a
  // site that answered a stranger with an empty shell, a shell still
  // waiting to hand over to the page proper — is worth no picture yet,
  // and may be worth none at all.
  const showing = () => {
    const text = (document.body ? document.body.innerText : '').trim().length;
    let pictures = 0;
    for (const image of document.images) {
      // A picture `reveal` will bring back counts as shown: by the time
      // the snapshot is taken it will be.
      if (!inView(image) || !image.complete || image.naturalWidth <= 32) continue;
      if (getComputedStyle(image).visibility !== 'hidden' || hiddenPicture(image, innerHeight)) pictures += 1;
    }
    let drawings = 0;
    for (const element of document.querySelectorAll('canvas, svg, video')) {
      if (inView(element)) drawings += 1;
    }
    // Counting paint means asking the page about every element it shows,
    // which is work, so it is asked only when nothing cheaper has
    // answered — which is to say, only when the page looks empty.
    const drawn = text > 40 || pictures > 0 || drawings > 0;
    return { text, pictures, drawings, fills: drawn ? 0 : painted() };
  };

  // What the page calls itself, for the card's text: the title it gives
  // to anyone sharing it, else the one on its tab. Read before `tell`
  // takes the tab's title over for its signal.
  const title = () => {
    const shared = document.querySelector('meta[property="og:title"], meta[name="twitter:title"]')?.content;
    return (shared || document.title || '').replace(/\s+/g, ' ').trim();
  };

  // Is there a picture in this? A line of text on one flat colour is a
  // notice, a wall or an empty shell, whichever site it came from.
  const worth = (report) =>
    report.text > 40 || report.pictures > 0 || report.drawings > 0 || report.fills > 1;

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
      document.title = QUIET_TITLE + ':' + JSON.stringify({ ...showing(), title: title() });
    };
    // A page can be still and yet show nothing. Etsy's results answer a
    // stranger with a shell — complete, unchanging, three empty elements
    // — and hand over to the page proper a second later; it was quiet,
    // and photographed white. So stillness is the moment for a picture
    // only once there is something to put in it. A page that never has
    // anything waits out `LONGEST` and is photographed as it stands,
    // which says so plainly (`showing`) and costs it its picture.
    const watcher = setInterval(() => {
      const still = performance.now() - changed > STILLNESS && document.readyState === 'complete' && !waiting();
      if ((still && worth(showing())) || performance.now() - began > LONGEST) {
        clearInterval(watcher);
        tell();
      }
    }, 120);
  };

  globalThis.papolCapture = { watch, reveal, hiddenPicture, showing, title, worth, QUIET_TITLE };
})();
