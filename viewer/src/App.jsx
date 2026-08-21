import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
// pdf.js's own text-layer rules: the spans are laid out by CSS variables it
// sets on each one, so its stylesheet is part of the library, not decoration.
import 'pdfjs-dist/web/pdf_viewer.css';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { pdfHref, getReferences, getReference } from './api';
import { resolveSource, getToken } from './source';
import PdfPage from './PdfPage';
import ReferenceCard from './ReferenceCard';
import { GlyphFor, ToolGlyph } from './glyphs';
import { styles } from './styles';
import { strokePx, STRIP_RATIO, PAGE_WIDTH_GUESS } from './ink';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// The width at which the rail stops having a column of its own — the same
// number as the breakpoint in styles.js, and it has to stay that way.
const NARROW = 860;

const MIN_SCALE = 0.5;
const MAX_SCALE = 10;
// How wide a page is allowed to open. Fitting the window is right up to a
// point; past it a two-column paper on a large monitor is blown to a size
// nobody reads at. The reader can still zoom past this — it only bounds
// the scale the viewer chooses on its own, and .page-skeleton is the same
// width so the shape shown while loading is the shape that arrives.
const FIT_MAX_WIDTH = 1100;
// Five colours, not a colour wheel. Ink goes over a printed page, so each
// has to be legible across black type — but they also have to be legible
// against *each other*, and Papol's own palette is a set of muted siblings
// that were hard to tell apart at the size of a swatch. These are brighter
// and further apart. Picked with 1 to 5 while the brush is in hand.
const INK_COLORS = [
  { hex: '#e0a020', name: 'Gold' },
  { hex: '#d92b1f', name: 'Red' },
  { hex: '#1668dc', name: 'Blue' },
  { hex: '#1f9d55', name: 'Green' },
  { hex: '#14161a', name: 'Ink' },
];

// Fractions of the page width, so a stroke keeps its weight at any zoom.
// Stepped with [ and ].
const INK_WIDTHS = [0.002, 0.004, 0.008, 0.022];

// Three, one of them solid. Anything less than solid lets the words
// underneath show through, which is what marking a line wants and what
// crossing one out does not.
const INK_OPACITIES = [
  { value: 1, name: 'Solid' },
  { value: 0.5, name: 'Half' },
  { value: 0.25, name: 'Faint' },
];
const INK_COLOR = INK_COLORS[0].hex;
const INK_WIDTH = INK_WIDTHS[1];
const INK_OPACITY = INK_OPACITIES[0].value;
// One array, so a page with no ink does not get a new one every render.
const EMPTY_INK = [];

// What the reader can be holding. The arrow is reading: text selects, and
// what is already on the page can be picked up and moved. The rest put
// something in their hand, and the page stops being selectable while they
// hold it.
// z x c v, in the order the tools sit in the bar: four keys in a row under
// the hand that is not holding the mouse, so switching costs nothing in
// the middle of marking a paper up. Each carries a way to remember it, for
// the help sheet — a shortcut nobody can recall is a shortcut nobody uses,
// and "it is the third key along" is not something anyone recalls.
const TOOLS = [
  { id: 'arrow', key: 'z', badge: 'Z', label: 'Read', hint: 'Select text, and drag anchors and ink about' , mnemonic: 'Zero tools' },
  { id: 'brush', key: 'x', badge: 'X', label: 'Brush', hint: 'Draw on the page. Kept with your notes' , mnemonic: 'X marks' },
  { id: 'eraser', key: 'c', badge: 'C', label: 'Eraser', hint: 'Rub out ink, cows, and anchors with nothing written on them' , mnemonic: 'Clean' },
  { id: 'laser', key: 'v', badge: 'V', label: 'Laser', hint: 'Point at something. Leaves nothing behind' , mnemonic: 'Vanishes' },
  { id: 'anchor', key: 'a', badge: 'A', label: 'Anchor', hint: 'Click the page to drop an anchor' , mnemonic: 'Anchor' },
  { id: 'here', key: 'A', badge: '\u21e7A', label: 'Here', hint: 'Click the page to mark where you are' , mnemonic: 'Anchor, shifted' },
  { id: 'cow', key: 'm', badge: 'M', label: 'Cow', hint: 'Put a cow on the page. It wanders, and is not kept' , mnemonic: 'Moo' },
];

