import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
// pdf.js's own text-layer rules: the spans are laid out by CSS variables it
// sets on each one, so its stylesheet is part of the library, not decoration.
import 'pdfjs-dist/web/pdf_viewer.css';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { pdfHref } from './api';
import { resolveSource, getToken } from './source';
import PdfPage from './PdfPage';
import { GlyphFor } from './glyphs';
import { styles } from './styles';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const MIN_SCALE = 0.5;
const MAX_SCALE = 10;
const STEP = 1.25; // one press of a zoom button
const clampScale = (v) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, v));

function numberParam(name) {
  const v = new URLSearchParams(window.location.search).get(name);
  return v && /^\d+$/.test(v) ? v : null;
}

export default function App() {
  const source = useMemo(resolveSource, []);
  // Papol's Notes list links straight to one note: ?paper=9&note=42.
  const wantedNoteId = numberParam('note');
  const [paper, setPaper] = useState(null);
  const [doc, setDoc] = useState(null);
  const [notes, setNotes] = useState([]);
  const [error, setError] = useState(null);
  // Null until the page is measured: the document opens at the width of
  // the viewer, so nothing is drawn at a guessed scale first.
  const [scale, setScale] = useState(null);
  // What the pages are actually drawn at. It follows `scale` once the
  // reader stops zooming, so a pinch costs a transform rather than a
  // re-render of every visible page.
  const [renderScale, setRenderScale] = useState(null);
  const [activeNoteId, setActiveNoteId] = useState(null);
  // The anchor just pointed at: its entry in the rail lights up briefly.
  const [flashId, setFlashId] = useState(null);
  // The rail can be put away to give the page the whole window; the choice
  // is remembered, since it is about how this reader likes to read.
  const [railOpen, setRailOpen] = useState(
    () => localStorage.getItem('papol_viewer_rail') !== 'closed'
  );
  const [editing, setEditing] = useState(null); // note id being reworded
  const [naming, setNaming] = useState(null); // note id being renamed
  const [nameDraft, setNameDraft] = useState('');
  const [editText, setEditText] = useState('');
  const scrollerRef = useRef(null);
  // Anchors placed but not yet acknowledged, keyed by their temporary id.
  const pending = useRef(new Map());

  useEffect(() => {
    if (!source) {
      setError('No paper given. Open this viewer from a paper in your nook.');
      return;
    }
    if (source.requiresSignIn && !getToken()) {
      setError('Sign in to Papol first — this viewer reads your own notes.');
      return;
    }
    source
      .load()
      .then(({ doc: paperDoc, notes: loaded }) => {
        setPaper(paperDoc);
        setNotes(loaded);
      })
      .catch((e) => setError(e.message));
  }, [source]);

  useEffect(() => {
    if (!paper) return undefined;
    const href = pdfHref(paper);
    if (!href) {
      setError('This paper has no PDF.');
      return undefined;
    }
    let cancelled = false;
    const task = pdfjs.getDocument({
      url: href,
      standardFontDataUrl: 'standard_fonts/',
      wasmUrl: 'wasm/',
    });
    task.promise
      .then((d) => !cancelled && setDoc(d))
      .catch((e) => !cancelled && setError(`Could not open the PDF: ${e.message}`));
    return () => {
      cancelled = true;
      task.destroy();
    };
  }, [paper]);

  // Open at the width of the viewer. Only the opening scale — from then on
  // the zoom is the reader's.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!doc || !el) return;
    doc.getPage(1).then((page) => {
      const style = getComputedStyle(el);
      const room =
        el.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight);
      const fit = clampScale(room / page.getViewport({ scale: 1 }).width);
      setScale(fit);
      setRenderScale(fit);
    });
  }, [doc]);

  // A note placed on a different edition may sit anywhere on this one; it
  // is shown, and marked, never moved.
  // The rail is a map of the document: anchors run in page order, and
  // within a page in the order they were made. A note with no place in the
  // PDF has no page to sort by, so it sits at the end.
  const numbered = useMemo(
    () =>
      notes
        .map((n) => ({
          ...n,
          drifted:
            n.anchor != null && paper != null && n.edition_id !== paper.edition_id,
        }))
        .sort(
          (a, b) =>
            (a.page ?? Infinity) - (b.page ?? Infinity) ||
            String(a.created_at).localeCompare(String(b.created_at)) ||
            a.id - b.id
        ),
    [notes, paper]
  );

  const notesByPage = useMemo(() => {
    const map = new Map();
    for (const n of numbered) {
      if (!n.anchor) continue; // a note without a place has no pin
      if (!map.has(n.page)) map.set(n.page, []);
      map.get(n.page).push(n);
    }
    return map;
  }, [numbered]);

  // Zooming keeps the spot under the cursor under the cursor.
  //
  // The focal point is recorded as a fraction of a particular page, and the
  // scroll is corrected in a layout effect — after React has committed the
  // new sizes, before the browser paints. Page sizes are arithmetic from
  // `scale`, so by then the DOM is already correct and nothing has to be
  // waited for. Polling for the resize instead let overlapping zooms and
  // scrolls each apply a stale correction, which is what made zooming
  // drift.
  const focus = useRef(null);

  const zoomBy = (factor, at) => {
    const el = scrollerRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const cx = at ? at.x : box.left + box.width / 2;
    const cy = at ? at.y : box.top + box.height / 2;

    // The page nearest the cursor, not merely the one under it: the cursor
    // may sit in the gap between two pages.
    const pageEl = [...el.querySelectorAll('.pdf-page')].reduce((best, p) => {
      const r = p.getBoundingClientRect();
      const gap = cy < r.top ? r.top - cy : Math.max(0, cy - r.bottom);
      return !best || gap < best.gap ? { el: p, gap } : best;
    }, null)?.el;
    if (!pageEl) return;

    const r = pageEl.getBoundingClientRect();
    setScale((prev) => {
      const next = clampScale(prev * factor);
      if (next === prev) return prev;
      focus.current = {
        page: pageEl.dataset.page,
        fx: (cx - r.left) / r.width,
        fy: (cy - r.top) / r.height,
        cx,
        cy,
      };
      return next;
    });
  };

  useLayoutEffect(() => {
    const f = focus.current;
    const el = scrollerRef.current;
    focus.current = null;
    if (!f || !el) return;
    const pageEl = el.querySelector(`[data-page="${f.page}"]`);
    if (!pageEl) return;
    const r = pageEl.getBoundingClientRect();
    el.scrollLeft += r.left + f.fx * r.width - f.cx;
    el.scrollTop += r.top + f.fy * r.height - f.cy;
  }, [scale]);

  // Trackpad pinch. Chrome and Firefox deliver it as a wheel event with
  // ctrlKey set; Safari sends its own gesture events. Both are handled so
  // the browser never zooms the whole page underneath the reader.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return undefined;

    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomBy(Math.exp(-e.deltaY / 100), { x: e.clientX, y: e.clientY });
    };

    let gestureScale = 1;
    const onGestureStart = (e) => {
      e.preventDefault();
      gestureScale = e.scale;
    };
    const onGestureChange = (e) => {
      e.preventDefault();
      const factor = e.scale / gestureScale;
      gestureScale = e.scale;
      zoomBy(factor, { x: e.clientX, y: e.clientY });
    };

    // passive: false — a passive listener is forbidden from calling
    // preventDefault, and without that the page itself zooms.
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart, { passive: false });
    el.addEventListener('gesturechange', onGestureChange, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
    };
  }, [doc]);

  // A double-click on the page puts an anchor there straight away — on
  // screen at once, saved in the background, so a slow server never makes
  // the reader wait to see their own mark. Temporary ids are negative, so
  // they can never collide with the server's.
  const handlePlace = (spot) => {
    const tempId = -Date.now();
    const optimistic = {
      id: tempId,
      ...spot,
      anchor_type: spot.anchor.type,
      content: '',
      created_at: new Date().toISOString(),
    };
    setNotes((prev) => [...prev, optimistic]);
    setActiveNoteId(tempId);

    const saving = source.notes
      .create({ ...spot, content: '' })
      .then((saved) => {
        setNotes((prev) => prev.map((n) => (n.id === tempId ? saved : n)));
        setActiveNoteId((id) => (id === tempId ? saved.id : id));
        return saved;
      })
      .catch((e) => {
        // Nothing was saved, so the mark should not linger.
        setNotes((prev) => prev.filter((n) => n.id !== tempId));
        pending.current.delete(tempId);
        setError(e.message);
        return null;
      });
    pending.current.set(tempId, saving);
    return tempId;
  };

  // A triple-click marks the reader's place in the paper: one per paper,
  // so any earlier one steps down.
  const markPlace = async (id) => {
    try {
      const real = await settledId(id);
      if (real == null) return;
      // The previous marker is gone, not merely demoted.
      setNotes((prev) =>
        prev
          .filter((n) => !n.current_place || n.id === real)
          .map((n) => ({ ...n, current_place: n.id === real }))
      );
      const saved = await source.notes.markPlace(real);
      if (saved) setNotes((prev) => prev.map((n) => (n.id === real ? saved : n)));
    } catch (e) {
      setError(e.message);
    }
  };

  // Editing, moving or deleting an anchor that is still in flight waits for
  // its real id rather than failing.
  const settledId = async (id) => {
    if (id >= 0) return id;
    const saved = await pending.current.get(id);
    return saved ? saved.id : null;
  };

  // Dragging a pin moves the anchor; the words it carries are untouched.
  const moveNote = async (id, spot) => {
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, ...spot } : n)));
    try {
      const real = await settledId(id);
      if (real == null) return;
      const saved = await source.notes.move(real, spot);
      if (saved) setNotes((prev) => prev.map((n) => (n.id === real ? saved : n)));
    } catch (e) {
      setError(e.message);
    }
  };

  // An anchor's label is its name, and the page number stands in until it
  // has one. Clicking the label renames it.
  const saveName = async (note) => {
    const name = nameDraft.trim();
    setNaming(null);
    if (name === (note.name || '')) return;
    setNotes((prev) => prev.map((n) => (n.id === note.id ? { ...n, name } : n)));
    try {
      const real = await settledId(note.id);
      if (real == null) return;
      const saved = await source.notes.rename(real, name);
      if (saved) setNotes((prev) => prev.map((n) => (n.id === real ? saved : n)));
    } catch (e) {
      setError(e.message);
    }
  };

  const label = (note) =>
    naming === note.id ? (
      <input
        className="name-input"
        autoFocus
        value={nameDraft}
        placeholder={note.anchor ? `page ${note.page}` : 'a name'}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setNameDraft(e.target.value)}
        onBlur={() => saveName(note)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') saveName(note);
          if (e.key === 'Escape') setNaming(null);
        }}
      />
    ) : (
      <button
        className="name"
        title="Click to name this anchor"
        onClick={(e) => {
          e.stopPropagation();
          setNameDraft(note.name || '');
          setNaming(note.id);
        }}
      >
        {note.name || (note.anchor ? `page ${note.page}` : 'not placed on the page')}
      </button>
    );

  // Clicking an anchor on the page says which entry it is: the row lights
  // up, scrolls into view, and fades back on its own.
  const flashTimer = useRef(null);
  const pointAtNote = (id) => {
    setActiveNoteId(id);
    setRailOpen(true);
    setFlashId(id);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashId(null), 3600);
    requestAnimationFrame(() => {
      document
        .querySelector(`.rail [data-note="${id}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  };

  const startWriting = (note) => {
    setEditing(note.id);
    setEditText(note.content || '');
    goToNote(note);
  };

  const saveEdit = async (id) => {
    if (!editText.trim()) return;
    try {
      const real = await settledId(id);
      if (real == null) return;
      const updated = await source.notes.update(real, editText.trim());
      setNotes((prev) => prev.map((n) => (n.id === real ? updated : n)));
      setEditing(null);
    } catch (e) {
      setError(e.message);
    }
  };

  const removeNote = async (id) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    try {
      const real = await settledId(id);
      if (real != null) await source.notes.remove(real);
    } catch (e) {
      setError(e.message);
    }
  };

  // Opening a paper resumes where the reader left off, unless the link
  // asked for a particular note. Runs once per document.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || wantedNoteId || !doc || !scale || notes.length === 0) return;
    const here = notes.find((n) => n.current_place && n.anchor);
    resumed.current = true;
    if (here) goToNoteWhenLaid(here);
  }, [doc, scale, notes, wantedNoteId]);

  // Arriving from a link to one note: show it, once the pages exist.
  useEffect(() => {
    if (!wantedNoteId || !doc || notes.length === 0) return;
    const note = notes.find((n) => String(n.id) === wantedNoteId);
    if (note) goToNoteWhenLaid(note);
  }, [wantedNoteId, doc, notes]);

  // Each page learns its size from pdf.js a moment after the document
  // opens, so scrolling to a note on load has to wait for the page to have
  // a height — otherwise it scrolls to where the page will be, which is
  // nowhere.
  const goToNoteWhenLaid = (note, tries = 0) => {
    const pageEl = scrollerRef.current?.querySelector(`[data-page="${note.page}"]`);
    if (pageEl && pageEl.getBoundingClientRect().height > 10) {
      goToNote(note);
      return;
    }
    if (tries < 60) requestAnimationFrame(() => goToNoteWhenLaid(note, tries + 1));
  };

  // Go to the note's own place on the page, not merely the page: the
  // anchor lands in the middle of the view.
  const goToNote = (note) => {
    setActiveNoteId(note.id);
    if (!note.anchor) return;
    const scroller = scrollerRef.current;
    const pageEl = scroller?.querySelector(`[data-page="${note.page}"]`);
    if (!scroller || !pageEl) return;
    const page = pageEl.getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    // The anchor's y is a fraction from the bottom of the page in PDF
    // space; on screen it is that far down from the top.
    const anchorY = page.top + (1 - note.anchor.y) * page.height;
    const top = scroller.scrollTop + anchorY - box.top - box.height / 2;
    // A short hop is easier to follow when it glides; a jump of several
    // pages is just waiting, so it lands at once.
    const far = Math.abs(top - scroller.scrollTop) > box.height * 1.5;
    scroller.scrollTo({ top, behavior: far ? 'auto' : 'smooth' });
  };

  if (error && !doc) {
    return (
      <>
        <style>{styles}</style>
        <div className="shell">
          <div className="error">{error}</div>
          <p className="hint">
            <a href="../">Back to Papol</a>
          </p>
        </div>
      </>
    );
  }

  const pages = doc ? Array.from({ length: doc.numPages }, (_, i) => i + 1) : [];

  return (
    <>
      <style>{styles}</style>
      <header className="viewer-bar">
        {/* Arriving from Papol, going back is a step back in history, not a
            new entry — otherwise Papol's own Back button walks the reader
            straight into the viewer again. The href stays for a direct
            visit, and for opening in a new tab. */}
        <a
          className="back"
          href={source.backHref}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            if (document.referrer.startsWith(window.location.origin) && window.history.length > 1) {
              e.preventDefault();
              window.history.back();
            }
          }}
        >
          ← Back to Papol
        </a>
        <span className="spacer" />
        {/* The paper page no longer offers the raw file, so the way to keep
            a copy lives here, beside the reading of it. */}
        {paper && (
          <a
            className="bar-link"
            href={pdfHref(paper)}
            download={`${(paper.title || 'paper').replace(/[\\/:*?"<>|]/g, '-')}.pdf`}
          >
            Download
          </a>
        )}
        <span className="zoom">
          <button
            onClick={() => zoomBy(1 / STEP)}
            disabled={!scale || scale <= MIN_SCALE}
            aria-label="Zoom out"
          >
            −
          </button>
          <span className="zoom-level">{scale ? `${Math.round(scale * 100)}%` : '—'}</span>
          <button
            onClick={() => zoomBy(STEP)}
            disabled={!scale || scale >= MAX_SCALE}
            aria-label="Zoom in"
          >
            +
          </button>
        </span>
      </header>

      {error && (
        <div className="error-bar">
          {error}
          <button className="link" onClick={() => setError(null)}>
            dismiss
          </button>
        </div>
      )}


      <div className={`viewer-body${railOpen ? '' : ' rail-hidden'}`}>
        {/* A handle on the rail's edge: it clings there when the rail is
            open and to the window's edge when it is away. */}
        <button
          className="rail-handle"
          onClick={() => setRailOpen((v) => !v)}
          aria-pressed={railOpen}
          aria-label={railOpen ? 'Hide my anchors' : 'Show my anchors'}
          title={railOpen ? 'Hide my anchors' : 'Show my anchors'}
        >
          {railOpen ? '›' : '‹'}
        </button>
        <div className="pages" ref={scrollerRef}>
          {(!doc || !scale) && (
            <>
              <div className="page-skeleton" />
              <div className="page-skeleton" />
            </>
          )}
          {scale && pages.map((n) => (
            <PdfPage
              key={n}
              doc={doc}
              pageNumber={n}
              scale={scale}
              renderScale={renderScale}
              notes={notesByPage.get(n) || []}
              activeNoteId={activeNoteId}
              onPlace={handlePlace}
              onMarkPlace={markPlace}
              onSelectNote={pointAtNote}
              onMoveNote={moveNote}
            />
          ))}
        </div>

        {railOpen && (
        <aside className="rail">
          <h2>
            My anchors <span className="count">{numbered.length}</span>
          </h2>

          {numbered.length === 0 && (
            <div className="manual">
              <p>
                <b>Double-click</b> the page to drop an anchor. Give it a name, 
                and add a note if you like.
              </p>
              <p>
                <b>Triple-click</b> to mark where you are. One per paper.
                The viewer opens at that spot next time you return.
              </p>
            </div>
          )}

          {numbered.map((note) =>
            // An anchor with nothing written on it is a mark, not a note:
            // one quiet line, until there are words to show.
            !note.content && editing !== note.id ? (
              <div
                key={note.id}
                data-note={note.id}
                className={`anchor-row${note.current_place ? ' here' : ''}${
                  note.id === flashId ? ' flash' : ''
                }`}
                onClick={() => goToNote(note)}
              >
                <span className="row-glyph">
                  <GlyphFor note={note} />
                </span>
                <span className="anchor-where">
                  {note.current_place ? (
                    <span className="here-tag">here</span>
                  ) : (
                    label(note)
                  )}
                </span>
                {!note.current_place && (
                  <button
                    className="link anchor-write"
                    onClick={(e) => {
                      e.stopPropagation();
                      startWriting(note);
                    }}
                  >
                    add a note
                  </button>
                )}
                <button
                  className="card-x"
                  title="Delete this anchor"
                  aria-label="Delete this anchor"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeNote(note.id);
                  }}
                >
                  ×
                </button>
              </div>
            ) : (
              <div
                key={note.id}
                data-note={note.id}
                className={`note-card${note.current_place ? ' here' : ''}${
                  note.id === flashId ? ' flash' : ''
                }`}
                onClick={() => goToNote(note)}
              >
                <button
                  className="card-x"
                  title="Delete this anchor"
                  aria-label="Delete this anchor"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeNote(note.id);
                  }}
                >
                  ×
                </button>
                <p className="note-where">
                  <span className="row-glyph">
                    <GlyphFor note={note} />
                  </span>
                  {note.current_place ? (
                    <span className="here-tag">here</span>
                  ) : (
                    label(note)
                  )}
                  {note.drifted && (
                    <span className="drift" title="Placed on a different PDF of this paper — it may not line up">
                      other PDF
                    </span>
                  )}
                </p>
                {editing === note.id ? (
                  <>
                    <textarea
                      autoFocus
                      rows={3}
                      value={editText}
                      placeholder="What is worth remembering here?"
                      onChange={(e) => setEditText(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setEditing(null);
                      }}
                    />
                    <div className="note-actions">
                      <button
                        className="primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          saveEdit(note.id);
                        }}
                      >
                        Save
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditing(null);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="note-text">{note.content}</p>
                    {!note.current_place && (
                      <div className="note-actions">
                        <button
                          className="link"
                          onClick={(e) => {
                            e.stopPropagation();
                            startWriting(note);
                          }}
                        >
                          edit
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          )}
        </aside>
        )}
      </div>
    </>
  );
}
