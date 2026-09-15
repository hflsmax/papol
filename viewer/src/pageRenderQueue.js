// Drawing a page is main-thread work: pdf.js spends a slice of every frame on
// it until the page is done. Pages that all ask at once — a fling past ten of
// them, or every page on screen after a zoom — would share each frame between
// them and all arrive late, so they wait here instead: one drawing at a time,
// the page nearest the reader first, and a page that has scrolled away by its
// turn is dropped without being drawn.
//
// An `idle` job — a text layer, which is needed to select words but not to see
// the page — waits for drawing to finish and for scrolling to pause.
//
// A job is { priority, run, idle }. `priority()` is asked at the moment a job
// could start: lower goes first, and null means the job is no longer wanted.

export const SCROLL_QUIET_MS = 180;
// A newly visible bitmap is expensive and disposable if the page is already
// moving away. Give a fling just enough time to declare itself before starting
// another PDF render. This is deliberately shorter than the text-layer pause:
// pixels should arrive promptly; selectable text can wait until reading stops.
export const DRAW_SCROLL_QUIET_MS = 80;

export function createRenderQueue({
  now = () => performance.now(),
  later = (fn, ms) => setTimeout(fn, ms),
  onError = (error) => console.error(error),
} = {}) {
  const waiting = new Set();
  const active = new Set();
  const running = { draw: 0, idle: 0 };
  let lastScroll = -Infinity;
  let pumping = false;
  let wake = null;

  const start = (job) => {
    waiting.delete(job);
    job.interrupted = false;
    active.add(job);
    const lane = job.idle ? 'idle' : 'draw';
    running[lane] += 1;
    Promise.resolve()
      .then(job.run)
      .catch(onError)
      .finally(() => {
        active.delete(job);
        running[lane] -= 1;
        if (job.interrupted && job.priority() != null) waiting.add(job);
        job.interrupted = false;
        schedule();
      });
  };

  const pump = () => {
    pumping = false;
    let draw = null;
    let idle = null;
    for (const job of [...waiting]) {
      const priority = job.priority();
      if (priority == null) {
        waiting.delete(job);
        continue;
      }
      const best = job.idle ? idle : draw;
      if (best && best.priority <= priority) continue;
      if (job.idle) idle = { job, priority };
      else draw = { job, priority };
    }
    if (draw && running.draw === 0) {
      const quietFor = now() - lastScroll;
      if (draw.job.scrollSensitive && quietFor < DRAW_SCROLL_QUIET_MS) {
        if (wake == null) {
          wake = later(() => {
            wake = null;
            schedule();
          }, DRAW_SCROLL_QUIET_MS - quietFor);
        }
      } else {
        start(draw.job);
      }
    }
    if (!idle || draw || running.draw || running.idle) return;
    const quietFor = now() - lastScroll;
    if (quietFor >= SCROLL_QUIET_MS) start(idle.job);
    else if (wake == null) {
      wake = later(() => {
        wake = null;
        schedule();
      }, SCROLL_QUIET_MS - quietFor);
    }
  };

  function schedule() {
    if (pumping) return;
    pumping = true;
    Promise.resolve().then(pump);
  }

  return {
    // Returns a function that withdraws the job if it has not started.
    request(job) {
      waiting.add(job);
      schedule();
      return () => {
        waiting.delete(job);
      };
    },
    scrolled() {
      lastScroll = now();
      // Background preparation is useful only while the document is still.
      // An interruptible idle job returns to the queue and retries after the
      // gesture, instead of sharing the main thread with live scrolling or
      // pinch frames.
      for (const job of active) {
        if (!job.idle || job.interrupted || !job.interrupt) continue;
        if (job.interrupt() !== false) job.interrupted = true;
      }
    },
    // Resolves in a later task, once scrolling has paused: for work split
    // into pieces that should step aside while the reader moves the page.
    quiet() {
      return new Promise((resolve) => {
        const check = () => {
          const wait = SCROLL_QUIET_MS - (now() - lastScroll);
          if (wait > 0) later(check, wait);
          else later(resolve, 0);
        };
        check();
      });
    },
  };
}

let shared = null;

// The one queue every page of the open document shares.
export function pageRenderQueue() {
  if (!shared) {
    const queue = createRenderQueue();
    // Scroll events do not bubble, but they can be caught on the way down.
    document.addEventListener('scroll', () => queue.scrolled(), { capture: true, passive: true });
    shared = queue;
  }
  return shared;
}