// How big a cow is, as a fraction of the page width, and how fast it walks
// across it. Slow: a cow crossing a page in half a minute is a cow.
const COW_SIZE = 0.075;
const COW_SPEED = 0.00003;
// A cow is either walking somewhere or has stopped to graze, and does each
// for a while before thinking better of it.
const COW_WALK = [1400, 3600];
const COW_GRAZE = [2200, 6000];
const spell = ([a, b]) => a + Math.random() * (b - a);

// The two anchors are one-shot: they are a thing you are holding until you
// put it down, and then you have what you were holding before back.
const DROP_TOOLS = new Set(['anchor', 'here']);

// Keyed by the letter as typed, so a and A are two tools rather than one
// tool and a modifier — which also means caps lock picks the capital's.
const TOOL_KEYS = Object.fromEntries(TOOLS.map((t) => [t.key, t.id]));

// One line each. Someone opening this wants to know what the thing does,
// not to read about it.
const HELP = {
  arrow: 'A regular cursor.',
  brush: 'Hold the brush mid-stroke and the line snaps straight.',
  eraser: 'Remove paint and anchors.',
  laser: 'A laser pointer.',
  anchor: 'Click to drop an anchor. Anchors can optionally be named and carry a note.',
  here: 'Click to drop a "here anchor" that marks where you have got to. Only one per paper.',
  cow: 'A cow. It wanders, stops to graze, and is not kept.',
};
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
  const [railOpen, setRailOpen] = useState(() => {
    const saved = localStorage.getItem('papol_viewer_rail');
    if (saved) return saved !== 'closed';
    // Below the breakpoint the rail lies over the page rather than beside
    // it, so on a phone it starts away and is asked for.
    return window.innerWidth > NARROW;
  });
  // The paper's bibliography, and where it is cited in the PDF. Null until
  // it has been asked for; `status` says whether it is worth waiting on.
  // What the reader is holding. Remembered, like the rail: someone marking
  // up a paper puts the brush down between sittings, not between pages.
  const [tool, setTool] = useState(
    () => localStorage.getItem('papol_viewer_tool') || 'arrow'
  );
  // Their ink on this edition. The laser is not in here — it leaves
  // nothing, which is the point of it.
  const [ink, setInk] = useState([]);
  const [helpOpen, setHelpOpen] = useState(false);
  // The anchor being carried across the page, so its row in the rail can
  // say so: the pin and the row are the same anchor seen twice, and moving
  // one ought to be visible in the other.
  const [draggingNoteId, setDraggingNoteId] = useState(null);
  // Cows. Nowhere near the server and gone on reload, like the laser's
  // trail: they are not a mark on the paper, they are company.
  const [cows, setCows] = useState([]);
  const nextCowId = useRef(0);
  // What the brush is loaded with. Remembered like the tool itself: someone
  // who marks a paper up in red goes on doing it in red.
  const [inkColor, setInkColor] = useState(
    () => localStorage.getItem('papol_viewer_ink') || INK_COLOR
  );
  const [inkWidth, setInkWidth] = useState(() => {
    const kept = Number(localStorage.getItem('papol_viewer_ink_width'));
    return INK_WIDTHS.includes(kept) ? kept : INK_WIDTH;
  });
  // The little sheet under the brush. It exists only while the brush is
  // held, which is the point of it: this is not a setting about the viewer.
  const [inkOpacity, setInkOpacity] = useState(() => {
    const kept = Number(localStorage.getItem('papol_viewer_ink_opacity'));
    return INK_OPACITIES.some((o) => o.value === kept) ? kept : INK_OPACITY;
  });
  const [brushOpen, setBrushOpen] = useState(false);
  // The width of a page of this document, reported by the first page to
  // measure itself. The brush's weights are drawn at the size of the mark
  // they make, and that size is a fraction of this.
  const [pageWidth, setPageWidth] = useState(PAGE_WIDTH_GUESS);
  const tempInkId = useRef(0);
  // Strokes already asked to go, so the eraser cannot ask twice.
  const erasing = useRef(new Set());
  // Strokes still being saved, by the temporary id they are wearing until
  // the server gives them a real one.
  const inkSaving = useRef(new Map());
  // Where the pointer last was over a page. A ref, not state: it changes
  // with every mouse move and nothing renders from it — it is read once,
  // when a key asks for an anchor where the reader is looking.
  const hoverRef = useRef(null);
  // The tool that was in hand when an anchor was dropped, to be given back
  // when the reader is done with the card the anchor opened.
  const toolBefore = useRef(null);
  const [analysis, setAnalysis] = useState(null);
  // The reference whose card is open, and the marker it was opened from —
  // the card is placed beside that box.
  const [openCite, setOpenCite] = useState(null);
  const [reference, setReference] = useState(null);
  // Where the reader was before a link took them somewhere. Following a
  // cross-reference is only useful if coming back is easy.
  const [returnTo, setReturnTo] = useState(null);
  const [referenceError, setReferenceError] = useState(null);
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

  // The references, fetched once the paper is known and then waited on.
  // Reading a PDF's bibliography takes a pass over the whole document, so
  // the first reader of an edition starts that pass and everyone after
  // them gets the stored answer straight away.
  useEffect(() => {
    const editionId = paper?.edition_id;
    if (!editionId || !source?.requiresSignIn) return undefined;

    let cancelled = false;
    let timer = null;
    // Back off as the wait goes on: a short paper is ready in a second, a
    // long one takes a minute, and neither should be asked about every
    // second for a minute.
    let wait = 1500;

    const ask = () => {
      getReferences(editionId)
        .then((loaded) => {
          if (cancelled) return;
          setAnalysis(loaded);
          if (loaded.status === 'pending') {
            wait = Math.min(wait * 1.4, 10000);
            timer = setTimeout(ask, wait);
          }
        })
        .catch(() => {
          // References are an extra. Failing to load them is not worth an
          // error bar over the reader's paper.
          if (!cancelled) setAnalysis({ status: 'failed', references: [], citations: [] });
        });
    };
    ask();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [paper?.edition_id, source]);

  // The comment above the state says the choice is remembered; this is
  // what remembers it.
  useEffect(() => {
    localStorage.setItem('papol_viewer_rail', railOpen ? 'open' : 'closed');
  }, [railOpen]);

  useEffect(() => {
    localStorage.setItem('papol_viewer_tool', tool);
  }, [tool]);

  useEffect(() => {
    localStorage.setItem('papol_viewer_ink', inkColor);
    localStorage.setItem('papol_viewer_ink_width', String(inkWidth));
    localStorage.setItem('papol_viewer_ink_opacity', String(inkOpacity));
  }, [inkColor, inkWidth, inkOpacity]);

  // Putting the brush down closes the sheet that belongs to it.
  useEffect(() => {
    if (tool !== 'brush') setBrushOpen(false);
  }, [tool]);

  // Through a ref that is refreshed every render, because the listener is
  // bound once and would otherwise go on reading the first render's `tool`
  // and `placeAt` for the life of the page — which looked like it worked,
  // since placing an anchor does not depend on either, and quietly did not.
  const onKeyRef = useRef(null);

  // Not while the reader is writing a note: in a textarea, x is an x.
  onKeyRef.current = (e) => {
      // Escape closes the help sheet first, before anything else looks at
      // the key: while it is up it is the thing in front of the reader.
      if (e.key === 'Escape' && helpOpen) {
        e.preventDefault();
        setHelpOpen(false);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target;
      if (
        el?.isContentEditable ||
        el?.tagName === 'INPUT' ||
        el?.tagName === 'TEXTAREA' ||
        el?.tagName === 'SELECT'
      ) {
        return;
      }
      // a and A are looked up as typed — they are two tools, not one tool
      // and a modifier — and everything else by its lower case, so a
      // shifted X is still the brush.
      if (e.key === 'Escape' && brushOpen) {
        e.preventDefault();
        setBrushOpen(false);
        return;
      }

      // Loading the brush, while the brush is what is in hand. Digits and
      // brackets, so nothing here is a letter another tool wanted.
      if (tool === 'brush') {
        const slot = Number(e.key);
        if (slot >= 1 && slot <= INK_COLORS.length) {
          e.preventDefault();
          setInkColor(INK_COLORS[slot - 1].hex);
          return;
        }
        if (e.key === '[' || e.key === ']') {
          e.preventDefault();
          const at = INK_WIDTHS.indexOf(inkWidth);
          const to = e.key === '[' ? at - 1 : at + 1;
          if (INK_WIDTHS[to] !== undefined) setInkWidth(INK_WIDTHS[to]);
          return;
        }
      }

      const picked = TOOL_KEYS[e.key] ?? TOOL_KEYS[e.key?.toLowerCase()];
      if (!picked) return;
      e.preventDefault();
      takeTool(picked);
    };

  useEffect(() => {
    const onKey = (e) => onKeyRef.current?.(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The ink already on this edition. Like the references, it belongs to
  // the file rather than to the paper, so it is asked for once the paper
  // has said which edition is open.
  useEffect(() => {
    if (!paper || !source?.ink) return undefined;
    let cancelled = false;
    source.ink
      .list(paper.edition_id)
      .then((loaded) => {
        if (!cancelled) setInk(loaded);
      })
      .catch(() => {
        // Ink is an addition to a paper, not the paper. Failing to load it
        // is not worth an error bar over what the reader came to read.
        if (!cancelled) setInk([]);
      });
    return () => {
      cancelled = true;
    };
  }, [paper, source]);

  const referencesById = useMemo(
    () => new Map((analysis?.references || []).map((r) => [r.id, r])),
    [analysis]
  );

  // Opening a citation. What is already known is shown at once — the raw
  // reference always, and the looked-up work if anyone has opened this
  // reference before — and the lookup fills the rest in.
  const openReference = (referenceId, box) => {
    const known = referencesById.get(referenceId) || null;
    setOpenCite({ referenceId, box });
    setReference(known);
    setReferenceError(null);
    if (known?.resolved_status) return; // already looked up, and stored

    getReference(referenceId)
      .then((full) => {
        setReference((current) =>
          current && current.id !== referenceId ? current : full
        );
        // Keep it, so opening the same marker again costs nothing.
        setAnalysis((prev) =>
          prev
            ? {
                ...prev,
                references: prev.references.map((r) => (r.id === full.id ? full : r)),
              }
            : prev
        );
      })
      .catch((e) => setReferenceError(e.message));
  };

  // A link in the PDF: "see Section 3.2", "Figure 4". The destination is a
  // fraction down a page, so it survives any zoom.
  const followLink = ({ page, y }) => {
    const scroller = scrollerRef.current;
    const pageEl = scroller?.querySelector(`[data-page="${page}"]`);
    if (!scroller || !pageEl) return;
    const from = scroller.scrollTop;
    const pageBox = pageEl.getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    // A little above what was linked to, rather than flush against the top
    // edge: a heading with nothing above it is hard to place.
    const target =
      from + pageBox.top - box.top + y * pageBox.height - box.height * 0.15;
    const top = Math.max(0, target);
    const far = Math.abs(top - from) > box.height * 1.5;
    scroller.scrollTo({ top, behavior: far ? 'auto' : 'smooth' });
    // Only worth offering the way back when the jump actually went
    // somewhere; a link to what is already on screen has not lost anyone.
    // A quarter of the window is enough to have lost it, though — the
    // paragraph being read rarely survives that much movement.
    setReturnTo(Math.abs(top - from) > box.height * 0.25 ? from : null);
  };

  const goBack = () => {
    const scroller = scrollerRef.current;
    if (scroller && returnTo != null) {
      scroller.scrollTo({ top: returnTo, behavior: 'auto' });
    }
    setReturnTo(null);
  };

  const closeReference = () => {
    setOpenCite(null);
    setReference(null);
    setReferenceError(null);
  };

  // The card closes on Escape, like every other transient thing here.
  useEffect(() => {
    if (!openCite) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') closeReference();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openCite]);

  // Open at the width of the viewer, and stay there until the reader picks
  // a zoom of their own. Rotating a phone, resizing a window and putting
  // the rail away all change how much room a page has, and a document that
  // opened fitted should still be fitted afterwards. Once the reader has
  // zoomed, the scale is theirs and nothing touches it again.
  const chosenZoom = useRef(false);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!doc || !el) return undefined;
    let gone = false;
    let pageWidth = null;

    const fit = () => {
      if (gone || pageWidth == null || chosenZoom.current) return;
      const style = getComputedStyle(el);
      const room =
        el.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight);
      if (room <= 0) return; // laid out but not yet given a size
      const next = clampScale(Math.min(room, FIT_MAX_WIDTH) / pageWidth);
      setScale(next);
      setRenderScale(next);
    };

    doc.getPage(1).then((page) => {
      pageWidth = page.getViewport({ scale: 1 }).width;
      fit();
    });

    // The element's own width, not the window's: the rail opening takes
    // room from the pages without the window changing at all.
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => {
      gone = true;
      watch.disconnect();
    };
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

  const inkByPage = useMemo(() => {
    const map = new Map();
    for (const stroke of ink) {
      if (!map.has(stroke.page)) map.set(stroke.page, []);
      map.get(stroke.page).push(stroke);
    }
    return map;
  }, [ink]);

  // A stroke appears the instant the pointer lifts and is saved behind it.
  // Waiting for the server first would make the brush feel like it was
  // dragging something heavy; if the save fails the stroke is taken back,
  // which is the honest thing to do with a mark that was not kept.
  const drawStroke = async (stroke) => {
    if (!source?.ink) return;
    const provisional = `wet-${++tempInkId.current}`;
    setInk((all) => [...all, { ...stroke, id: provisional }]);
    const saving = source.ink.create(paper?.edition_id, stroke);
    inkSaving.current.set(provisional, saving);
    try {
      const saved = await saving;
      setInk((all) => all.map((s) => (s.id === provisional ? saved : s)));
    } catch (err) {
      setInk((all) => all.filter((s) => s.id !== provisional));
      setError(err.message || 'That stroke could not be saved.');
    } finally {
      inkSaving.current.delete(provisional);
    }
  };

  // The id the server knows this stroke by, waiting for it if the stroke is
  // still on its way there.
  //
  // Rubbing out a stroke drawn a moment ago used to send its temporary id
  // to the server, which refused it — and refusing is not a 404, so the
  // stroke was put back. Worse, the save landing in the meantime tried to
  // swap the temporary id for the real one on a list the stroke had already
  // been taken out of, so it came back wearing a name the server had never
  // heard of and could not be erased again until the page was reloaded.
  // Which is exactly what it looked like from the outside.
  const settledInkId = async (id) => {
    if (typeof id === 'number') return id;
    const saving = inkSaving.current.get(id);
    if (!saving) return null;
    try {
      return (await saving)?.id ?? null;
    } catch {
      return null; // it was never saved, so there is nothing to erase
    }
  };

  // Carried on screen as it is dragged and written down when it is put
  // down, so the page keeps up with the hand and the server hears once.
  const moveStroke = async (id, points) => {
    if (!source?.ink?.move) return;
    const was = ink.find((s) => s.id === id);
    setInk((all) => all.map((s) => (s.id === id ? { ...s, points } : s)));
    try {
      const real = await settledInkId(id);
      if (real == null) return;
      const saved = await source.ink.move(real, points);
      if (saved) setInk((all) => all.map((s) => (s.id === id ? saved : s)));
    } catch (err) {
      if (was) setInk((all) => all.map((s) => (s.id === id ? was : s)));
      setError(err.message || 'That stroke could not be moved.');
    }
  };

  const eraseStroke = async (id) => {
    if (!source?.ink) return;
    // The eraser asks on every movement of the pointer, several times in a
    // frame, and `ink` is whatever it was when this render began — so the
    // same stroke was asked for twice, the first delete succeeded, the
    // second came back "no such stroke", and the error path put the stroke
    // back. It looked exactly like ink that could not be rubbed out. A ref
    // is the only thing here that is current within a frame.
    if (erasing.current.has(id)) return;
    const gone = ink.find((s) => s.id === id);
    if (!gone) return;
    erasing.current.add(id);
    setInk((all) => all.filter((s) => s.id !== id));
    try {
      const real = await settledInkId(id);
      if (real == null) return; // never reached the server; already gone here
      await source.ink.remove(real);
    } catch (err) {
      // A stroke the server does not have is a stroke that is gone, which
      // is what was wanted; anything else is a failure worth undoing.
      if (err.status === 404) return;
      erasing.current.delete(id);
      setInk((all) => [...all, gone]);
      setError(err.message || 'That stroke could not be erased.');
    }
  };

  const cowsByPage = useMemo(() => {
    const map = new Map();
    for (const cow of cows) {
      if (!map.has(cow.page)) map.set(cow.page, []);
      map.get(cow.page).push(cow);
    }
    return map;
  }, [cows]);

  const dropCow = (page, at) => {
    setCows((herd) => [
      ...herd,
      {
        id: `cow-${(nextCowId.current += 1)}`,
        page,
        x: at.x,
        y: at.y,
        facing: Math.random() < 0.5 ? 1 : -1,
        grazing: true,
        until: performance.now() + spell(COW_GRAZE),
        vx: 0,
        vy: 0,
      },
    ]);
  };

  const moveCow = (id, at) =>
    setCows((herd) => herd.map((c) => (c.id === id ? { ...c, ...at } : c)));

  const eraseCow = (id) => setCows((herd) => herd.filter((c) => c.id !== id));

  // Ten times a second, which is plenty for an animal that spends most of
  // its time standing still, and cheap enough that nothing else notices.
  useEffect(() => {
    if (!cows.length) return undefined;
    let last = performance.now();
    const tick = setInterval(() => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      setCows((herd) =>
        herd.map((c) => {
          if (c.held) return c; // being carried; it can graze later
          if (now >= c.until) {
            if (!c.grazing) return { ...c, grazing: true, until: now + spell(COW_GRAZE) };
            const dir = Math.random() < 0.5 ? -1 : 1;
            return {
              ...c,
              grazing: false,
              facing: dir,
              vx: dir * COW_SPEED,
              // Barely any drift up or down: a page is not a field.
              vy: (Math.random() - 0.5) * COW_SPEED * 0.3,
              until: now + spell(COW_WALK),
            };
          }
          if (c.grazing) return c;
          let { x, y, vx, vy, facing } = c;
          x += vx * dt;
          y += vy * dt;
          // The edges of the page are the edges of the field.
          if (x < 0.05) { x = 0.05; vx = -vx; facing = -facing; }
          if (x > 0.95) { x = 0.95; vx = -vx; facing = -facing; }
          if (y < 0.05) { y = 0.05; vy = -vy; }
          if (y > 0.95) { y = 0.95; vy = -vy; }
          return { ...c, x, y, vx, vy, facing };
        })
      );
    }, 100);
    return () => clearInterval(tick);
  }, [cows.length]);

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
    chosenZoom.current = true;
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

  // An anchor appears on screen at once and is saved in the background, so
  // a slow server never makes the reader wait to see their own mark.
  // Temporary ids are negative, so they can never collide with the
  // server's.
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

  // Marking the reader's place in the paper: one per paper, so any earlier
  // one steps down.
  // Picking up an anchor remembers what was put down for it, so that
  // dropping one in the middle of marking a paper up does not cost the
  // brush that was in hand.
  const takeTool = (picked) => {
    // Reaching for what is already in your hand opens what belongs to it,
    // whether you reached with the pointer or with the key.
    if (picked === 'brush' && tool === 'brush') {
      setBrushOpen((open) => !open);
      return;
    }
    if (DROP_TOOLS.has(picked) && !DROP_TOOLS.has(tool)) toolBefore.current = tool;
    if (!DROP_TOOLS.has(picked)) toolBefore.current = null;
    setTool(picked);
  };

  // The drop itself: the anchor lands where it was clicked, and the hand
  // goes back to whatever it was holding.
  const dropAnchor = (spot, asPlace) => {
    const id = handlePlace(spot);
    if (asPlace) markPlace(id);
    setTool(toolBefore.current || 'arrow');
    toolBefore.current = null;
  };

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
    // A shade longer than the 5s fade in styles.js, so the class outlives
    // the animation rather than cutting it short.
    flashTimer.current = setTimeout(() => setFlashId(null), 6100);
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
          ← <span className="back-word">Back to </span>Papol
        </a>
        <span className="spacer" />
        <span className="tools" role="group" aria-label="Tool">
          {TOOLS.map((t) => (
            <span className="tool-slot" key={t.id}>
              <button
                type="button"
                className={`tool${tool === t.id ? ' on' : ''}`}
                // The brush wears what it is loaded with, so the bar answers
                // "what will I draw with" without anything being opened.
                style={t.id === 'brush' ? { '--loaded': inkColor } : undefined}
                aria-pressed={tool === t.id}
                aria-label={t.label}
                aria-expanded={t.id === 'brush' ? brushOpen : undefined}
                title={
                  t.id === 'brush'
                    ? `${t.label} (X) — ${t.hint}. X again for colour and width`
                    : `${t.label} (${t.badge}) — ${t.hint}`
                }
                // Once to pick it up, again to open what belongs to it.
                onClick={() => takeTool(t.id)}
              >
                <ToolGlyph id={t.id} />
                {/* The key, on the thing it presses. A shortcut written only
                    in a tooltip is one nobody finds. */}
                <span
                  className="tool-key"
                  data-wide={t.badge.length > 1 ? 'true' : undefined}
                  aria-hidden="true"
                >
                  {t.badge}
                </span>
              </button>

              {/* Hung off the brush rather than put in the bar: how heavy
                  the ink is and what colour it is are facts about the
                  brush, and mean nothing while anything else is in hand. */}
              {t.id === 'brush' && brushOpen && (
                <div className="brush-pop" role="group" aria-label="Colour and width">
                  <div className="swatches">
                    {INK_COLORS.map((c, i) => (
                      <button
                        key={c.hex}
                        type="button"
                        className={`swatch${c.hex === inkColor ? ' on' : ''}`}
                        style={{ background: c.hex }}
                        aria-pressed={c.hex === inkColor}
                        aria-label={c.name}
                        title={`${c.name} (${i + 1})`}
                        onClick={() => setInkColor(c.hex)}
                      />
                    ))}
                  </div>
                  <div className="weights" role="group" aria-label="Transparency">
                    {INK_OPACITIES.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        className={`shade${o.value === inkOpacity ? ' on' : ''}`}
                        aria-pressed={o.value === inkOpacity}
                        aria-label={o.name}
                        title={o.name}
                        onClick={() => setInkOpacity(o.value)}
                      >
                        {/* Shown over a rule of text, because how much of
                            the page a mark hides is the whole question. */}
                        <span className="shade-sample">
                          <span
                            className="shade-ink"
                            style={{ background: inkColor, opacity: o.value }}
                          />
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="weights">
                    {INK_WIDTHS.map((w, i) => (
                      <button
                        key={w}
                        type="button"
                        className={`weight${w === inkWidth ? ' on' : ''}`}
                        aria-pressed={w === inkWidth}
                        aria-label={`Width ${i + 1}`}
                        title={i === 0 ? 'Finest ([ and ])' : `Width ${i + 1}`}
                        onClick={() => setInkWidth(w)}
                      >
                        {/* The mark itself, at the size and the strength
                            and the colour it will be made in — the same
                            strip the cursor shows, from the same
                            arithmetic. Nobody judges a stroke width from a
                            number, or from a dot that only ranks it. */}
                        <span
                          className="weight-strip"
                          style={{
                            width: strokePx(w, pageWidth),
                            height: strokePx(w, pageWidth) * STRIP_RATIO,
                            background: inkColor,
                            opacity: inkOpacity,
                          }}
                        />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </span>
          ))}
        </span>
        {/* The paper page no longer offers the raw file, so the way to keep
            a copy lives here, beside the reading of it — and at the end of
            the bar, because everything before it acts on the page in front
            of you and this one leaves with a copy of it. */}
        {paper && (
          <a
            className="bar-link"
            href={pdfHref(paper)}
            download={`${(paper.title || 'paper').replace(/[\\/:*?"<>|]/g, '-')}.pdf`}
          >
            Download
          </a>
        )}
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
              analysis={analysis}
              openReferenceId={openCite?.referenceId ?? null}
              onOpenReference={openReference}
              onFollowLink={followLink}
              onSelectNote={pointAtNote}
              onMoveNote={moveNote}
              tool={tool}
              ink={inkByPage.get(n) || EMPTY_INK}
              inkColor={inkColor}
              inkWidth={inkWidth}
              inkOpacity={inkOpacity}
              onDrawStroke={drawStroke}
              onEraseStroke={eraseStroke}
              onEraseNote={removeNote}
              onHover={(spot) => {
                hoverRef.current = spot;
              }}
              onDropAnchor={dropAnchor}
              onMoveStroke={moveStroke}
              onDragNote={setDraggingNoteId}
              onPageSize={setPageWidth}
              cows={cowsByPage.get(n) || EMPTY_INK}
              onDropCow={dropCow}
              onMoveCow={moveCow}
              onEraseCow={eraseCow}
            />
          ))}
        </div>

        {helpOpen && (
          <div
            className="help-back"
            role="dialog"
            aria-modal="true"
            aria-label="What the tools do"
            onClick={() => setHelpOpen(false)}
          >
            {/* Stopped here so a click inside the sheet does not close it. */}
            <div className="help-sheet" onClick={(e) => e.stopPropagation()}>
              <h3>What the tools do</h3>
              <dl>
                {TOOLS.map((t) => (
                  <React.Fragment key={t.id}>
                    {/* Four columns — key, glyph, name, mnemonic — so a
                        wide badge like the shifted one cannot shunt its row
                        out of line with the others. The dt is
                        display: contents, which lets its children be the
                        columns. */}
                    <dt>
                      <kbd>{t.badge}</kbd>
                      <span className="help-glyph">
                        <ToolGlyph id={t.id} />
                      </span>
                      {/* Beside the name, where the eye already is when it
                          reads the key next to it, with the key's own
                          letter picked out of the word. */}
                      <span className="help-name">{t.label}</span>
                      <span className="mnemonic">
                        <b>{t.mnemonic[0]}</b>
                        {t.mnemonic.slice(1)}
                      </span>
                    </dt>
                    <dd>{HELP[t.id]}</dd>
                  </React.Fragment>
                ))}
              </dl>
              <p className="help-foot">
                Paint and anchors are stored with the paper.
              </p>
              <button type="button" className="help-done" onClick={() => setHelpOpen(false)}>
                Done
              </button>
            </div>
          </div>
        )}

        {returnTo != null && (
          <button className="jump-back" onClick={goBack}>
            ← Back to where you were
          </button>
        )}

        {openCite && (
          <ReferenceCard
            box={openCite.box}
            reference={reference}
            error={referenceError}
            onClose={closeReference}
          />
        )}

        {railOpen && (
        <aside className="rail">
          <h2>
            My anchors
            <button
              type="button"
              className="rail-help"
              aria-label="What the tools do"
              title="What the tools do"
              onClick={() => setHelpOpen(true)}
            >
              ?
            </button>
          </h2>

          {numbered.length === 0 && (
            <div className="manual">
              <p>
                Use the help above to learn the different tools.
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
                }${note.id === draggingNoteId ? ' carrying' : ''}`}
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
                }${note.id === draggingNoteId ? ' carrying' : ''}`}
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
