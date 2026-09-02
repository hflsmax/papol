import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
// pdf.js's own text-layer rules: the spans are laid out by CSS variables it
// sets on each one, so its stylesheet is part of the library, not decoration.
import 'pdfjs-dist/web/pdf_viewer.css';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  pdfHref, getViewerPaperInfo, getViewerReferences, getViewerReference, resolveViewerReference,
  submitFeedback, listBoards, stageBoardExcerpt, stageBoardClip,
} from './api';
import { resolveSource, getToken } from './source';
import { appPath } from './base';
import PdfPage from './PdfPage';
import { ANIMALS } from './animals';
import ReferenceCard from './ReferenceCard';
import { readNamedReference } from './references';
import { GlyphFor, ToolGlyph } from './glyphs';
import { styles } from './styles';
import { STRIP_RATIO } from './ink';
import { selectionStrokes } from './selectionInk';
import { createPlacedAnimal, randomViewportPlacements } from './animalPlacement';
import { findTextMatches, indexPdfDocument } from './pdfSearch';
import { cleanExcerptText } from './excerptText';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// The width at which the rail stops having a column of its own — the same
// number as the breakpoint in styles.js, and it has to stay that way.
const NARROW = 860;
const LEARN_LINK_NAVIGATION_KEY = 'papol_learn_link_navigation';
const markReturnToPapol = () => {
  // This is a one-shot navigation handoff, not demo-mode state. Papol
  // consumes it on arrival so returning from the viewer does not greet the
  // same visit a second time.
  window.sessionStorage.setItem('papol.viewerReturn', '1');
};

const MIN_SCALE = 0.5;
// Four hundred per cent, which is as far as reading a paper ever needs to
// go — and, not by coincidence, as far as the brush can be honest. A
// cursor image is dropped by the browser past about 128px, so beyond this
// the strip in your hand would stop growing while the ink went on getting
// thicker, and the two would quietly stop agreeing. The heaviest weight on
// the widest page anyone uploads comes to about 74px here.
// The brush no longer limits this. It was capped at four while the brush
// was a cursor image, which a browser refuses to draw past about 128px —
// so past that the strip in your hand stopped growing while the ink went
// on getting thicker. The brush is drawn on the page now, in the stroke's
// own coordinates, and has no ceiling to reach.
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
//
// Even steps apart. They used to double and then nearly treble — 2, 4, 8
// and 22 pixels on an ordinary page — so the last was as big as the other
// three together and the first two were hard to tell apart at all. Four
// weights only work as a scale if the rungs are the same distance up.
const INK_WIDTHS = [0.003, 0.009, 0.015, 0.021];

// Three, one of them solid. Anything less than solid lets the words
// underneath show through, which is what marking a line wants and what
// crossing one out does not.
const INK_OPACITIES = [
  { value: 1, name: 'Solid' },
  { value: 0.5, name: 'Half' },
  { value: 0.25, name: 'Faint' },
];
// What the brush is loaded with before anyone has said otherwise: red, as
// faint as it goes, the flat nib, and the heaviest weight — a broad wash of
// red over a paragraph that leaves every word of it readable, which is what
// marking a paper up mostly is.
const INK_COLOR = INK_COLORS[1].hex;
const INK_WIDTH = INK_WIDTHS[INK_WIDTHS.length - 1];
const INK_OPACITY = INK_OPACITIES[INK_OPACITIES.length - 1].value;
const INK_SHAPE = 'flat';

// Bumped when those defaults change. A reader who has chosen for
// themselves keeps their choice, but one who never did was carrying the old
// defaults around in localStorage rather than no answer at all, and would
// have gone on carrying them for ever.
const INK_DEFAULTS_VERSION = '2';

// The size row is drawn to fill its cell rather than to scale: the heaviest
// weight spans the button and the rest are its true fractions, so the four
// read as a ramp instead of as four specks at the bottom of the range. What
// is being chosen there is which of four, and the brush on the page is what
// says how big that is in pixels.
const SAMPLE_MAX = 24;

// The laser's own colour. Nothing here is ever sent anywhere: a laser
// leaves nothing on the paper, so what it is set to is a fact about this
// reader's browser and no more.
const LASER_COLOR = '#d92b1f';

// Which tools keep a sheet of settings under them, so that reaching for one
// already in your hand opens it.
const SHEETS = new Set(['brush', 'laser', 'cow']);

const sampleSize = (width) => {
  const tall = (width / INK_WIDTHS[INK_WIDTHS.length - 1]) * SAMPLE_MAX;
  return { tall, wide: Math.max(2, tall / STRIP_RATIO) };
};

// The nib. Flat is a chisel held upright — broad across the page, thin
// along it, so a mark says which way the hand went. Round is the same
// weight in every direction, which is what a pen does.
const INK_SHAPES = [
  { id: 'flat', name: 'Flat' },
  { id: 'round', name: 'Round' },
];
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
  { id: 'clipper', key: 'Z', badge: '⇧Z', label: 'Clipper', hint: 'Draw a rectangle and keep a movable view of it on the paper', mnemonic: 'Zoom a clipping' },
  { id: 'brush', key: 'x', badge: 'X', label: 'Brush', hint: 'Draw on the page. Kept with your notes' , mnemonic: 'X marks' },
  { id: 'eraser', key: 'c', badge: 'C', label: 'Eraser', hint: 'Rub out ink, animals, and anchors with nothing written on them' , mnemonic: 'Clean' },
  { id: 'laser', key: 'v', badge: 'V', label: 'Laser', hint: 'Point at something. Leaves nothing behind' , mnemonic: 'Vanishes' },
  { id: 'anchor', key: 'a', badge: 'A', label: 'Anchor', hint: 'Click the page to drop an anchor' , mnemonic: 'Anchor' },
  { id: 'cow', key: 'm', badge: 'M', label: 'Animal', hint: 'Put an animal on the page. It wanders, and is not kept' , mnemonic: 'Menagerie' },
];

// Drop tools are one-shot: they are a thing you are holding until you put
// it down, and then the ordinary reading cursor comes back.
const DROP_TOOLS = new Set(['anchor', 'clipper']);

// Keyed by the letter as typed, so a and A are two tools rather than one
// tool and a modifier — which also means caps lock picks the capital's.
const TOOL_KEYS = Object.fromEntries(TOOLS.map((t) => [t.key, t.id]));

// One line each. Someone opening this wants to know what the thing does,
// not to read about it.
const HELP = {
  arrow: 'A regular cursor.',
  clipper: 'Draw a rectangle to make a movable, resizable view of that part of the paper.',
  brush: 'Hold the brush mid-stroke and the line snaps straight.',
  eraser: 'Remove paint and anchors.',
  laser: 'A laser pointer.',
  anchor: 'Click to drop an anchor. Anchors can optionally be named and carry a note.',
  cow: 'An animal that wonders.',
};
const clampScale = (v) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, v));

// A page should not rerender merely because App produced a fresh closure.
// The wrapper stays stable while always invoking the newest implementation,
// which lets memoized PdfPages respond only to data that actually changed.
function useEvent(handler) {
  const ref = useRef(handler);
  ref.current = handler;
  return useMemo(() => (...args) => ref.current(...args), []);
}

function numberParam(name) {
  const v = new URLSearchParams(window.location.search).get(name);
  return v && /^\d+$/.test(v) ? v : null;
}

function fractionParam(name) {
  const value = Number(new URLSearchParams(window.location.search).get(name));
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function selectionParam() {
  const encoded = new URLSearchParams(window.location.search).get('mark');
  if (!encoded) return [];
  try {
    const rows = JSON.parse(atob(encoded));
    if (!Array.isArray(rows) || rows.length > 100) return [];
    return rows.map(([page, x1, x2, y, width]) => ({
      page, width, shape: 'flat', points: [{ x: x1, y }, { x: x2, y }],
    })).filter((stroke) => (
      Number.isInteger(stroke.page) && stroke.page > 0 &&
      Number.isFinite(stroke.width) && stroke.width > 0 &&
      stroke.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    ));
  } catch {
    return [];
  }
}

function boundingBoxParam() {
  const encoded = new URLSearchParams(window.location.search).get('box');
  if (!encoded) return null;
  try {
    const [page, x, y, w, h] = JSON.parse(atob(encoded));
    if (!Number.isInteger(page) || page < 1 || [x, y, w, h].some((value) => !Number.isFinite(value)) ||
        x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1.001 || y + h > 1.001) return null;
    return { page, x, y, w, h };
  } catch {
    return null;
  }
}

function selectedTextWithoutPdfCitations(selection, scroller) {
  if (!selection?.rangeCount || selection.isCollapsed || !scroller) return '';
  const range = selection.getRangeAt(0);
  const citationBoxes = [...scroller.querySelectorAll('.cite')]
    .map((citation) => citation.getBoundingClientRect())
    .filter((box) => box.width > 0 && box.height > 0);
  const pieces = [];

  for (const span of scroller.querySelectorAll('.textLayer > span')) {
    const node = span.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) continue;
    try {
      if (!range.intersectsNode(node)) continue;
    } catch {
      continue;
    }
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.length;
    if (end <= start) continue;
    let text = '';
    const selectedRange = document.createRange();
    selectedRange.setStart(node, start);
    selectedRange.setEnd(node, end);
    const pieceBox = selectedRange.getBoundingClientRect();
    selectedRange.detach();
    for (let offset = start; offset < end; offset += 1) {
      const characterRange = document.createRange();
      characterRange.setStart(node, offset);
      characterRange.setEnd(node, offset + 1);
      const boxes = [...characterRange.getClientRects()];
      characterRange.detach();
      const isCitation = boxes.some((box) => citationBoxes.some((citation) => {
        const cx = box.left + box.width / 2;
        const cy = box.top + box.height / 2;
        return cx >= citation.left - 1 && cx <= citation.right + 1 &&
          cy >= citation.top - 1 && cy <= citation.bottom + 1;
      }));
      if (!isCitation) text += node.data[offset];
    }
    if (text) pieces.push({ text, box: pieceBox });
  }

  return pieces.map((piece, index) => {
    if (index === 0) return piece.text;
    const previous = pieces[index - 1];
    const newLine = piece.box.top > previous.box.top + previous.box.height * 0.55;
    const paragraphBreak = piece.box.top - previous.box.bottom >
      Math.max(piece.box.height, previous.box.height) * 0.8;
    const separated = piece.box.left - previous.box.right > 1;
    const needsSpace = !/\s$/.test(previous.text) && !/^\s/.test(piece.text);
    const separator = paragraphBreak ? '\n\n' : newLine ? '\n' : separated ? ' ' : '';
    return `${needsSpace ? separator : ''}${piece.text}`;
  }).join('');
}

function paperAuthors(authors) {
  if (!authors) return [];
  try {
    const parsed = JSON.parse(authors);
    return Array.isArray(parsed) ? parsed : [String(parsed)];
  } catch {
    return [authors];
  }
}

function paperDoiHref(doi) {
  const value = String(doi).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
  return `https://doi.org/${value}`;
}

function savedReadingView() {
  const pdf = new URLSearchParams(window.location.search).get('pdf');
  if (!pdf) return { key: null, view: null };
  const key = `papol_viewer_position_${pdf.toLowerCase()}`;
  try {
    const view = JSON.parse(localStorage.getItem(key));
    if (
      Number.isInteger(view?.page) && view.page > 0 &&
      Number.isFinite(view?.x) && Number.isFinite(view?.y) &&
      Number.isFinite(view?.scale)
    ) return { key, view };
  } catch {
    // A damaged preference is no reason not to open the paper.
  }
  return { key, view: null };
}

export default function App() {
  const source = useMemo(resolveSource, []);
  // Papol's Notes list links straight to one note: ?paper=9&note=42.
  const wantedNoteId = numberParam('note');
  const wantedPage = numberParam('page');
  const wantedY = fractionParam('y');
  const wantedSelection = useMemo(selectionParam, []);
  const wantedBox = useMemo(boundingBoxParam, []);
  const wantedSelectionByPage = useMemo(() => {
    const byPage = new Map();
    wantedSelection.forEach((stroke) => {
      byPage.set(stroke.page, [...(byPage.get(stroke.page) || []), stroke]);
    });
    return byPage;
  }, [wantedSelection]);
  const [paper, setPaper] = useState(null);
  const [doc, setDoc] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState([]);
  const [searchIndexing, setSearchIndexing] = useState(false);
  const [activeSearchResult, setActiveSearchResult] = useState(0);
  const [searchWrap, setSearchWrap] = useState(null);
  const searchWrapId = useRef(0);
  const searchInputRef = useRef(null);
  const paperMenuRef = useRef(null);
  // How much of the PDF has arrived, while it has not: null until the
  // first progress event, since a bar at 0% before the request has even
  // answered reads as stalled rather than as "not yet known".
  const [pdfProgress, setPdfProgress] = useState(null);
  const [notes, setNotes] = useState([]);
  const [error, setError] = useState(null);
  // Null until the page is measured: the document opens at the width of
  // the viewer, so nothing is drawn at a guessed scale first.
  const [scale, setScale] = useState(null);
  // What the pages are actually drawn at. It follows `scale` once the
  // reader stops zooming, so a pinch costs a transform rather than a
  // re-render of every visible page.
  const [renderScale, setRenderScale] = useState(null);
  const [selectionPaint, setSelectionPaint] = useState(null);
  const [sendSelection, setSendSelection] = useState(null);
  const [sendBoards, setSendBoards] = useState([]);
  const [sendBoardGuid, setSendBoardGuid] = useState('');
  const [sendBusy, setSendBusy] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [sendComplete, setSendComplete] = useState(false);
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
  const [tool, setTool] = useState(() => {
    const kept = localStorage.getItem('papol_viewer_tool');
    return TOOLS.some((candidate) => candidate.id === kept) ? kept : 'arrow';
  });
  // Which animal the menagerie is set to. Remembered like the tool and the
  // ink: whoever put a cat on one paper is putting a cat on the next one.
  const [animal, setAnimal] = useState(() => {
    const kept = localStorage.getItem('papol_viewer_animal');
    return ANIMALS.some((a) => a.id === kept) ? kept : 'cow';
  });
  const [animalSpeed, setAnimalSpeed] = useState(() => {
    const n = Number(localStorage.getItem('papol_viewer_animal_speed'));
    return Number.isFinite(n) && n >= 0.4 && n <= 1.8 ? n : 1;
  });
  const [animalActivity, setAnimalActivity] = useState(() => {
    const n = Number(localStorage.getItem('papol_viewer_animal_activity'));
    return Number.isFinite(n) && n >= 0 && n <= 3 ? n : 1;
  });
  const [animalFollow, setAnimalFollow] = useState(() => {
    const kept = localStorage.getItem('papol_viewer_animal_follow');
    return kept == null ? true : kept === 'true';
  });

  // Their ink on this edition. The laser is not in here — it leaves
  // nothing, which is the point of it.
  const [ink, setInk] = useState([]);
  const [selectedInk, setSelectedInk] = useState(null);
  const [hoveredInk, setHoveredInk] = useState({ pages: new Set(), objects: EMPTY_INK });
  // Private views cut from this edition. Their source and placement use
  // page fractions, so they survive zoom and are restored with the paper.
  const [clips, setClips] = useState([]);
  const [selectedClipId, setSelectedClipId] = useState(null);
  const clipSaving = useRef(new Map());
  const [helpOpen, setHelpOpen] = useState(false);
  const [paperInfoOpen, setPaperInfoOpen] = useState(false);
  const [paperInfo, setPaperInfo] = useState(null);
  const [paperInfoError, setPaperInfoError] = useState(null);
  const [learnLinkNavigation, setLearnLinkNavigation] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackContent, setFeedbackContent] = useState('');
  const [feedbackSending, setFeedbackSending] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [feedbackError, setFeedbackError] = useState(null);
  // The anchor being carried across the page, so its row in the rail can
  // say so: the pin and the row are the same anchor seen twice, and moving
  // one ought to be visible in the other.
  const [draggingNoteId, setDraggingNoteId] = useState(null);
  // Cows. Nowhere near the server and gone on reload, like the laser's
  // trail: they are not a mark on the paper, they are company.
  const [placedAnimals, setPlacedAnimals] = useState([]);
  const notesRef = useRef(notes);
  const inkRef = useRef(ink);
  const animalsRef = useRef(placedAnimals);
  notesRef.current = notes;
  inkRef.current = ink;
  animalsRef.current = placedAnimals;
  const nextAnimalId = useRef(0);
  // What the brush is loaded with. Remembered like the tool itself: someone
  // who marks a paper up in red goes on doing it in red.
  // Once, before any of the four are read.
  useState(() => {
    if (localStorage.getItem('papol_viewer_ink_defaults') === INK_DEFAULTS_VERSION) return null;
    localStorage.setItem('papol_viewer_ink_defaults', INK_DEFAULTS_VERSION);
    for (const key of ['ink', 'ink_width', 'ink_opacity', 'ink_shape']) {
      localStorage.removeItem(`papol_viewer_${key}`);
    }
    return null;
  });

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
  const [inkShape, setInkShape] = useState(
    () => localStorage.getItem('papol_viewer_ink_shape') || INK_SHAPE
  );
  const [laserColor, setLaserColor] = useState(
    () => localStorage.getItem('papol_viewer_laser') || LASER_COLOR
  );
  // The sheet that is open, if any: 'brush', 'laser', or nothing. One at a
  // time, because it hangs off the tool it belongs to and only one tool is
  // ever in hand.
  const [sheet, setSheet] = useState(null);
  const brushOpen = sheet === 'brush';
  const tempInkId = useRef(0);
  const tempNoteId = useRef(0);
  // Strokes already asked to go, so the eraser cannot ask twice.
  const erasing = useRef(new Set());
  // Strokes still being saved, by the temporary id they are wearing until
  // the server gives them a real one.
  const inkSaving = useRef(new Map());
  const history = useRef({ undo: [], redo: [], running: false });

  const remember = (command) => {
    if (history.current.running) return;
    history.current.undo.push(command);
    history.current.redo = [];
  };

  const runHistory = async (direction) => {
    const state = history.current;
    if (state.running) return;
    const from = direction === 'undo' ? state.undo : state.redo;
    const to = direction === 'undo' ? state.redo : state.undo;
    const command = from.pop();
    if (!command) return;
    state.running = true;
    try {
      await command[direction]();
      to.push(command);
    } catch (err) {
      from.push(command);
      setError(err.message || `Could not ${direction} that change.`);
    } finally {
      state.running = false;
    }
  };
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
  // cross-reference is only useful if coming back is exact. The scroll
  // offsets belong to the scale at which they were recorded, so keep that
  // scale with them and restore the offsets after React has laid it out.
  const linkHistory = useRef({ back: [], forward: [] });
  const [, renderLinkHistory] = useState(0);
  const restoringView = useRef(null);
  const [referenceError, setReferenceError] = useState(null);
  const [editing, setEditing] = useState(null); // note id being reworded
  const [naming, setNaming] = useState(null); // note id being renamed
  const [nameDraft, setNameDraft] = useState('');
  const [editText, setEditText] = useState('');
  const scrollerRef = useRef(null);
  const readingView = useRef(savedReadingView());
  const readingViewRestored = useRef(false);
  // Anchors placed but not yet acknowledged, keyed by their temporary id.
  const pending = useRef(new Map());

  useEffect(() => {
    if (!source) {
      setError('Open a paper from your nook.');
      return;
    }
    if (source.requiresSignIn && !getToken()) {
      setError('Sign in to view your notes.');
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
    setPdfProgress(null);
    const task = pdfjs.getDocument({
      url: href,
      standardFontDataUrl: 'standard_fonts/',
      wasmUrl: 'wasm/',
    });
    task.onProgress = ({ loaded, total }) => {
      if (!cancelled) setPdfProgress({ loaded, total });
    };
    task.promise
      .then((d) => !cancelled && setDoc(d))
      .catch((e) => !cancelled && setError(`PDF failed to open: ${e.message}`));
    return () => {
      cancelled = true;
      task.destroy();
    };
  }, [paper]);

  useEffect(() => {
    if (!paperInfoOpen || paperInfo) return undefined;
    const pdfHash = paper?.edition_sha256 || paper?.sha256;
    if (!pdfHash) return undefined;
    let cancelled = false;
    setPaperInfoError(null);
    getViewerPaperInfo(pdfHash)
      .then((info) => {
        if (!cancelled) setPaperInfo(info);
      })
      .catch((e) => {
        if (!cancelled) setPaperInfoError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [paper, paperInfo, paperInfoOpen]);

  useEffect(() => {
    if (!paperInfoOpen) return undefined;
    const closeAway = (event) => {
      if (!paperMenuRef.current?.contains(event.target)) setPaperInfoOpen(false);
    };
    document.addEventListener('pointerdown', closeAway, true);
    return () => document.removeEventListener('pointerdown', closeAway, true);
  }, [paperInfoOpen]);

  useEffect(() => {
    setSearchIndex([]);
  }, [doc]);

  // Search is optional and indexing a long document is not. Defer the pass
  // over every PDF page until search is actually opened, then retain it for
  // the rest of this document's session.
  useEffect(() => {
    if (!doc) {
      return undefined;
    }
    if (!searchOpen || searchIndex.length === doc.numPages) return undefined;
    let cancelled = false;
    setSearchIndexing(true);
    (async () => {
      try {
        const indexed = await indexPdfDocument(doc, { cancelled: () => cancelled });
        if (!indexed) return;
        setSearchIndex(indexed);
      } catch (e) {
        if (!cancelled) setError(`PDF search failed: ${e.message}`);
      } finally {
        if (!cancelled) setSearchIndexing(false);
      }
    })();
    return () => { cancelled = true; };
  }, [doc, searchOpen, searchIndex.length]);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return searchIndex.flatMap((pageIndex, page) => (
      findTextMatches(pageIndex, searchQuery).map((match, occurrence) => ({
        ...match,
        page: page + 1,
        id: `${page + 1}-${occurrence}`,
      }))
    ));
  }, [searchIndex, searchQuery]);
  const searchResultsByPage = useMemo(() => {
    const byPage = new Map();
    for (const result of searchResults) {
      const matches = byPage.get(result.page) || [];
      matches.push(result);
      byPage.set(result.page, matches);
    }
    return byPage;
  }, [searchResults]);

  useEffect(() => {
    setActiveSearchResult(0);
    setSearchWrap(null);
  }, [searchQuery]);

  const moveThroughSearch = (direction) => {
    if (!searchResults.length) return;
    const next = activeSearchResult + direction;
    if (next < 0 || next >= searchResults.length) {
      setSearchWrap({ id: ++searchWrapId.current, direction });
    }
    setActiveSearchResult((next + searchResults.length) % searchResults.length);
  };

  useEffect(() => {
    if (!searchOpen) return;
    searchInputRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    const result = searchResults[activeSearchResult];
    if (!result) return;
    scrollerRef.current
      ?.querySelector(`.pdf-page[data-page="${result.page}"]`)
      // Bring a lazy page close enough to render, but do not center it: the
      // text layer will make the smaller, exact adjustment to the match.
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [searchResults, activeSearchResult]);

  // The references, fetched once the paper is known and then waited on.
  // Reading a PDF's bibliography takes a pass over the whole document, so
  // the first reader of an edition starts that pass and everyone after
  // them gets the stored answer straight away.
  useEffect(() => {
    const editionId = paper?.edition_id;
    const pdfHash = paper?.edition_sha256 || paper?.sha256;
    if (!editionId || !pdfHash) return undefined;

    let cancelled = false;
    let timer = null;
    // Back off as the wait goes on: a short paper is ready in a second, a
    // long one takes a minute, and neither should be asked about every
    // second for a minute.
    let wait = 1500;

    const ask = () => {
      getViewerReferences(pdfHash, editionId)
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
  }, [paper]);

  // The comment above the state says the choice is remembered; this is
  // what remembers it.
  useEffect(() => {
    localStorage.setItem('papol_viewer_rail', railOpen ? 'open' : 'closed');
  }, [railOpen]);

  useEffect(() => {
    localStorage.setItem('papol_viewer_tool', tool);
  }, [tool]);

  useEffect(() => {
    localStorage.setItem('papol_viewer_animal', animal);
  }, [animal]);

  useEffect(() => {
    localStorage.setItem('papol_viewer_animal_speed', String(animalSpeed));
    localStorage.setItem('papol_viewer_animal_activity', String(animalActivity));
    localStorage.setItem('papol_viewer_animal_follow', String(animalFollow));
  }, [animalSpeed, animalActivity, animalFollow]);

  useEffect(() => {
    localStorage.setItem('papol_viewer_ink', inkColor);
    localStorage.setItem('papol_viewer_ink_width', String(inkWidth));
    localStorage.setItem('papol_viewer_ink_opacity', String(inkOpacity));
    localStorage.setItem('papol_viewer_ink_shape', inkShape);
  }, [inkColor, inkWidth, inkOpacity, inkShape]);

  useEffect(() => {
    localStorage.setItem('papol_viewer_laser', laserColor);
  }, [laserColor]);

  // Putting a tool down closes the sheet that belonged to it.
  useEffect(() => {
    setSheet((open) => (open === tool ? open : null));
  }, [tool]);

  // So does looking away. On the way down rather than the way up, and in
  // the capture phase, so that the click which closes the sheet is also the
  // click that does whatever it was for — reaching past an open sheet to
  // draw should not cost a click.
  //
  // The brush's own button is left out of this: it toggles the sheet on
  // click, and closing here first would only let that reopen it.
  useEffect(() => {
    if (!sheet) return undefined;
    const away = (e) => {
      const el = e.target;
      if (el?.closest?.('.brush-pop') || el?.closest?.('.tool-slot')) return;
      setSheet(null);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [sheet]);

  // Through a ref that is refreshed every render, because the listener is
  // bound once and would otherwise go on reading the first render's `tool`
  // and `placeAt` for the life of the page — which looked like it worked,
  // since placing an anchor does not depend on either, and quietly did not.
  const onKeyRef = useRef(null);

  // Not while the reader is writing a note: in a textarea, x is an x.
  onKeyRef.current = (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key?.toLowerCase() === 'f') {
        e.preventDefault();
        setSearchOpen(true);
        window.requestAnimationFrame(() => searchInputRef.current?.select());
        return;
      }
      if (e.key === 'Escape' && learnLinkNavigation) {
        e.preventDefault();
        setLearnLinkNavigation(false);
        return;
      }
      if (e.key === 'Escape' && paperInfoOpen) {
        e.preventDefault();
        setPaperInfoOpen(false);
        return;
      }
      if (e.key === 'Escape' && sendSelection) {
        e.preventDefault();
        closeSendSelection();
        return;
      }
      if (e.key === 'Escape' && selectedClipId != null) {
        e.preventDefault();
        setSelectedClipId(null);
        return;
      }
      // Escape closes the help sheet first, before anything else looks at
      // the key: while it is up it is the thing in front of the reader.
      if (e.key === 'Escape' && helpOpen) {
        e.preventDefault();
        setHelpOpen(false);
        return;
      }
      if (e.key === 'Escape' && feedbackOpen) {
        e.preventDefault();
        setFeedbackOpen(false);
        setFeedbackContent('');
        setFeedbackError(null);
        setFeedbackSent(false);
        return;
      }
      if (e.key === 'Escape' && searchOpen) {
        e.preventDefault();
        setSearchOpen(false);
        setSearchQuery('');
        return;
      }
      if (e.key === 'Escape' && selectedInk) {
        e.preventDefault();
        setSelectedInk(null);
        return;
      }
      const el = e.target;
      if (
        el?.isContentEditable ||
        el?.tagName === 'INPUT' ||
        el?.tagName === 'TEXTAREA' ||
        el?.tagName === 'SELECT'
      ) {
        return;
      }
      const isUndoKey = e.code === 'KeyZ' || e.key?.toLowerCase() === 'z';
      if ((e.metaKey || e.ctrlKey) && !e.altKey && isUndoKey) {
        e.preventDefault();
        e.stopPropagation();
        runHistory(e.shiftKey ? 'redo' : 'undo');
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '[' || e.key === ']') {
        e.preventDefault();
        moveThroughLinks(e.key === '[' ? 'back' : 'forward');
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSheet(null);
        takeTool('arrow');
        return;
      }
      if (selectedClipId != null && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        removeClip(selectedClipId);
        return;
      }
      if (selectedInk && (
        e.key.toLowerCase() === 'd' ||
        e.key === 'Delete' ||
        e.key === 'Backspace'
      )) {
        const selected = inkRef.current.find((stroke) => (
          selectedInk.groupId
            ? stroke.group_id === selectedInk.groupId
            : stroke.id === selectedInk.id
        ));
        if (selected) {
          e.preventDefault();
          setSelectedInk(null);
          eraseStroke(selected.id);
        }
        return;
      }
      // a and A are looked up as typed — they are two tools, not one tool
      // and a modifier — and everything else by its lower case, so a
      // shifted X is still the brush.
      // Loading the brush, while the brush is what is in hand. Digits, so
      // nothing here is a letter another tool wanted.
      if (tool === 'brush') {
        const slot = Number(e.key);
        if (slot >= 1 && slot <= INK_COLORS.length) {
          e.preventDefault();
          setInkColor(INK_COLORS[slot - 1].hex);
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
    // Capture before pdf.js's selectable text layer or the browser consumes
    // editing shortcuts. onKeyRef still leaves actual form fields alone, so
    // typing a note keeps its native undo history.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  useEffect(() => {
    const clearInkSelection = (event) => {
      if (!event.target.closest?.('.ink-grab')) setSelectedInk(null);
      if (!event.target.closest?.('.paper-clip') && !event.target.closest?.('.clip-actions')) setSelectedClipId(null);
    };
    document.addEventListener('pointerdown', clearInkSelection, true);
    return () => document.removeEventListener('pointerdown', clearInkSelection, true);
  }, []);

  useEffect(() => {
    if (!paper?.edition_id || !source?.clips) return undefined;
    let cancelled = false;
    source.clips.list(paper.edition_id)
      .then((loaded) => { if (!cancelled) setClips(loaded); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [paper?.edition_id, source]);

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
  const openReference = (referenceId, anchor, inlineReference = null, referenceIds = null) => {
    const known = referencesById.get(referenceId) || inlineReference || null;
    const ids = referenceIds?.length ? referenceIds : [referenceId];
    setOpenCite({ referenceId, referenceIds: ids, index: Math.max(0, ids.indexOf(referenceId)), anchor });
    setReference(known);
    setReferenceError(null);
    // A PDF-native `cite.*` destination is recognizable before server-side
    // analysis has assigned it a database id. Read the printed bibliography
    // entry straight from the PDF so its card is useful without waiting for
    // that analysis or an external metadata service.
    if (typeof referenceId !== 'number') {
      if (doc && inlineReference?.dest) {
        readNamedReference(doc, inlineReference.dest)
          .then(async (raw) => {
            if (!raw) {
              setReference((current) => current?.id === referenceId
                ? { ...current, resolved_status: 'error' }
                : current);
              setReferenceError('Reference unreadable.');
              return;
            }
            setReference((current) => current?.id === referenceId
              ? { ...current, raw, resolved_status: 'resolving' }
              : current);
            if (!paper?.edition_id) return;
            const pdfHash = paper.edition_sha256 || paper.sha256;
            const full = await resolveViewerReference(pdfHash, {
              key: inlineReference.key,
              raw,
            });
            setReference((current) => current?.id === referenceId ? full : current);
          })
          .catch(() => {
            // The card is already open. An unusual PDF text layout should
            // not turn a citation click into an error or a bibliography jump.
            setReference((current) => current?.id === referenceId
              ? { ...current, resolved_status: current.raw ? 'pdf_text' : 'error' }
              : current);
          });
      }
      return;
    }
    // Show a cached answer immediately, but still ask the item endpoint.
    // The backend cheaply returns valid stored data and can invalidate a
    // match made under older consolidation rules. Trusting the bundle
    // forever made a corrected matcher unable to repair existing popups.
    getViewerReference(referenceId)
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
    // A link can be activated while text remains selected in the PDF. Once
    // the document jumps, that old highlight no longer describes the place
    // the reader is looking at and its paint action should not follow them.
    window.getSelection()?.removeAllRanges();
    setSelectionPaint(null);
    try {
      if (localStorage.getItem(LEARN_LINK_NAVIGATION_KEY) !== 'seen') {
        localStorage.setItem(LEARN_LINK_NAVIGATION_KEY, 'seen');
        setLearnLinkNavigation(true);
      }
    } catch {
      // Storage can be unavailable in a locked-down browser. The lesson is
      // still useful for this visit, even if it cannot be remembered.
      setLearnLinkNavigation(true);
    }
    const scroller = scrollerRef.current;
    const pageEl = scroller?.querySelector(`[data-page="${page}"]`);
    if (!scroller || !pageEl) return;
    const from = scroller.scrollTop;
    const viewBeforeJump = {
      top: from,
      left: scroller.scrollLeft,
      scale,
    };
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
    if (Math.abs(top - from) > box.height * 0.25) {
      linkHistory.current.back.push(viewBeforeJump);
      linkHistory.current.forward = [];
      renderLinkHistory((version) => version + 1);
    }
  };

  const currentView = () => {
    const scroller = scrollerRef.current;
    return scroller
      ? { top: scroller.scrollTop, left: scroller.scrollLeft, scale }
      : null;
  };

  const restoreView = (view) => {
    const scroller = scrollerRef.current;
    if (!scroller || !view) return;
    if (view.scale !== scale) {
      restoringView.current = view;
      setScale(view.scale);
    } else {
      scroller.scrollTo({
        top: view.top,
        left: view.left,
        behavior: 'auto',
      });
    }
  };

  const moveThroughLinks = (direction) => {
    const history = linkHistory.current;
    const from = direction === 'back' ? history.back : history.forward;
    const to = direction === 'back' ? history.forward : history.back;
    if (from.length === 0) return;
    const here = currentView();
    const destination = from.pop();
    if (here) to.push(here);
    renderLinkHistory((version) => version + 1);
    restoreView(destination);
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

  // Open at the width of the viewer, and stay fitted through actual window
  // resizes until the reader picks a zoom. Opening the rail is not a window
  // resize and must not silently change the document's zoom.
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

    window.addEventListener('resize', fit);
    return () => {
      gone = true;
      window.removeEventListener('resize', fit);
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

  const clipsByPage = useMemo(() => {
    const map = new Map();
    for (const clip of clips) {
      if (!map.has(clip.page)) map.set(clip.page, []);
      map.get(clip.page).push(clip);
    }
    return map;
  }, [clips]);

  const selectedInkPages = useMemo(() => {
    if (!selectedInk) return new Set();
    return new Set(ink.filter((stroke) => (
      selectedInk.groupId
        ? stroke.group_id === selectedInk.groupId
        : stroke.id === selectedInk.id
    )).map((stroke) => stroke.page));
  }, [ink, selectedInk]);

  // A stroke appears the instant the pointer lifts and is saved behind it.
  // Waiting for the server first would make the brush feel like it was
  // dragging something heavy; if the save fails the stroke is taken back,
  // which is the honest thing to do with a mark that was not kept.
  const drawStroke = async (stroke, record = true) => {
    if (!source?.ink) return;
    const provisional = `wet-${++tempInkId.current}`;
    setInk((all) => [...all, { ...stroke, id: provisional }]);
    const saving = source.ink.create(paper?.edition_id, stroke);
    inkSaving.current.set(provisional, saving);
    try {
      const saved = await saving;
      setInk((all) => all.map((s) => (s.id === provisional ? saved : s)));
      if (record && saved) {
        const entry = { id: saved.id, stroke };
        remember({
          undo: async () => eraseStroke(entry.id, false),
          redo: async () => {
            const restored = await drawStroke(entry.stroke, false);
            entry.id = restored.id;
          },
        });
      }
      return saved;
    } catch (err) {
      setInk((all) => all.filter((s) => s.id !== provisional));
      setError(err.message || 'Stroke not saved.');
    } finally {
      inkSaving.current.delete(provisional);
    }
    return null;
  };

  // A browser selection is a collection of visual line fragments, sometimes
  // spanning columns or pages. Keep that geometry while the selection exists
  // and offer one small action beside its final fragment.
  useEffect(() => {
    let pointerSelecting = false;
    let finishFrame = null;
    const update = () => {
      const selection = window.getSelection();
      const scroller = scrollerRef.current;
      if (!selection || selection.isCollapsed || !selection.rangeCount || !scroller) {
        setSelectionPaint(null);
        return;
      }
      const elementFor = (node) =>
        node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      const anchor = elementFor(selection.anchorNode);
      const focusNode = elementFor(selection.focusNode);
      if (!anchor?.closest('.textLayer') || !focusNode?.closest('.textLayer')) {
        setSelectionPaint(null);
        return;
      }
      const rects = [...selection.getRangeAt(0).getClientRects()];
      const usable = rects.filter((rect) => rect.width > 0.5 && rect.height > 1);
      if (!usable.length) {
        setSelectionPaint(null);
        return;
      }
      const pageBoxes = [...scroller.querySelectorAll('.pdf-page')].map((page) => ({
        page: Number(page.dataset.page),
        box: page.getBoundingClientRect(),
      }));
      const strokes = selectionStrokes(usable, pageBoxes);
      if (!strokes.length) {
        setSelectionPaint(null);
        return;
      }
      const last = usable[usable.length - 1];
      const above = last.top - 38;
      const scrollerBox = scroller.getBoundingClientRect();
      const viewportLeft = Math.max(22, Math.min(window.innerWidth - 22, last.right));
      const viewportTop = above >= 8 ? above : Math.min(window.innerHeight - 44, last.bottom + 8);
      setSelectionPaint({
        strokes,
        text: selectedTextWithoutPdfCitations(selection, scroller).trim(),
        left: viewportLeft - scrollerBox.left + scroller.scrollLeft,
        top: viewportTop - scrollerBox.top + scroller.scrollTop,
      });
    };
    const selectionChanged = () => {
      if (!pointerSelecting) update();
    };
    const pointerDown = (event) => {
      if (!event.target.closest?.('.textLayer')) return;
      pointerSelecting = true;
      setSelectionPaint(null);
    };
    const pointerFinished = () => {
      if (!pointerSelecting) return;
      pointerSelecting = false;
      // The browser finalizes its Range as the pointerup dispatch completes.
      finishFrame = requestAnimationFrame(update);
    };
    update();
    document.addEventListener('selectionchange', selectionChanged);
    document.addEventListener('pointerdown', pointerDown);
    document.addEventListener('pointerup', pointerFinished);
    document.addEventListener('pointercancel', pointerFinished);
    window.addEventListener('resize', update);
    return () => {
      if (finishFrame != null) cancelAnimationFrame(finishFrame);
      document.removeEventListener('selectionchange', selectionChanged);
      document.removeEventListener('pointerdown', pointerDown);
      document.removeEventListener('pointerup', pointerFinished);
      document.removeEventListener('pointercancel', pointerFinished);
      window.removeEventListener('resize', update);
    };
  }, [doc, scale, paper?.edition_id, source]);

  const paintSelection = async () => {
    if (!selectionPaint) return;
    const groupId = crypto.randomUUID();
    const specs = selectionPaint.strokes.map((fragment) => ({
        ...fragment,
        group_id: groupId,
        color: inkColor,
        opacity: inkOpacity,
        shape: 'flat',
      }));
    window.getSelection()?.removeAllRanges();
    setSelectionPaint(null);
    const results = await Promise.all(specs.map((stroke) => drawStroke(stroke, false)));
    const entries = results
      .map((stroke, index) => stroke && ({ id: stroke.id, stroke: specs[index] }))
      .filter(Boolean);
    if (!entries.length) return;
    remember({
      undo: async () => Promise.all(entries.map((entry) => eraseStroke(entry.id, false))),
      redo: async () => {
        const restored = await Promise.all(
          entries.map((entry) => drawStroke(entry.stroke, false))
        );
        restored.forEach((stroke, index) => { entries[index].id = stroke.id; });
      },
    });
  };

  const closeSendSelection = () => {
    setSendSelection(null);
    setSendBoards([]);
    setSendBoardGuid('');
    setSendError(null);
    setSendComplete(false);
  };

  const openSendSelection = async () => {
    if (!selectionPaint?.text) return;
    const first = selectionPaint.strokes[0];
    setSendSelection({
      text: cleanExcerptText(selectionPaint.text),
      comment: '',
      page: first.page,
      y: first.points[0]?.y ?? 0.5,
      strokes: selectionPaint.strokes,
    });
    setSendError(null);
    setSendComplete(false);
    window.getSelection()?.removeAllRanges();
    setSelectionPaint(null);
    try {
      const boards = await listBoards();
      setSendBoards(boards);
      setSendBoardGuid(boards[0]?.guid || '');
    } catch (e) {
      setSendError(e.status === 401 ? 'Sign in to send excerpts to a board.' : e.message);
    }
  };

  const sendSelectionToBoard = async () => {
    if (!sendSelection || !sendBoardGuid || (sendSelection.kind !== 'clip' && !sendSelection.text.trim())) return;
    setSendBusy(true);
    setSendError(null);
    const backlink = new URL(window.location.href);
    backlink.searchParams.delete('note');
    backlink.searchParams.set('page', String(sendSelection.page));
    backlink.searchParams.set('y', String(sendSelection.y));
    if (sendSelection.kind === 'clip') {
      const box = sendSelection.box;
      backlink.searchParams.delete('mark');
      backlink.searchParams.set('box', btoa(JSON.stringify([
        sendSelection.page, box.x, box.y, box.w, box.h,
      ].map((value) => Number(value.toFixed(5))))));
    } else {
      const compactSelection = sendSelection.strokes.map((stroke) => [
        stroke.page,
        Number(stroke.points[0].x.toFixed(5)),
        Number(stroke.points[1].x.toFixed(5)),
        Number(stroke.points[0].y.toFixed(5)),
        Number(stroke.width.toFixed(5)),
      ]);
      backlink.searchParams.set('mark', btoa(JSON.stringify(compactSelection)));
    }
    try {
      const sourceLabel = sendSelection.kind === 'clip'
        ? 'Open source'
        : `${paper?.title || 'Paper'}, page ${sendSelection.page}`;
      if (sendSelection.kind === 'clip') {
        await stageBoardClip(sendBoardGuid, {
          blob: sendSelection.blob,
          comment: sendSelection.comment.trim(),
          sourceUrl: backlink.href,
          sourceLabel,
        });
      } else {
        await stageBoardExcerpt(sendBoardGuid, {
          excerpt_text: sendSelection.text.trim(),
          content: sendSelection.comment.trim() || null,
          source_url: backlink.href,
          source_label: sourceLabel,
        });
      }
      setSendComplete(true);
    } catch (e) {
      setSendError(e.message);
    } finally {
      setSendBusy(false);
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
  const moveStroke = async (id, points, record = true) => {
    if (!source?.ink?.move) return;
    const was = inkRef.current.find((s) => s.id === id);
    if (!was) return;
    const members = was.group_id
      ? inkRef.current.filter((s) => s.group_id === was.group_id)
      : [was];
    const dx = points[0].x - was.points[0].x;
    const dy = points[0].y - was.points[0].y;
    const clamp = (value) => Math.min(1, Math.max(0, value));
    const moves = members.map((stroke) => ({
      id: stroke.id,
      before: stroke.points,
      after: stroke.id === id
        ? points
        : stroke.points.map((point) => ({
            x: clamp(point.x + dx),
            y: clamp(point.y + dy),
          })),
    }));
    const movedById = new Map(moves.map((move) => [move.id, move.after]));
    setInk((all) => all.map((stroke) => (
      movedById.has(stroke.id)
        ? { ...stroke, points: movedById.get(stroke.id) }
        : stroke
    )));
    try {
      const saved = await Promise.all(moves.map(async (move) => {
        const real = await settledInkId(move.id);
        return real == null ? null : source.ink.move(real, move.after);
      }));
      const savedById = new Map(
        saved.map((stroke, index) => stroke && [moves[index].id, stroke]).filter(Boolean)
      );
      setInk((all) => all.map((stroke) => savedById.get(stroke.id) || stroke));
      if (record && saved.some(Boolean)) {
        const first = moves[0];
        remember({
          undo: () => moveStroke(first.id, first.before, false),
          redo: () => moveStroke(first.id, first.after, false),
        });
      }
      return saved.find((stroke) => stroke?.id === id) || saved.find(Boolean);
    } catch (err) {
      const beforeById = new Map(moves.map((move) => [move.id, move.before]));
      setInk((all) => all.map((stroke) => (
        beforeById.has(stroke.id)
          ? { ...stroke, points: beforeById.get(stroke.id) }
          : stroke
      )));
      setError(err.message || 'Stroke not moved.');
    }
  };

  const eraseStroke = async (id, record = true) => {
    if (!source?.ink) return;
    // The eraser asks on every movement of the pointer, several times in a
    // frame, and `ink` is whatever it was when this render began — so the
    // same stroke was asked for twice, the first delete succeeded, the
    // second came back "no such stroke", and the error path put the stroke
    // back. It looked exactly like ink that could not be rubbed out. A ref
    // is the only thing here that is current within a frame.
    // Only while this one is in the air. The eraser asks on every movement
    // of the pointer, several times in a frame, and `ink` is whatever it
    // was when the render began — so without this the same stroke is asked
    // for twice, the first delete succeeds, the second comes back "no such
    // stroke", and the error path puts the stroke back.
    //
    // It has to be let go of afterwards, and for a while it was not: ids
    // stayed in here for the life of the page. SQLite hands out the id of
    // the last row again when that row has been deleted, so the next stroke
    // drawn after erasing one is very often given the same number — and
    // arrived already on the list of things not to erase. It could not be
    // rubbed out at all until the page was reloaded, which emptied the set.
    // That is the bug this looked like from the outside, and an id is the
    // server's business anyway: nothing here should assume one is never
    // used twice.
    if (erasing.current.has(id)) return;
    // Whatever the eraser was over, it was over: the page is rendering it,
    // which is a better witness than this render's copy of the list.
    const target = inkRef.current.find((s) => s.id === id);
    const gone = target?.group_id
      ? inkRef.current.filter((s) => s.group_id === target.group_id)
      : target ? [target] : [];
    if (!gone.length) return;
    const goneIds = new Set(gone.map((stroke) => stroke.id));
    gone.forEach((stroke) => erasing.current.add(stroke.id));
    setInk((all) => all.filter((s) => !goneIds.has(s.id)));
    try {
      const realIds = await Promise.all(gone.map((stroke) => settledInkId(stroke.id)));
      await Promise.all(realIds.filter((real) => real != null).map((real) => source.ink.remove(real)));
      if (record) {
        const entries = gone.map((stroke, index) => ({
          id: realIds[index],
          stroke: (({ id: _id, ...spec }) => spec)(stroke),
        }));
        remember({
          undo: async () => {
            const restored = await Promise.all(
              entries.map((entry) => drawStroke(entry.stroke, false))
            );
            restored.forEach((stroke, index) => { entries[index].id = stroke.id; });
          },
          redo: () => eraseStroke(entries[0].id, false),
        });
      }
    } catch (err) {
      // A stroke the server does not have is a stroke that is gone, which
      // is what was wanted; anything else is a failure worth undoing.
      if (err.status === 404) return;
      setInk((all) => [...all, ...gone]);
      setError(err.message || 'Stroke not erased.');
    } finally {
      gone.forEach((stroke) => erasing.current.delete(stroke.id));
    }
  };

  const animalsByPage = useMemo(() => {
    const map = new Map();
    for (const animalRecord of placedAnimals) {
      if (!map.has(animalRecord.page)) map.set(animalRecord.page, []);
      map.get(animalRecord.page).push(animalRecord);
    }
    return map;
  }, [placedAnimals]);

  // React owns arrivals and departures; PdfPage mutates motion between them.
  const dropAnimal = (page, at, kind = animal, record = true) => {
    const placed = createPlacedAnimal({
      id: `animal-${(nextAnimalId.current += 1)}`,
      kind,
      page,
      x: at.x,
      y: at.y,
      activityScale: animalActivity,
    });
    setPlacedAnimals((herd) => [...herd, placed]);
    if (record) {
      const entry = { animal: placed };
      remember({
        undo: () => eraseAnimal(entry.animal.id, false),
        redo: () => {
          entry.animal = dropAnimal(
            entry.animal.page,
            { x: entry.animal.x, y: entry.animal.y },
            entry.animal.kind,
            false,
          );
        },
      });
    }
    return placed;
  };

  // Scatter a little menagerie through what the reader can see right now.
  // Screen points are converted back into coordinates belonging to the
  // nearest sheet, so animals may also land naturally in a visible gutter.
  const waveAnimalWand = () => {
    const placements = randomViewportPlacements(
      scrollerRef.current,
      ANIMALS.map(({ id }) => id),
      10
    );
    const now = performance.now();
    const arrivals = placements.map((placement) => createPlacedAnimal({
      ...placement,
      id: `animal-${(nextAnimalId.current += 1)}`,
      activityScale: animalActivity,
      now,
    }));
    if (arrivals.length) {
      setPlacedAnimals((herd) => [...herd, ...arrivals]);
      const entry = { animals: arrivals };
      remember({
        undo: () => {
          const ids = new Set(entry.animals.map((placed) => placed.id));
          setPlacedAnimals((herd) => herd.filter((placed) => !ids.has(placed.id)));
        },
        redo: () => {
          entry.animals = entry.animals.map((placed) => createPlacedAnimal({
            ...placed,
            id: `animal-${(nextAnimalId.current += 1)}`,
          }));
          setPlacedAnimals((herd) => [...herd, ...entry.animals]);
        },
      });
    }
  };

  const moveAnimal = (id, at, record = true) => {
    const animalRecord = animalsRef.current.find((candidate) => candidate.id === id);
    if (!animalRecord) return;
    const before = { x: animalRecord.x, y: animalRecord.y, page: animalRecord.page };
    Object.assign(animalRecord, at);
    setPlacedAnimals((herd) => [...herd]);
    if (record) remember({
      undo: () => moveAnimal(id, before, false),
      redo: () => moveAnimal(id, at, false),
    });
  };

  const eraseAnimal = (id, record = true) => {
    const gone = animalsRef.current.find((placed) => placed.id === id);
    setPlacedAnimals((herd) => herd.filter((placed) => placed.id !== id));
    if (record && gone) {
      const entry = { animal: gone };
      remember({
        undo: () => setPlacedAnimals((herd) => [...herd, entry.animal]),
        redo: () => eraseAnimal(entry.animal.id, false),
      });
    }
  };

  useEffect(() => {
    if (!animalFollow) {
      for (const cow of placedAnimals) {
        cow.followTarget = null;
        cow.followPage = false;
        cow.viewportFollowing = false;
        cow.viewportOutsideAt = 0;
      }
      return undefined;
    }
    const guide = () => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      const box = scroller.getBoundingClientRect();
      let crossed = false;
      for (const cow of placedAnimals) {
        let cowCrossed = false;
        cow.followPage = true;
        let currentEl = scroller.querySelector(`[data-page="${cow.page}"]`);
        if (!currentEl) continue;
        let currentRect = currentEl.getBoundingClientRect();

        // Coordinate ownership changes only after the animal itself walks
        // through the physical midpoint of a gutter. It is unrelated to
        // which page happens to cross the browser's centre line.
        const nextEl = scroller.querySelector(`[data-page="${cow.page + 1}"]`);
        if (nextEl) {
          const nextRect = nextEl.getBoundingClientRect();
          const halfGap = Math.max(0, nextRect.top - currentRect.bottom) / 2;
          const edge = -halfGap / currentRect.height;
          if (cow.y <= edge && cow.vy < -1e-7) {
            cow.page += 1;
            cow.y = 1 + halfGap / nextRect.height;
            currentEl = nextEl;
            currentRect = nextRect;
            crossed = true;
            cowCrossed = true;
          }
        }
        const previousEl = scroller.querySelector(`[data-page="${cow.page - 1}"]`);
        if (!cowCrossed && previousEl) {
          const previousRect = previousEl.getBoundingClientRect();
          const halfGap = Math.max(0, currentRect.top - previousRect.bottom) / 2;
          const edge = 1 + halfGap / currentRect.height;
          if (cow.y >= edge && cow.vy > 1e-7) {
            cow.page -= 1;
            cow.y = -halfGap / previousRect.height;
            currentEl = previousEl;
            currentRect = previousRect;
            crossed = true;
            cowCrossed = true;
          }
        }

        // Focus is a continuous rectangle in browser coordinates. If the
        // animal is already comfortably visible it stays where it is. If
        // not, steer to the nearest point inside that rectangle, expressed
        // in the current page's coordinates—even when that point lies
        // beyond the page and across one or more gray gutters.
        const outerLeft = box.left + box.width * 0.10;
        const outerRight = box.right - box.width * 0.10;
        const outerTop = box.top + box.height * 0.10;
        const outerBottom = box.bottom - box.height * 0.10;
        const settleLeft = box.left + box.width * 0.13;
        const settleRight = box.right - box.width * 0.13;
        const settleTop = box.top + box.height * 0.13;
        const settleBottom = box.bottom - box.height * 0.13;
        const screenX = currentRect.left + cow.x * currentRect.width;
        const screenY = currentRect.top + (1 - cow.y) * currentRect.height;
        const outside = screenX < outerLeft || screenX > outerRight
          || screenY < outerTop || screenY > outerBottom;
        const settleSlop = 6;
        const settled = screenX >= settleLeft - settleSlop && screenX <= settleRight + settleSlop
          && screenY >= settleTop - settleSlop && screenY <= settleBottom + settleSlop;
        if (cow.viewportFollowing && settled) {
          cow.viewportFollowing = false;
          cow.viewportOutsideAt = 0;
        } else if (!cow.viewportFollowing && outside) {
          if (!cow.viewportOutsideAt) cow.viewportOutsideAt = performance.now();
          // Different animals notice that they have fallen behind at
          // different times. This grace period prevents a scroll from
          // producing an immediate, conspicuous synchronized response.
          const grace = 650 + (cow.seed || 0.5) * 950;
          if (performance.now() - cow.viewportOutsideAt >= grace) cow.viewportFollowing = true;
        } else if (!outside) {
          cow.viewportOutsideAt = 0;
        }
        if (cow.viewportFollowing) {
          const targetX = Math.max(settleLeft, Math.min(settleRight, screenX));
          const targetY = Math.max(settleTop, Math.min(settleBottom, screenY));
          cow.followTarget = {
            x: (targetX - currentRect.left) / currentRect.width,
            y: 1 - (targetY - currentRect.top) / currentRect.height,
          };
          cow.followPrecision = Math.max(0.003, 4 / currentRect.width);
        } else {
          cow.followTarget = null;
          cow.followPrecision = null;
        }

        if (cow.act && cow.followTarget && !cow.act.walks) cow.until = 0;
      }
      if (crossed) setPlacedAnimals((herd) => [...herd]);
    };
    guide();
    const timer = window.setInterval(guide, 50);
    return () => window.clearInterval(timer);
  }, [animalFollow, placedAnimals]);

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
  const pendingZoom = useRef({ factor: 1, at: null, frame: null });

  const captureFocus = (at) => {
    const el = scrollerRef.current;
    if (!el) return null;
    const box = el.getBoundingClientRect();
    const cx = at ? at.x : box.left + box.width / 2;
    const cy = at ? at.y : box.top + box.height / 2;

    // Usually the pointer is directly over a page, which the browser can
    // answer without us measuring document layout at all. In an inter-page
    // gap, binary-search the vertically ordered sheets. The old linear scan
    // forced a rectangle read for every page on every trackpad event.
    const hit = document.elementFromPoint(cx, cy)?.closest?.('.pdf-page');
    let pageEl = hit && el.contains(hit) ? hit : null;
    if (!pageEl) {
      const pages = el.querySelectorAll('.pdf-page');
      const boxes = new Map();
      const boxFor = (index) => {
        if (!boxes.has(index)) boxes.set(index, pages[index].getBoundingClientRect());
        return boxes.get(index);
      };
      let low = 0;
      let high = pages.length - 1;
      while (low <= high) {
        const middle = (low + high) >> 1;
        const r = boxFor(middle);
        if (cy < r.top) high = middle - 1;
        else if (cy > r.bottom) low = middle + 1;
        else {
          pageEl = pages[middle];
          break;
        }
      }
      if (!pageEl && pages.length) {
        const candidates = [low - 1, low].filter((index) => index >= 0 && index < pages.length);
        pageEl = candidates.reduce((nearest, index) => {
          const r = boxFor(index);
          const gap = cy < r.top ? r.top - cy : Math.max(0, cy - r.bottom);
          return !nearest || gap < nearest.gap ? { el: pages[index], gap } : nearest;
        }, null)?.el;
      }
    }
    if (!pageEl) return null;

    const r = pageEl.getBoundingClientRect();
    return {
      page: pageEl.dataset.page,
      fx: (cx - r.left) / r.width,
      fy: (cy - r.top) / r.height,
      cx,
      cy,
    };
  };

  const zoomBy = (factor, at) => {
    const el = scrollerRef.current;
    if (!el) return;
    chosenZoom.current = true;
    const pending = pendingZoom.current;
    pending.factor *= factor;
    pending.at = at;
    if (pending.frame != null) return;
    // Browsers can deliver several wheel events inside one display frame.
    // Accumulate them and commit one layout/React update for that frame.
    pending.frame = requestAnimationFrame(() => {
      pending.frame = null;
      const combinedFactor = pending.factor;
      const latestAt = pending.at;
      pending.factor = 1;
      pending.at = null;
      const captured = captureFocus(latestAt);
      if (!captured) return;
      setScale((prev) => {
        const next = clampScale(prev * combinedFactor);
        if (next === prev) return prev;
        focus.current = captured;
        return next;
      });
    });
  };

  // A transient zoom changes only page geometry. Apply those three style
  // values directly before paint so React does not have to reconcile every
  // stroke, pin, clip and link on every visible sheet for a scale-only
  // update. PdfPage's memo comparator deliberately mirrors this boundary.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el || scale == null) return;
    el.dataset.scale = String(scale);
    for (const pageEl of el.querySelectorAll('.pdf-page')) {
      const width = Number(pageEl.dataset.pageWidth);
      const height = Number(pageEl.dataset.pageHeight);
      const drawnAt = Number(pageEl.dataset.renderScale);
      if (!width || !height || !drawnAt) continue;
      pageEl.style.width = `${width * scale}px`;
      pageEl.style.height = `${height * scale}px`;
      const inner = pageEl.querySelector(':scope > .page-inner');
      if (inner) inner.style.transform = scale === drawnAt ? '' : `scale(${scale / drawnAt})`;
    }
  }, [scale]);

  useLayoutEffect(() => {
    const restore = restoringView.current;
    const f = focus.current;
    const el = scrollerRef.current;
    restoringView.current = null;
    focus.current = null;
    if (restore && el) {
      el.scrollTo({ top: restore.top, left: restore.left, behavior: 'auto' });
      return;
    }
    if (!f || !el) return;
    const pageEl = el.querySelector(`[data-page="${f.page}"]`);
    if (!pageEl) return;
    const r = pageEl.getBoundingClientRect();
    el.scrollLeft += r.left + f.fx * r.width - f.cx;
    el.scrollTop += r.top + f.fy * r.height - f.cy;
  }, [scale, railOpen]);

  // While a wheel or pinch gesture is moving, PdfPage stretches the current
  // bitmap with a compositor transform so zoom stays under the pointer. Once
  // input pauses, redraw visible pages at the chosen scale for sharp text.
  useEffect(() => {
    if (scale == null || renderScale === scale) return undefined;
    const timer = window.setTimeout(() => setRenderScale(scale), 160);
    return () => window.clearTimeout(timer);
  }, [scale, renderScale]);

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
      if (pendingZoom.current.frame != null) {
        cancelAnimationFrame(pendingZoom.current.frame);
        pendingZoom.current.frame = null;
        pendingZoom.current.factor = 1;
        pendingZoom.current.at = null;
      }
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
    // Counted, not clocked. This was -Date.now(), so two anchors dropped in
    // the same millisecond took the same temporary id: two notes with one
    // key, and a `pending` entry for the second standing in for the first,
    // whose real id could then never be found — leaving an anchor that
    // could not be moved, renamed or deleted until the page was reloaded.
    // Negative still, so it can never be mistaken for one of the server's.
    const tempId = -(tempNoteId.current += 1);
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
        const entry = { id: saved.id, snapshot: saved };
        remember({
          undo: () => removeNote(entry.id, false),
          redo: async () => {
            const restored = await restoreNote(entry.snapshot);
            entry.id = restored.id;
          },
        });
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

  // Picking up an anchor remembers what was put down for it, so that
  // dropping one in the middle of marking a paper up does not cost the
  // brush that was in hand.
  const takeTool = (picked) => {
    // Reaching for what is already in your hand opens what belongs to it,
    // whether you reached with the pointer or with the key.
    if (picked === tool && SHEETS.has(picked)) {
      setSheet((open) => (open === picked ? null : picked));
      return;
    }
    if (DROP_TOOLS.has(picked) && !DROP_TOOLS.has(tool)) toolBefore.current = tool;
    if (!DROP_TOOLS.has(picked)) toolBefore.current = null;
    setTool(picked);
  };

  // The drop itself: the anchor lands where it was clicked, and the hand
  // goes back to whatever it was holding.
  const dropAnchor = (spot) => {
    handlePlace(spot);
    setTool(toolBefore.current || 'arrow');
    toolBefore.current = null;
  };

  const createClip = async (clip) => {
    const provisional = `clip-${Date.now()}`;
    setClips((all) => [...all, { ...clip, id: provisional }]);
    // A clipper is a one-shot form of the reading cursor. Put it down as
    // soon as the rectangle lands; persistence must not keep it in hand.
    setTool('arrow');
    toolBefore.current = null;
    try {
      const saving = source.clips.create(paper.edition_id, clip);
      clipSaving.current.set(provisional, saving);
      const saved = await saving;
      setClips((all) => all.map((candidate) => (
        candidate.id === provisional ? { ...saved, frame: candidate.frame } : candidate
      )));
      setSelectedClipId((selected) => (selected === provisional ? saved.id : selected));
    } catch (e) {
      setClips((all) => all.filter((candidate) => candidate.id !== provisional));
      setError(e.message);
    } finally {
      clipSaving.current.delete(provisional);
    }
  };

  const settledClipId = async (id) => {
    const saving = clipSaving.current.get(id);
    return saving ? (await saving).id : id;
  };

  const updateClip = (id, change) => {
    setClips((all) => all.map((clip) => (clip.id === id ? { ...clip, ...change } : clip)));
  };

  const commitClip = async (id, change) => {
    try {
      const realId = await settledClipId(id);
      const current = clips.find((clip) => clip.id === id || clip.id === realId);
      const frame = change.frame || current?.frame;
      const floating = change.floating ?? current?.floating ?? false;
      const saved = await source.clips.move(realId, frame, floating);
      setClips((all) => all.map((clip) => (
        clip.id === id || clip.id === realId ? saved : clip
      )));
    } catch (e) {
      setError(e.message);
    }
  };

  const removeClip = async (id) => {
    setSelectedClipId((selected) => (selected === id ? null : selected));
    setClips((all) => all.filter((clip) => clip.id !== id));
    try {
      await source.clips.remove(await settledClipId(id));
    } catch (e) {
      setError(e.message);
    }
  };

  const openSendClip = async (clip, blob) => {
    setSendSelection({
      kind: 'clip',
      text: '',
      comment: '',
      page: clip.page,
      y: 1 - clip.source.y - clip.source.h / 2,
      strokes: [],
      box: clip.source,
      blob,
    });
    setSendError(null);
    setSendComplete(false);
    try {
      const boards = await listBoards();
      setSendBoards(boards);
      setSendBoardGuid(boards[0]?.guid || '');
    } catch (e) {
      setSendError(e.status === 401 ? 'Sign in to send excerpts to a board.' : e.message);
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
  const moveNote = async (id, spot, record = true) => {
    const was = notesRef.current.find((note) => note.id === id);
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, ...spot } : n)));
    try {
      const real = await settledId(id);
      if (real == null) return;
      const saved = await source.notes.move(real, spot);
      if (saved) setNotes((prev) => prev.map((n) => (n.id === real ? saved : n)));
      if (record && was && saved) {
        remember({
          undo: () => moveNote(saved.id, { page: was.page, anchor: was.anchor }, false),
          redo: () => moveNote(saved.id, spot, false),
        });
      }
    } catch (e) {
      setError(e.message);
    }
  };

  // An anchor's label is its name, and the page number stands in until it
  // has one. Clicking the label renames it.
  const saveName = async (note, record = true) => {
    const name = nameDraft.trim();
    setNaming(null);
    if (name === (note.name || '')) return;
    setNotes((prev) => prev.map((n) => (n.id === note.id ? { ...n, name } : n)));
    try {
      const real = await settledId(note.id);
      if (real == null) return;
      const saved = await source.notes.rename(real, name);
      if (saved) setNotes((prev) => prev.map((n) => (n.id === real ? saved : n)));
      if (record && saved) {
        remember({
          undo: () => renameNote(saved.id, note.name || '', false),
          redo: () => renameNote(saved.id, name, false),
        });
      }
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
    if (id == null) {
      setActiveNoteId(null);
      setFlashId(null);
      clearTimeout(flashTimer.current);
      return;
    }
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

  const updateNoteContent = async (id, content) => {
    const real = await settledId(id);
    if (real == null) return null;
    const updated = await source.notes.update(real, content);
    setNotes((prev) => prev.map((note) => (note.id === real ? updated : note)));
    return updated;
  };

  const renameNote = async (id, name, record = false) => {
    const note = notesRef.current.find((candidate) => candidate.id === id);
    const real = await settledId(id);
    if (real == null) return null;
    const saved = await source.notes.rename(real, name);
    if (saved) setNotes((prev) => prev.map((n) => (n.id === real ? saved : n)));
    if (record && note && saved) {
      remember({
        undo: () => renameNote(saved.id, note.name || '', false),
        redo: () => renameNote(saved.id, name, false),
      });
    }
    return saved;
  };

  const saveEdit = async (id, record = true) => {
    if (!editText.trim()) return;
    const before = notesRef.current.find((note) => note.id === id)?.content || '';
    const content = editText.trim();
    try {
      const updated = await updateNoteContent(id, content);
      setEditing(null);
      if (record && updated) {
        remember({
          undo: () => updateNoteContent(updated.id, before),
          redo: () => updateNoteContent(updated.id, content),
        });
      }
    } catch (e) {
      setError(e.message);
    }
  };

  const restoreNote = async (snapshot) => {
    let restored = await source.notes.create({
      page: snapshot.page,
      anchor: snapshot.anchor,
      content: snapshot.content || '',
    });
    if (snapshot.name) restored = await source.notes.rename(restored.id, snapshot.name);
    setNotes((prev) => [...prev, restored]);
    return restored;
  };

  const removeNote = async (id, record = true) => {
    const gone = notesRef.current.find((note) => note.id === id);
    setNotes((prev) => prev.filter((n) => n.id !== id));
    // Let go of it everywhere. SQLite hands out a deleted row's id again,
    // so a number kept here after the note it named has gone will one day
    // name a different note — and open its card, or light its row, for no
    // reason anyone could see.
    setActiveNoteId((open) => (open === id ? null : open));
    setFlashId((lit) => (lit === id ? null : lit));
    setDraggingNoteId((carried) => (carried === id ? null : carried));
    try {
      const real = await settledId(id);
      if (real != null) await source.notes.remove(real);
      if (record && gone) {
        const entry = { id: real, snapshot: gone };
        remember({
          undo: async () => {
            const restored = await restoreNote(entry.snapshot);
            entry.id = restored.id;
          },
          redo: () => removeNote(entry.id, false),
        });
      }
    } catch (e) {
      setError(e.message);
    }
  };

  // Reading position is implicit: remember the point at the centre of the
  // viewport, in page coordinates, together with its zoom. Page coordinates
  // survive a different window size; raw scroll offsets do not.
  useLayoutEffect(() => {
    if (readingViewRestored.current || wantedNoteId || wantedPage || !doc || !scale) return;
    const saved = readingView.current.view;
    if (!saved) {
      readingViewRestored.current = true;
      return;
    }
    if (saved.page > doc.numPages) {
      readingViewRestored.current = true;
      return;
    }
    const savedScale = clampScale(saved.scale);
    if (savedScale !== scale) {
      chosenZoom.current = true;
      setScale(savedScale);
      return;
    }
    let frame = null;
    let cancelled = false;
    const restoreWhenLaidOut = () => {
      if (cancelled || readingViewRestored.current) return;
      const scroller = scrollerRef.current;
      const pageEl = scroller?.querySelector(`[data-page="${saved.page}"]`);
      const page = pageEl?.getBoundingClientRect();
      if (!scroller || !page || page.height < 10) {
        frame = requestAnimationFrame(restoreWhenLaidOut);
        return;
      }
      const box = scroller.getBoundingClientRect();
      scroller.scrollLeft += page.left + saved.x * page.width - (box.left + box.width / 2);
      scroller.scrollTop += page.top + saved.y * page.height - (box.top + box.height / 2);
      readingViewRestored.current = true;
    };
    restoreWhenLaidOut();
    return () => {
      cancelled = true;
      if (frame != null) cancelAnimationFrame(frame);
    };
  }, [doc, scale, wantedNoteId, wantedPage]);

  // Excerpts sent to a board link back to the selected line, without
  // needing to create a permanent anchor merely to preserve provenance.
  useEffect(() => {
    const pageNumber = Number(wantedPage);
    if (!pageNumber || !doc || !scale || pageNumber > doc.numPages) return undefined;
    let frame = null;
    let cancelled = false;
    const reveal = () => {
      const scroller = scrollerRef.current;
      const pageEl = scroller?.querySelector(`[data-page="${pageNumber}"]`);
      const pageBox = pageEl?.getBoundingClientRect();
      if (!scroller || !pageBox || pageBox.height < 10) {
        if (!cancelled) frame = requestAnimationFrame(reveal);
        return;
      }
      const box = scroller.getBoundingClientRect();
      const y = wantedY ?? 0.5;
      const target = scroller.scrollTop + pageBox.top + (1 - y) * pageBox.height
        - box.top - box.height / 2;
      scroller.scrollTo({ top: Math.max(0, target), behavior: 'auto' });
      readingViewRestored.current = true;
    };
    reveal();
    return () => {
      cancelled = true;
      if (frame != null) cancelAnimationFrame(frame);
    };
  }, [doc, scale, wantedPage, wantedY]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const key = readingView.current.key;
    if (!scroller || !key || !doc || !scale) return undefined;
    let timer = null;
    const save = () => {
      if (!readingViewRestored.current && !wantedNoteId) return;
      const box = scroller.getBoundingClientRect();
      const cx = box.left + box.width / 2;
      const cy = box.top + box.height / 2;
      const nearest = [...scroller.querySelectorAll('.pdf-page')].reduce((best, pageEl) => {
        const rect = pageEl.getBoundingClientRect();
        const dx = cx < rect.left ? rect.left - cx : Math.max(0, cx - rect.right);
        const dy = cy < rect.top ? rect.top - cy : Math.max(0, cy - rect.bottom);
        const distance = Math.hypot(dx, dy);
        return !best || distance < best.distance ? { pageEl, rect, distance } : best;
      }, null);
      if (!nearest || nearest.rect.width < 10 || nearest.rect.height < 10) return;
      const view = {
        page: Number(nearest.pageEl.dataset.page),
        x: Math.max(0, Math.min(1, (cx - nearest.rect.left) / nearest.rect.width)),
        y: Math.max(0, Math.min(1, (cy - nearest.rect.top) / nearest.rect.height)),
        scale,
      };
      readingView.current.view = view;
      localStorage.setItem(key, JSON.stringify(view));
    };
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(save, 250);
    };
    scroller.addEventListener('scroll', schedule, { passive: true });
    schedule();
    return () => {
      scroller.removeEventListener('scroll', schedule);
      window.clearTimeout(timer);
      save();
    };
  }, [doc, scale, wantedNoteId]);

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

  const signedIn = !!getToken();

  const closeFeedback = () => {
    setFeedbackOpen(false);
    setFeedbackContent('');
    setFeedbackError(null);
    setFeedbackSent(false);
  };

  const sendFeedback = async () => {
    if (!feedbackContent.trim()) return;
    setFeedbackSending(true);
    setFeedbackError(null);
    try {
      await submitFeedback({
        content: feedbackContent.trim(),
        // Where the reporter was standing, so an admin can retrace it.
        page: window.location.href,
        contact: null,
      });
      setFeedbackSent(true);
    } catch (e) {
      setFeedbackError(e.message);
    } finally {
      setFeedbackSending(false);
    }
  };

  const pageOpenReference = useEvent(openReference);
  const pageFollowLink = useEvent(followLink);
  const pageSelectNote = useEvent(pointAtNote);
  const pageMoveNote = useEvent(moveNote);
  const pageDrawStroke = useEvent(drawStroke);
  const pageSelectInk = useEvent((stroke) => setSelectedInk(stroke ? {
    id: stroke.id,
    groupId: stroke.group_id || null,
  } : null));
  const pageHoverInk = useEvent((_page, objects) => {
    const wanted = new Set(objects);
    const pages = new Set();
    for (const stroke of inkRef.current) {
      const object = stroke.group_id ? `group:${stroke.group_id}` : `stroke:${stroke.id}`;
      if (wanted.has(object)) pages.add(stroke.page);
    }
    setHoveredInk({ pages, objects });
  });
  const pageEraseStroke = useEvent(eraseStroke);
  const pageEraseNote = useEvent(removeNote);
  const pageHover = useEvent((spot) => { hoverRef.current = spot; });
  const pageDropAnchor = useEvent(dropAnchor);
  const pageCreateClip = useEvent(createClip);
  const pageUpdateClip = useEvent(updateClip);
  const pageCommitClip = useEvent(commitClip);
  const pageRemoveClip = useEvent(removeClip);
  const pageSendClip = useEvent(openSendClip);
  const pageMoveStroke = useEvent(moveStroke);
  const pageDropAnimal = useEvent(dropAnimal);
  const pageMoveAnimal = useEvent(moveAnimal);
  const pageEraseAnimal = useEvent(eraseAnimal);

  if (error && !doc) {
    return (
      <>
        <style>{styles}</style>
        <div className="shell">
          <div className="error">{error}</div>
          <p className="hint">
            <a href={source?.backHref || appPath('/')} onClick={markReturnToPapol}>Back to Papol</a>
          </p>
        </div>
      </>
    );
  }

  const pages = doc ? Array.from({ length: doc.numPages }, (_, i) => i + 1) : [];

  // A percentage once the server has said how big the file is; null while
  // that is still unknown, which reads as "under way" rather than "stuck
  // at zero".
  const pdfPct =
    pdfProgress && pdfProgress.total > 0
      ? Math.min(100, Math.round((pdfProgress.loaded / pdfProgress.total) * 100))
      : null;
  const openReferencePage = Number(openCite?.anchor?.closest?.('.pdf-page')?.dataset.page) || null;

  return (
    <>
      <style>{styles}</style>
      <header
        className="viewer-bar"
        // A tool taken with the pointer should not be left holding keyboard
        // focus. Nothing shows while the pointer is what moved, but the
        // moment a key is pressed the browser promotes that parked focus to
        // a ring — so picking up the laser with V drew a box around the
        // brush, which is the one thing on the bar that is *not* in hand.
        // Two selections, disagreeing. Focus that arrives by Tab is left
        // alone, so the bar is still walkable and still says where you are.
        onClick={(e) => {
          if (e.detail === 0) return;
          e.target.closest?.('button')?.blur();
        }}
      >
        {/* Arriving from Papol, going back is a step back in history, not a
            new entry — otherwise Papol's own Back button walks the reader
            straight into the viewer again. The href stays for a direct
            visit, and for opening in a new tab. */}
        <a
          className="back"
          href={source?.backHref || appPath('/')}
          onClick={(e) => {
            markReturnToPapol();
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            if (document.referrer.startsWith(window.location.origin) && window.history.length > 1) {
              e.preventDefault();
              window.history.back();
            }
          }}
        >
          ← <span className="back-word">Back to </span>Papol
        </a>
        <span
          className={`link-navigation${learnLinkNavigation ? ' learning' : ''}`}
          role="group"
          aria-label="Link navigation"
        >
          <button
            type="button"
            className="history-arrow"
            disabled={linkHistory.current.back.length === 0}
            onClick={() => moveThroughLinks('back')}
            aria-label="Back through followed links"
            title="Back through followed links ([)"
          >
            <svg className="history-arrow-glyph" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 12H4m6-6-6 6 6 6" />
            </svg>
            <span className="history-key" aria-hidden="true">[</span>
          </button>
          <button
            type="button"
            className="history-arrow"
            disabled={linkHistory.current.forward.length === 0}
            onClick={() => moveThroughLinks('forward')}
            aria-label="Forward through followed links"
            title="Forward through followed links (])"
          >
            <svg className="history-arrow-glyph" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 12h16m-6-6 6 6-6 6" />
            </svg>
            <span className="history-key" aria-hidden="true">]</span>
          </button>
          {learnLinkNavigation && (
            <span className="learn-papol" role="dialog" aria-labelledby="learn-link-title">
              <span className="learn-papol-kicker">Learn Papol</span>
              <strong id="learn-link-title">Jump back to where you were</strong>
              <span>
                Use these buttons after following a link, or press <kbd>[</kbd> and <kbd>]</kbd>
                {' '}to move back and forward.
              </span>
              <button
                type="button"
                className="learn-papol-close"
                onClick={() => setLearnLinkNavigation(false)}
                aria-label="Dismiss this tip"
              >
                Got it
              </button>
            </span>
          )}
        </span>
        <span className="spacer" />
        <div className={`pdf-search${searchOpen ? ' open' : ''}`}>
          <button type="button" className="search-button" onClick={() => setSearchOpen((open) => !open)} title="Search PDF (Ctrl/Command+F)" aria-label="Search PDF" aria-expanded={searchOpen}>
            <span aria-hidden="true">⌕</span> Search
          </button>
          {searchOpen && (
            <div className="search-pop" role="search">
              <input
                ref={searchInputRef}
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    moveThroughSearch(e.shiftKey ? -1 : 1);
                  }
                }}
                placeholder="Search PDF"
                aria-label="Search PDF"
              />
              <span className="search-count" role="status">
                {searchIndexing ? 'Indexing…' : searchQuery.trim()
                  ? searchResults.length
                    ? `${activeSearchResult + 1} / ${searchResults.length}`
                    : 'No results'
                  : ''}
              </span>
              <button type="button" onClick={() => moveThroughSearch(-1)} disabled={!searchResults.length} aria-label="Previous result">↑</button>
              <button type="button" onClick={() => moveThroughSearch(1)} disabled={!searchResults.length} aria-label="Next result">↓</button>
              <button type="button" onClick={() => { setSearchOpen(false); setSearchQuery(''); }} aria-label="Close search">×</button>
            </div>
          )}
        </div>
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
                aria-expanded={SHEETS.has(t.id) ? sheet === t.id : undefined}
                title={
                  t.id === 'brush'
                    ? `${t.label} (X) — ${t.hint}. X again for colour and width`
                    : t.id === 'cow'
                      ? `${t.label} (M) — ${t.hint}. M again to choose which`
                      : `${t.label} (${t.badge}) — ${t.hint}`
                }
                // Once to pick it up, again to open what belongs to it.
                onClick={() => takeTool(t.id)}
              >
                <ToolGlyph id={t.id} animal={animal} />
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
                  brush, and mean nothing while anything else is in hand.

                  Colour, then how much it hides, then the nib, then the
                  weight — and each row is drawn in everything chosen above
                  it, so by the last row the sample is the mark itself: this
                  colour, this strong, from this nib, at that size. */}
              {t.id === 'brush' && brushOpen && (
                <div className="brush-pop" role="group" aria-label="The brush">
                  <span className="brush-label">Colour</span>
                  <div className="swatches">
                    {INK_COLORS.map((c, i) => (
                      <button
                        key={c.hex}
                        type="button"
                        className={`swatch${c.hex === inkColor ? ' on' : ''}`}
                        style={{ '--swatch': c.hex }}
                        aria-pressed={c.hex === inkColor}
                        aria-label={c.name}
                        title={`${c.name} (${i + 1})`}
                        onClick={() => setInkColor(c.hex)}
                      />
                    ))}
                  </div>
                  <span className="brush-label">Strength</span>
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
                        {/* One colour at three strengths, on the page the
                            ink will be on. It was half over white and half
                            over black, to show what survives underneath —
                            which said it, and looked like two colours were
                            being offered rather than one. */}
                        <span className="shade-sample">
                          <span
                            className="shade-ink"
                            style={{ background: inkColor, opacity: o.value }}
                          />
                        </span>
                      </button>
                    ))}
                  </div>
                  <span className="brush-label">Nib</span>
                  <div className="weights" role="group" aria-label="Nib">
                    {INK_SHAPES.map((sh) => (
                      <button
                        key={sh.id}
                        type="button"
                        className={`shape${sh.id === inkShape ? ' on' : ''}`}
                        aria-pressed={sh.id === inkShape}
                        aria-label={sh.name}
                        title={
                          sh.id === 'flat'
                            ? 'Flat — broad across the page, thin along it'
                            : 'Round — the same weight in every direction'
                        }
                        onClick={() => setInkShape(sh.id)}
                      >
                        {/* The nib's shape, at a size of its own. What is
                            being chosen here is which nib, and the row
                            below already says how big it is — a sample
                            that changed size too would be answering a
                            question that has been asked once already. */}
                        <span
                          className={`nib nib-${sh.id}`}
                          style={{ background: inkColor, opacity: inkOpacity }}
                        />
                      </button>
                    ))}
                  </div>
                  <span className="brush-label">Size</span>
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
                          className={`weight-strip${inkShape === 'round' ? ' round' : ''}`}
                          // Fixed, and in proportion. The zoom is not part
                          // of what is being chosen here, and a row of
                          // controls that grew and shrank as the reader
                          // zoomed the paper would be answering a question
                          // nobody asked. The brush on the page is what
                          // follows the zoom, because it is the only thing
                          // that has to agree with the ink.
                          style={{
                            width:
                              inkShape === 'round'
                                ? sampleSize(w).tall
                                : sampleSize(w).wide,
                            height: sampleSize(w).tall,
                            background: inkColor,
                            opacity: inkOpacity,
                          }}
                        />
                      </button>
                    ))}
                  </div>
                  {/* The one thing about the brush that is not in this
                      sheet, said where someone setting the brush up will
                      see it. */}
                  <p className="brush-tip">Try holding shift while drawing.</p>
                </div>
              )}

              {/* Hung off the animal rather than put in the bar: which
                  animal it is is a fact about this one tool, and means
                  nothing while anything else is in hand. */}
              {t.id === 'cow' && sheet === 'cow' && (
                <div className="brush-pop" role="group" aria-label="The menagerie">
                  <span className="brush-label">Animal</span>
                  <div className="beasts">
                    {ANIMALS.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        className={`beast${a.id === animal ? ' on' : ''}`}
                        aria-pressed={a.id === animal}
                        aria-label={a.label}
                        title={`${a.label} — ${a.hint}`}
                        onClick={() => setAnimal(a.id)}
                      >
                        {/* The animal itself, not its glyph: the sheet has
                            room for the drawing, and the drawing is what
                            the reader is choosing between. */}
                        <svg viewBox={`0 0 ${a.box.w} ${a.box.h}`} aria-hidden="true">
                          {/* Scaled to the size the family is drawn at, not
                              left at whatever fraction of its own box the
                              species happens to fill: see `fitFor` in
                              animals.js. It is what makes a cat as big as a
                              cow here, and — since the pen is the same
                              fraction of the animal — what makes its line
                              the same number of pixels too. */}
                          <g
                            transform={`translate(${a.box.w / 2} ${a.box.h / 2}) scale(${a.fit.toFixed(
                              3
                            )}) translate(${-a.box.w / 2} ${-a.box.h / 2})`}
                          >
                            {a.painted ? (
                              /* A rigged species arrives already painted —
                                 it has parts that are filled and not
                                 stroked and parts that are stroked and not
                                 filled, which two flat groups cannot say.
                                 All it wants from the sheet is the pen. */
                              <g
                                strokeWidth={a.fitStroke}
                                dangerouslySetInnerHTML={{ __html: a.painted }}
                              />
                            ) : (
                              <>
                                <g
                                  fill="#faf7ef"
                                  stroke="#33383f"
                                  strokeWidth={a.fitStroke}
                                  strokeLinejoin="round"
                                  dangerouslySetInnerHTML={{ __html: a.pale }}
                                />
                                <g fill="#33383f" dangerouslySetInnerHTML={{ __html: a.dark }} />
                              </>
                            )}
                          </g>
                        </svg>
                        <span className="beast-name">{a.label}</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      className="beast magic-wand-beast"
                      aria-label="Magic wand"
                      title="Magic wand — conjure ten random animals into the current view"
                      onClick={waveAnimalWand}
                    >
                      <svg viewBox="0 0 72 48" aria-hidden="true">
                        <g transform="rotate(-36 36 24)">
                          <path d="M19 30 L53 16" fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" />
                          <path d="M16 31 L22 27" fill="none" stroke="#d7a72d" strokeWidth="6" strokeLinecap="round" />
                        </g>
                        <path d="M54 7v10M49 12h10M62 18v7M58.5 21.5h7M48 23v6M45 26h6" fill="none" stroke="#d7a72d" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                      <span className="beast-name">Magic wand</span>
                    </button>
                  </div>
                  <label className="brush-label" htmlFor="animal-speed">Speed</label>
                  <div className="animal-control">
                    <input
                      id="animal-speed"
                      type="range"
                      min="0.4"
                      max="1.8"
                      step="0.1"
                      value={animalSpeed}
                      onChange={(e) => setAnimalSpeed(Number(e.target.value))}
                    />
                  </div>
                  <label className="brush-label" htmlFor="animal-activity">Activities</label>
                  <div className="animal-control">
                    <input
                      id="animal-activity"
                      type="range"
                      min="0"
                      max="3"
                      step="0.25"
                      value={animalActivity}
                      onChange={(e) => setAnimalActivity(Number(e.target.value))}
                    />
                  </div>
                  <label className="brush-label" htmlFor="animal-follow">Follow page</label>
                  <div className="animal-control animal-follow-control">
                    <input
                      id="animal-follow"
                      type="checkbox"
                      checked={animalFollow}
                      onChange={(e) => setAnimalFollow(e.target.checked)}
                    />
                  </div>
                </div>
              )}

              {t.id === 'laser' && sheet === 'laser' && (
                <div className="brush-pop" role="group" aria-label="The laser">
                  <span className="brush-label">Colour</span>
                  <div className="swatches">
                    {INK_COLORS.map((c, i2) => (
                      <button
                        key={c.hex}
                        type="button"
                        className={`swatch${c.hex === laserColor ? ' on' : ''}`}
                        style={{ '--swatch': c.hex }}
                        aria-pressed={c.hex === laserColor}
                        aria-label={c.name}
                        title={`${c.name} (${i2 + 1})`}
                        onClick={() => setLaserColor(c.hex)}
                      />
                    ))}
                  </div>

                  <p className="brush-tip">
                    Try holding shift while pressing.
                  </p>
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
          <span className="paper-menu" ref={paperMenuRef}>
            <button
              type="button"
              className="bar-link paper-info-button"
              onClick={() => setPaperInfoOpen((open) => !open)}
              aria-expanded={paperInfoOpen}
              aria-haspopup="dialog"
            >
              <span className="info-glyph" aria-hidden="true">i</span> Info
            </button>
            <a
              className="bar-link"
              href={pdfHref(paper)}
              download={`${(paper.title || 'paper').replace(/[\\/:*?"<>|]/g, '-')}.pdf`}
            >
              Download
            </a>
            {paperInfoOpen && (
              <div className="paper-info-pop" role="dialog" aria-label="Current paper information">
                <button type="button" className="card-x" onClick={() => setPaperInfoOpen(false)} aria-label="Close" title="Close">
                  ×
                </button>
                <h3 className="ref-title">{paperInfo?.title || paper.title}</h3>
                {(paperInfo?.authors || paperAuthors(paper.authors)).length > 0 && (
                  <p className="ref-authors">
                    {(paperInfo?.authors || paperAuthors(paper.authors)).join(', ')}
                  </p>
                )}
                {(paperInfo?.venue || paper.journal || paperInfo?.year || paper.year) && (
                  <p className="ref-where">
                    {[paperInfo?.venue || paper.journal, paperInfo?.year || paper.year].filter(Boolean).join(' · ')}
                    {typeof paperInfo?.citations === 'number' && (
                      <span className="ref-cited">Cited by {paperInfo.citations.toLocaleString()}</span>
                    )}
                  </p>
                )}
                {!paperInfo && !paperInfoError && <p className="ref-looking">Looking up paper details…</p>}
                {paperInfoError && <p className="ref-unmatched">Details unavailable.</p>}
                {paperInfo?.abstract && <p className="ref-abstract full">{paperInfo.abstract}</p>}
                <div className="ref-links">
                  <a className="ref-link here" href={appPath(`/paper/${paper.id}`)}>In Papol</a>
                  {paperInfo?.pdf_url && (
                    <a className="ref-link" href={paperInfo.pdf_url} target="_blank" rel="noreferrer">PDF</a>
                  )}
                  {(paperInfo?.url || paper.doi) && (
                    <a
                      className="ref-link"
                      href={paperInfo?.url || paperDoiHref(paper.doi)}
                      target="_blank"
                      rel="noreferrer"
                    >{paperInfo?.doi || paper.doi ? 'DOI' : 'Page'}</a>
                  )}
                </div>
              </div>
            )}
          </span>
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
          onClick={() => {
            focus.current = captureFocus(null);
            setRailOpen((v) => !v);
          }}
          aria-pressed={railOpen}
          aria-label={railOpen ? 'Hide my anchors' : 'Show my anchors'}
          title={railOpen ? 'Hide my anchors' : 'Show my anchors'}
        >
          {railOpen ? '›' : '‹'}
        </button>
        <div
          className="pages"
          ref={scrollerRef}
          onPointerDown={(e) => {
            if (tool !== 'cow' || e.target.closest('.pdf-page')) return;
            const pages = [...e.currentTarget.querySelectorAll('.pdf-page')];
            const nearest = pages.reduce((best, el) => {
              const r = el.getBoundingClientRect();
              const dx = e.clientX < r.left ? r.left - e.clientX : Math.max(0, e.clientX - r.right);
              const dy = e.clientY < r.top ? r.top - e.clientY : Math.max(0, e.clientY - r.bottom);
              const distance = Math.hypot(dx, dy);
              return !best || distance < best.distance ? { el, r, distance } : best;
            }, null);
            if (!nearest) return;
            const x = Math.max(-0.08, Math.min(1.08, (e.clientX - nearest.r.left) / nearest.r.width));
            const y = Math.max(-0.10, Math.min(1.10, 1 - (e.clientY - nearest.r.top) / nearest.r.height));
            dropAnimal(Number(nearest.el.dataset.page), { x, y });
          }}
        >
          {!doc && (
            <div className="pdf-loading" role="status" aria-live="polite">
              <div className="pdf-loading-card">
                <p>Loading the paper…</p>
                <div className={`pdf-progress-track${pdfPct == null ? ' indeterminate' : ''}`}>
                  <div
                    className="pdf-progress-fill"
                    style={pdfPct != null ? { width: `${pdfPct}%` } : undefined}
                  />
                </div>
                {pdfPct != null && <span className="pdf-progress-pct">{pdfPct}%</span>}
              </div>
            </div>
          )}
          {(!doc || !scale) && (
            <>
              <div className="page-skeleton" />
              <div className="page-skeleton" />
            </>
          )}
          {scale && pages.map((n, index) => (
            <React.Fragment key={n}>
              {index > 0 && (
                <div
                  className="animal-gutter"
                  aria-hidden="true"
                  onPointerDown={(e) => {
                    if (tool !== 'cow') return;
                    e.stopPropagation();
                    const pageEl = e.currentTarget.nextElementSibling;
                    if (!pageEl?.classList.contains('pdf-page')) return;
                    const r = pageEl.getBoundingClientRect();
                    const x = Math.max(-0.08, Math.min(1.08, (e.clientX - r.left) / r.width));
                    // Stored against the lower sheet but physically above
                    // its top edge, in the gray inter-page margin.
                    const y = Math.max(1.01, Math.min(1.10, 1 - (e.clientY - r.top) / r.height));
                    dropAnimal(n, { x, y });
                  }}
                />
              )}
              <PdfPage
              doc={doc}
              pageNumber={n}
              scale={scale}
              renderScale={renderScale}
              notes={notesByPage.get(n) || EMPTY_INK}
              activeNoteId={notesByPage.get(n)?.some((note) => note.id === activeNoteId) ? activeNoteId : null}
              analysis={analysis}
              openReferenceId={openReferencePage === n ? openCite?.referenceId ?? null : null}
              onOpenReference={pageOpenReference}
              onFollowLink={pageFollowLink}
              onSelectNote={pageSelectNote}
              onMoveNote={pageMoveNote}
              tool={tool}
              ink={inkByPage.get(n) || EMPTY_INK}
              provenanceHighlights={wantedSelectionByPage.get(n) || EMPTY_INK}
              provenanceBox={wantedBox?.page === n ? wantedBox : null}
              selectedInk={selectedInkPages.has(n) ? selectedInk : null}
              hoveredInkObjects={hoveredInk.pages.has(n) ? hoveredInk.objects : EMPTY_INK}
              inkColor={inkColor}
              inkWidth={inkWidth}
              inkOpacity={inkOpacity}
              inkShape={inkShape}
              laserColor={laserColor}
              onDrawStroke={pageDrawStroke}
              onSelectInk={pageSelectInk}
              onHoverInkObjects={pageHoverInk}
              onEraseStroke={pageEraseStroke}
              onEraseNote={pageEraseNote}
              onHover={pageHover}
              onDropAnchor={pageDropAnchor}
              clips={clipsByPage.get(n) || EMPTY_INK}
              onCreateClip={pageCreateClip}
              onUpdateClip={pageUpdateClip}
              onCommitClip={pageCommitClip}
              onRemoveClip={pageRemoveClip}
              selectedClipId={clipsByPage.get(n)?.some((clip) => clip.id === selectedClipId)
                ? selectedClipId
                : null}
              onSelectClip={setSelectedClipId}
              onSendClip={pageSendClip}
              onMoveStroke={pageMoveStroke}
              onDragNote={setDraggingNoteId}
              animal={animal}
              animalSpeed={animalSpeed}
              animalActivity={animalActivity}
              animals={animalsByPage.get(n) || EMPTY_INK}
              onDropAnimal={pageDropAnimal}
              onMoveAnimal={pageMoveAnimal}
              onEraseAnimal={pageEraseAnimal}
              searchMatches={searchResultsByPage.get(n) || EMPTY_INK}
              activeSearchId={searchResults[activeSearchResult]?.page === n
                ? searchResults[activeSearchResult].id
                : null}
              />
            </React.Fragment>
          ))}
          {openCite && (
            <ReferenceCard
              anchor={openCite.anchor}
              reference={reference}
              error={referenceError}
              onClose={closeReference}
              position={openCite.index}
              count={openCite.referenceIds.length}
              onPrevious={openCite.index > 0 ? () => openReference(
                openCite.referenceIds[openCite.index - 1],
                openCite.anchor,
                null,
                openCite.referenceIds
              ) : null}
              onNext={openCite.index < openCite.referenceIds.length - 1 ? () => openReference(
                openCite.referenceIds[openCite.index + 1],
                openCite.anchor,
                null,
                openCite.referenceIds
              ) : null}
            />
          )}
          {selectionPaint && (
            <span
              className="selection-actions"
              style={{
                left: selectionPaint.left,
                top: selectionPaint.top,
              }}
            >
              <button
                type="button"
                className="selection-action selection-brush"
                style={{ '--loaded': inkColor }}
                aria-label="Paint selected text"
                title="Paint selected text"
                onPointerDown={(event) => event.preventDefault()}
                onClick={paintSelection}
              >
                <ToolGlyph id="brush" />
              </button>
              <button
                type="button"
                className="selection-action selection-send"
                aria-label="Send selected text to a board"
                title="Send selected text to a board"
                onPointerDown={(event) => event.preventDefault()}
                onClick={openSendSelection}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M7 17 17 7M9 7h8v8" />
                </svg>
              </button>
            </span>
          )}
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
                        <ToolGlyph id={t.id} animal={animal} />
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

        <button
          type="button"
          className="feedback-fab"
          onClick={() => setFeedbackOpen(true)}
        >
          Feedback
        </button>

        {feedbackOpen && (
          <div
            className="help-back"
            role="dialog"
            aria-modal="true"
            aria-label="Report a bug or ask for a feature"
            onClick={closeFeedback}
          >
            <div className="help-sheet feedback-sheet" onClick={(e) => e.stopPropagation()}>
              <h3>{feedbackSent ? 'Thank you' : 'Report a bug or ask for a feature'}</h3>
              {feedbackSent ? (
                <>
                  {signedIn && (
                    <p className="feedback-note">
                      If it needs a reply, it comes to your email.
                    </p>
                  )}
                  <div className="feedback-actions">
                    <button type="button" className="primary" onClick={closeFeedback}>
                      Close
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="feedback-field">
                    <label>
                      What went wrong, or what would you like the viewer to do?
                    </label>
                    <textarea
                      rows="5"
                      maxLength={4000}
                      value={feedbackContent}
                      onChange={(e) => setFeedbackContent(e.target.value)}
                      placeholder="I clicked … and the page …, or: it would help if …"
                      autoFocus
                    />
                  </div>

                  {feedbackError && <p className="feedback-error">{feedbackError}</p>}

                  <div className="feedback-actions">
                    <button type="button" onClick={closeFeedback} disabled={feedbackSending}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="primary"
                      onClick={sendFeedback}
                      disabled={feedbackSending || !feedbackContent.trim()}
                    >
                      {feedbackSending ? 'Sending…' : 'Submit'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {searchWrap && (
          <div
            key={searchWrap.id}
            className="search-wrap-sign"
            role="status"
            aria-label={searchWrap.direction > 0 ? 'Wrapped to first result' : 'Wrapped to last result'}
          >
            <span aria-hidden="true">{searchWrap.direction > 0 ? '↻' : '↺'}</span>
          </div>
        )}

        {sendSelection && (
          <div
            className="help-back"
            role="dialog"
            aria-modal="true"
            aria-label={sendSelection.kind === 'clip' ? 'Send clipped area to a board' : 'Send selected text to a board'}
            onClick={closeSendSelection}
          >
            <div className="help-sheet send-selection-sheet" onClick={(event) => event.stopPropagation()}>
              <h3>{sendComplete ? 'Sent to staging' : 'Send to a board'}</h3>
              {sendComplete ? (
                <>
                  <p>{sendSelection.kind === 'clip' ? 'The clip' : 'The excerpt'} is waiting in the board’s staging area.</p>
                  <div className="feedback-actions">
                    <button type="button" className="primary" onClick={closeSendSelection}>Done</button>
                  </div>
                </>
              ) : (
                <>
                  {sendSelection.kind !== 'clip' && <label className="send-selection-field">
                    <span>Text</span>
                    <textarea
                      rows="7"
                      maxLength="10000"
                      value={sendSelection.text}
                      onChange={(event) => setSendSelection({ ...sendSelection, text: event.target.value })}
                      autoFocus
                    />
                  </label>}
                  <label className="send-selection-field">
                    <span>Board</span>
                    <select
                      value={sendBoardGuid}
                      onChange={(event) => setSendBoardGuid(event.target.value)}
                      disabled={!sendBoards.length}
                    >
                      {!sendBoards.length && <option value="">No boards available</option>}
                      {sendBoards.map((candidate) => (
                        <option key={candidate.guid} value={candidate.guid}>{candidate.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="send-selection-field">
                    <span>Comment <small>optional</small></span>
                    <textarea
                      rows="3"
                      maxLength="10000"
                      value={sendSelection.comment}
                      onChange={(event) => setSendSelection({ ...sendSelection, comment: event.target.value })}
                      placeholder="Why are you saving this?"
                    />
                  </label>
                  <p className="send-selection-source">
                    {sendSelection.kind === 'clip'
                      ? `Source: Page ${sendSelection.page}`
                      : <>Source: {paper?.title || 'Paper'}, page {sendSelection.page}. A backlink is included.</>}
                  </p>
                  {sendError && <p className="feedback-error">{sendError}</p>}
                  <div className="feedback-actions">
                    <button type="button" onClick={closeSendSelection} disabled={sendBusy}>Cancel</button>
                    <button
                      type="button"
                      className="primary"
                      disabled={sendBusy || !sendBoardGuid || (sendSelection.kind !== 'clip' && !sendSelection.text.trim())}
                      onClick={sendSelectionToBoard}
                    >
                      {sendBusy ? 'Sending…' : 'Send to board'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
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
                className={`anchor-row${
                  note.id === flashId ? ' flash' : ''
                }${note.id === draggingNoteId ? ' carrying' : ''}`}
                onClick={() => goToNote(note)}
              >
                <span className="row-glyph">
                  <GlyphFor note={note} />
                </span>
                <span className="anchor-where">{label(note)}</span>
                <button
                  className="link anchor-write"
                  onClick={(e) => {
                    e.stopPropagation();
                    startWriting(note);
                  }}
                >
                  add a note
                </button>
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
                className={`note-card${
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
                  {label(note)}
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
