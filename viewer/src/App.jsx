import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
// The legacy build, not the modern one: the modern build calls JavaScript
// that WebKit does not have yet (Map.prototype.getOrInsertComputed), so it
// fails in Safari and in Papol Desktop's macOS webview. The legacy build
// carries polyfills for exactly that, in the document and in the worker.
// pdf.js's own text-layer rules: the spans are laid out by CSS variables it
// sets on each one, so its stylesheet is part of the library, not decoration.
import 'pdfjs-dist/legacy/web/pdf_viewer.css';
import { pdfjsReady } from './pdfRuntime.js';
import {
  pdfHref, downloadablePdfHref, pdfLoadInput, getViewerPaperInfo, getViewerReferences, getViewerReference, resolveViewerReference,
  submitFeedback, listBoards, stageBoardExcerpt, stageBoardClip,
} from './api';
import { resolveSource, getToken } from './source';
import { appPath, backendPath } from './base';
import {
  makePdfViewerDefault, nativeDataActive, pdfViewerStatus, recentDiagnosticEvents,
  recordDiagnosticEvent, requestSignIn,
} from '../../shared/nativeData.js';
import { diagnosticLogExcerpt, feedbackWithDiagnosticLog } from '../../shared/diagnosticLog.js';
import { unexpectedDesktopErrorReport } from '../../shared/errorReport.js';
import { hydrateCredential } from '../../shared/credentials.js';
import { canOpenPrivateSource } from './viewerAccess.js';
import PdfPage from './PdfPage';
import { ANIMALS } from './animals';
import ReferenceCard from './ReferenceCard';
import { readNamedReference } from './references';
import { GlyphFor, ToolGlyph } from './glyphs';
import { copySelectionSnapshot } from './selectionCopy.js';
import { STRIP_RATIO } from './ink';
import { selectionStrokes } from './selectionInk';
import { createPlacedAnimal, randomViewportPlacements } from './animalPlacement';
import { findTextMatches, indexPdfDocument } from './pdfSearch';
import { cleanExcerptText } from './excerptText';
import { joinTextPieces, markBounds, pageCharacters, textUnderMarks } from './paintText';
import { linkHistoryDirection } from './linkHistoryShortcut';
import { pageAtLine } from './readingPage';
import ReturnPill from './ReturnPill';
import { createValueStore } from './valueStore';
import { pageRenderQueue } from './pageRenderQueue';
import {
  markViewerPerformance, observeViewerPerformanceMark, viewerOpeningTimings,
} from './performance.js';
import {
  DESKTOP, DOCUMENT_WINDOW, MAC, closeDesktopDocumentWindow, focusDesktopLibraryWindow,
} from '../../shared/desktopShell';
import {
  LINK_NAVIGATION_TIP, RETURN_PILL_HIDDEN, isFeatureStateSet, setFeatureState,
} from '../../shared/featureStates';
import DesktopNav from '../../shared/ui/DesktopNav.jsx';
import DesktopSyncingStatus from '../../shared/ui/DesktopSyncingStatus.jsx';
import { contextMenuHandler, openContextMenu } from '../../shared/contextMenu.js';
import appLimits from '../../shared/appLimits.js';

// The width at which the rail stops having a column of its own — the same
// number as the breakpoint in styles.js, and it has to stay that way.
const NARROW = 860;
const MIN_RAIL_WIDTH = appLimits.viewer.rail_width_min;
const MAX_RAIL_WIDTH = appLimits.viewer.rail_width_max;
const DEFAULT_RAIL_WIDTH = 344;
const clampRailWidth = (width) => Math.min(MAX_RAIL_WIDTH, Math.max(MIN_RAIL_WIDTH, width));
const markReturnToPapol = () => {
  // This is a one-shot navigation handoff, not demo-mode state. Papol
  // consumes it on arrival so returning from the viewer does not greet the
  // same visit a second time.
  window.sessionStorage.setItem('papol.viewerReturn', '1');
};

const MIN_SCALE = appLimits.viewer.zoom_min;
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
const MAX_SCALE = appLimits.viewer.zoom_max;
// How long a pinch has to pause before the rest of the viewer hears of the
// zoom it reached and the pages are redrawn sharp.
const ZOOM_SETTLE_MS = 120;
// How wide a page is allowed to open. Fitting the window is right up to a
// point; past it a two-column paper on a large monitor is blown to a size
// nobody reads at. The reader can still zoom past this — it only bounds
// the scale the viewer chooses on its own, and .page-skeleton is the same
// width so the shape shown while loading is the shape that arrives.
const FIT_MAX_WIDTH = appLimits.viewer.fit_width_max;
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

// Which tools keep a sheet of settings under them, so that reaching for one
// already in your hand opens it.
const SHEETS = new Set(['brush', 'cow']);

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
const FIRST_PAGE_ONLY = new Set([1]);
const PAGE_PREVIEW_WIDTH = 320;
const PAGE_PREVIEW_QUALITY = 0.72;

// A file opened from Finder always begins at page one and carries no saved
// reading position. Keep the rest of the document as cheap geometry until
// page one is visible, then turn nearby shells into full PdfPages as the
// reader approaches them. This avoids mounting every page's effects — and,
// in particular, avoids calling pdf.js getPage() for the whole document —
// on the opening frame.
function LazyPageShell({ pageNumber, size, scale, previewUrl }) {
  return (
    <div
      className="pdf-page lazy-page"
      style={{
        width: size?.width ? size.width * scale : undefined,
        height: size?.height ? size.height * scale : undefined,
        backgroundImage: previewUrl ? `url(${JSON.stringify(previewUrl)})` : undefined,
        backgroundSize: '100% 100%',
      }}
      data-page={pageNumber}
      data-page-width={size?.width || undefined}
      data-page-height={size?.height || undefined}
      data-render-scale={scale}
      data-lazy-page=""
      aria-hidden="true"
    >
      <span className="page-number">{pageNumber}</span>
    </div>
  );
}

// What the reader can be holding. The arrow is reading: text selects, and
// what is already on the page can be picked up and moved. The rest put
// something in their hand, and the page stops being selectable while they
// hold it.
// z x v c, in the order the tools sit in the bar: four keys under
// the hand that is not holding the mouse, so switching costs nothing in
// the middle of marking a paper up. Each carries a way to remember it, for
// the help sheet — a shortcut nobody can recall is a shortcut nobody uses,
// and "it is the third key along" is not something anyone recalls.
const TOOLS = [
  { id: 'arrow', key: 'z', badge: 'Z', label: 'Read', hint: 'Select text, and drag anchors and ink about' , mnemonic: 'Zero tools' },
  { id: 'clipper', key: 'x', badge: 'X', label: 'Clipper', hint: 'Draw a rectangle and keep a movable view of it on the paper', mnemonic: 'X crops' },
  { id: 'brush', key: 'v', badge: 'V', label: 'Brush', hint: 'Draw on the page. Kept with your notes' , mnemonic: 'Vivid marks' },
  { id: 'eraser', key: 'c', badge: 'C', label: 'Eraser', hint: 'Rub out ink, animals, and anchors with nothing written on them' , mnemonic: 'Clean' },
  { id: 'anchor', key: 'a', badge: 'A', label: 'Anchor', hint: 'Click the page to drop an anchor' , mnemonic: 'Anchor' },
  { id: 'cow', key: 'm', badge: 'M', label: 'Animal', hint: 'Put an animal on the page. It wanders, and is not kept' , mnemonic: 'Menagerie' },
];

// Drop tools are one-shot: they are a thing you are holding until you put
// it down, and then the ordinary reading cursor comes back.
const DROP_TOOLS = new Set(['anchor', 'clipper']);
const ANNOTATION_TOOLS = new Set(['clipper', 'brush', 'eraser', 'anchor']);

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

// Shared with the library window, which asks the same question.
const PDF_VIEWER_PROMPT_KEY = 'papol.pdfViewerPrompt';

// Native commands reject with a bare string rather than an Error.
const messageOf = (failure) => String(failure?.message ?? failure);

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

  return joinTextPieces(pieces);
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
  const [firstPageReady, setFirstPageReady] = useState(false);
  const [firstPageInteractive, setFirstPageInteractive] = useState(false);
  const [materializedFilePages, setMaterializedFilePages] = useState(() => ({
    doc: null,
    pages: FIRST_PAGE_ONLY,
  }));
  const [filePagePreviews, setFilePagePreviews] = useState(() => ({
    doc: null,
    urls: new Map(),
  }));
  useLayoutEffect(() => {
    markViewerPerformance('shell-committed');
  }, []);

  // Optional native queries and analysis wait until a page is visible. The
  // same milestone starts diagnostic recording, after the measured path, so
  // neither kind of background work competes with opening the document.
  useEffect(() => {
    return observeViewerPerformanceMark('first-page-painted', () => {
      setFirstPageReady(true);
      if (DESKTOP && source?.openedFile) {
        for (const fields of viewerOpeningTimings(source.openingTimings)) {
          void recordDiagnosticEvent({
            component: 'viewer', event: 'local_pdf_open_timing', fields,
          });
        }
      }
    });
  }, [source]);
  useEffect(() => observeViewerPerformanceMark(
    'first-page-text-ready',
    () => setFirstPageInteractive(true)
  ), []);

  // Papol's Notes list links straight to one note: ?paper=9&note=42.
  const wantedNoteUuid = new URLSearchParams(window.location.search).get('note');
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
  // Page 1 is already read to choose the initial zoom. Its unscaled size is
  // also a reliable shell for the rest of a normally uniform document, so
  // pages do not mount at zero height and then shove one another down while
  // their individual metadata promises resolve.
  const [defaultPageSize, setDefaultPageSize] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState([]);
  const [searchIndexing, setSearchIndexing] = useState(false);
  const [activeSearchResult, setActiveSearchResult] = useState(0);
  const [searchWrap, setSearchWrap] = useState(null);
  const searchWrapId = useRef(0);
  const searchInputRef = useRef(null);
  const paperMenuRef = useRef(null);
  const learnLinkTipRef = useRef(null);
  // How much of the PDF has arrived, while it has not: null until the
  // first progress event, since a bar at 0% before the request has even
  // answered reads as stalled rather than as "not yet known".
  const [pdfProgress, setPdfProgress] = useState(null);
  // A quick open should feel immediate, not flash a modal-looking card for a
  // fraction of a second. Local files keep the stable page-shaped skeleton;
  // detailed progress is reserved for slower downloads.
  const [showPdfLoading, setShowPdfLoading] = useState(false);
  const [notes, setNotes] = useState([]);
  const [error, setError] = useState(null);
  // Null until the page is measured: the document opens at the width of
  // the viewer, so nothing is drawn at a guessed scale first.
  const [scale, setScale] = useState(null);
  // Stay fitted through actual window resizes until the reader picks a zoom.
  const chosenZoom = useRef(false);
  // What the pages are actually drawn at. It follows `scale` once the
  // reader stops zooming, so a pinch costs a transform rather than a
  // re-render of every visible page.
  const [renderScale, setRenderScale] = useState(null);
  // Handed to the pages rather than the value itself, so that a new drawing
  // zoom reaches only the pages that follow it (see PdfPage).
  const renderScaleStore = useMemo(() => createValueStore(null), []);
  useLayoutEffect(() => {
    renderScaleStore.set(renderScale);
  }, [renderScale]);
  const [selectionPaint, setSelectionPaint] = useState(null);
  const selectionHighlightsByPage = useMemo(() => {
    const byPage = new Map();
    for (const stroke of selectionPaint?.strokes || []) {
      byPage.set(stroke.page, [...(byPage.get(stroke.page) || []), stroke]);
    }
    return byPage;
  }, [selectionPaint]);

  // A completed PDF selection is represented by our own paint geometry and
  // text snapshot, not a live DOM Range (the selected pages may be
  // virtualized afterward). Supply that text when WebKit/macOS invokes the
  // standard Copy command or its Command-C shortcut.
  useEffect(() => {
    if (!selectionPaint?.text) return undefined;
    const copy = (event) => {
      copySelectionSnapshot(event, selectionPaint.text, window.getSelection());
    };
    document.addEventListener('copy', copy);
    return () => document.removeEventListener('copy', copy);
  }, [selectionPaint]);
  const [sendSelection, setSendSelection] = useState(null);
  const [sendBoards, setSendBoards] = useState([]);
  const [sendBoardUuid, setSendBoardUuid] = useState('');
  const [sendBusy, setSendBusy] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [sendComplete, setSendComplete] = useState(false);
  const [activeNoteUuid, setActiveNoteUuid] = useState(null);
  // The anchor just pointed at: its entry in the rail lights up briefly.
  const [flashUuid, setFlashUuid] = useState(null);
  // Opening a paper is for reading. The anchors rail is available from its
  // handle, but every viewer window starts with the paper using the whole
  // width rather than inheriting an open rail from an earlier paper.
  const [railOpen, setRailOpen] = useState(false);
  const [railWidth, setRailWidth] = useState(() => {
    const saved = Number(localStorage.getItem('papol_viewer_rail_width'));
    return Number.isFinite(saved) && saved > 0 ? clampRailWidth(saved) : DEFAULT_RAIL_WIDTH;
  });
  // The paper's bibliography, and where it is cited in the PDF. Null until
  // it has been asked for; `status` says whether it is worth waiting on.
  // What the reader is holding. Remembered, like the rail: someone marking
  // up a paper puts the brush down between sittings, not between pages.
  const [tool, setTool] = useState(() => {
    if (source?.annotationsRequireNook) return 'arrow';
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

  // Their ink on this edition.
  const [ink, setInk] = useState([]);
  const [selectedInk, setSelectedInk] = useState(null);
  const [hoveredInk, setHoveredInk] = useState({ pages: new Set(), objects: EMPTY_INK });
  // Private views cut from this edition. Their source and placement use
  // page fractions, so they survive zoom and are restored with the paper.
  const [clips, setClips] = useState([]);
  const [selectedClipUuid, setSelectedClipUuid] = useState(null);
  const clipSaving = useRef(new Map());
  const [helpOpen, setHelpOpen] = useState(false);
  const [paperInfoOpen, setPaperInfoOpen] = useState(false);
  const [paperInfo, setPaperInfo] = useState(null);
  const [paperInfoError, setPaperInfoError] = useState(null);
  const [learnLinkNavigation, setLearnLinkNavigation] = useState(false);
  // A PDF opened from disk: adding it to a nook is the one step that needs
  // an account. idle | ask (sign in first?) | waiting (for the library
  // window's sign-in) | adding.
  const [nookStep, setNookStep] = useState('idle');
  // Kept apart from the sign-in step so clicking away can hide the prompt
  // without cancelling a sign-in already under way in the library window.
  const [nookPromptOpen, setNookPromptOpen] = useState(false);
  const [pdfViewerTip, setPdfViewerTip] = useState(false);
  // Asked once, over the first file opened from disk while another app is
  // the system's PDF viewer.
  useEffect(() => {
    if (!source?.openedFile || !firstPageReady) return undefined;
    let dismissed = false;
    try { dismissed = localStorage.getItem(PDF_VIEWER_PROMPT_KEY) === 'dismissed'; } catch { /* ask */ }
    if (dismissed) return undefined;
    let cancelled = false;
    pdfViewerStatus()
      .then((status) => { if (!cancelled) setPdfViewerTip(status.supported && !status.is_default); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [firstPageReady, source]);
  const [returnPillHidden, setReturnPillHidden] = useState(() => isFeatureStateSet(RETURN_PILL_HIDDEN));
  const [returnPillNotice, setReturnPillNotice] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackReportError, setFeedbackReportError] = useState(false);
  const [feedbackContent, setFeedbackContent] = useState('');
  const [feedbackSending, setFeedbackSending] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [feedbackError, setFeedbackError] = useState(null);
  const [feedbackLog, setFeedbackLog] = useState('');
  const [feedbackIncludeLog, setFeedbackIncludeLog] = useState(true);
  const reportedPdfErrors = useRef(new Set());

  useEffect(() => {
    if (!feedbackOpen) return;
    recentDiagnosticEvents(40)
      .then((events) => setFeedbackLog(diagnosticLogExcerpt(events)))
      .catch(() => {});
  }, [feedbackOpen]);
  // The anchor being carried across the page, so its row in the rail can
  // say so: the pin and the row are the same anchor seen twice, and moving
  // one ought to be visible in the other.
  const [draggingNoteUuid, setDraggingNoteUuid] = useState(null);
  // Cows. Nowhere near the server and gone on reload: they are not a mark
  // on the paper, they are company.
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
  // The sheet that is open, if any: 'brush', 'cow', or nothing. One at a
  // time, because it hangs off the tool it belongs to and only one tool is
  // ever in hand.
  const [sheet, setSheet] = useState(null);
  const brushOpen = sheet === 'brush';
  const promptToAddForAnnotations = async () => {
    if (!source?.annotationsRequireNook || nookStep === 'adding') return false;
    setTool('arrow');
    setSheet(null);
    await hydrateCredential();
    setNookStep(nativeDataActive() ? 'confirm' : 'ask');
    setNookPromptOpen(true);
    return true;
  };
  const tempInkUuid = useRef(0);
  const tempNoteUuid = useRef(0);
  // Strokes already asked to go, so the eraser cannot ask twice.
  const erasing = useRef(new Set());
  // Strokes still being saved, by the temporary uuid they are wearing until
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
  const [editing, setEditing] = useState(null); // note uuid being reworded
  const [naming, setNaming] = useState(null); // note uuid being renamed
  const [nameDraft, setNameDraft] = useState('');
  const [editText, setEditText] = useState('');
  const scrollerRef = useRef(null);
  // Do not even mount off-screen local-file pages until the critical first
  // page has painted. One observer handles every lightweight shell; using an
  // observer per page would merely exchange pdf.js startup work for browser
  // observer setup. The generous forward margin makes the next sheet ready
  // before an ordinary scroll reaches it.
  useEffect(() => {
    const root = scrollerRef.current;
    if (!source?.openedFile || !doc || !scale || !firstPageInteractive || !root) return undefined;
    const observer = new IntersectionObserver((entries) => {
      const arrived = entries
        .filter((entry) => entry.isIntersecting)
        .map((entry) => Number(entry.target.dataset.page))
        .filter((page) => Number.isInteger(page) && page > 1);
      if (!arrived.length) return;
      setMaterializedFilePages((previous) => {
        const before = previous.doc === doc ? previous.pages : FIRST_PAGE_ONLY;
        if (arrived.every((page) => before.has(page))) return previous;
        const pages = new Set(before);
        for (const page of arrived) pages.add(page);
        return { doc, pages };
      });
    }, { root, rootMargin: '125% 50%' });
    for (const shell of root.querySelectorAll('[data-lazy-page]')) observer.observe(shell);
    return () => observer.disconnect();
  }, [doc, scale, firstPageInteractive, source]);
  // Once page one is completely interactive, warm a tiny retained image for
  // every page. Full canvases are intentionally released far from the view;
  // these compressed previews remain underneath them, so a fast scroll never
  // exposes an empty sheet while the sharp canvas catches up. Preview work
  // uses the idle lane and visible page drawing always remains the priority.
  useEffect(() => {
    if (!source?.openedFile || !doc || !firstPageInteractive) return undefined;
    let cancelled = false;
    const withdraws = [];
    const tasks = new Set();
    const objectUrls = new Set();
    setFilePagePreviews({ doc, urls: new Map() });

    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const withdraw = pageRenderQueue().request({
        idle: true,
        priority: () => (cancelled ? null : pageNumber),
        run: async () => {
          const page = await doc.getPage(pageNumber);
          if (cancelled) return;
          const natural = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({
            scale: Math.min(1, PAGE_PREVIEW_WIDTH / natural.width),
          });
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(viewport.width));
          canvas.height = Math.max(1, Math.round(viewport.height));
          const context = canvas.getContext('2d', { alpha: false });
          context.fillStyle = '#fff';
          context.fillRect(0, 0, canvas.width, canvas.height);
          const task = page.render({ canvasContext: context, viewport });
          tasks.add(task);
          try {
            await task.promise;
          } catch (error) {
            if (error?.name === 'RenderingCancelledException') return;
            throw error;
          } finally {
            tasks.delete(task);
          }
          if (cancelled) return;
          const blob = await new Promise((resolve) => {
            canvas.toBlob(resolve, 'image/jpeg', PAGE_PREVIEW_QUALITY);
          });
          canvas.width = 0;
          canvas.height = 0;
          if (!blob || cancelled) return;
          const url = URL.createObjectURL(blob);
          objectUrls.add(url);
          setFilePagePreviews((previous) => {
            const urls = new Map(previous.doc === doc ? previous.urls : []);
            urls.set(pageNumber, url);
            if (urls.size === doc.numPages) {
              markViewerPerformance('page-previews-ready', { pages: doc.numPages });
            }
            return { doc, urls };
          });
        },
      });
      withdraws.push(withdraw);
    }

    return () => {
      cancelled = true;
      for (const withdraw of withdraws) withdraw();
      for (const task of tasks) task.cancel();
      for (const url of objectUrls) URL.revokeObjectURL(url);
    };
  }, [doc, firstPageInteractive, source]);
  // File-system viewers do not read or write state keyed to the PDF. Once a
  // paper is added to the nook, its canonical viewer may remember its place.
  const readingView = useRef(source?.openedFile
    ? { key: null, view: null }
    : savedReadingView());
  const readingViewRestored = useRef(false);
  // Anchors placed but not yet acknowledged, keyed by their temporary id.
  const pending = useRef(new Map());

  useEffect(() => {
    let cancelled = false;
    if (!source) {
      setError('Open a paper from your nook.');
      return undefined;
    }
    if (!canOpenPrivateSource({
      requiresSignIn: source.requiresSignIn,
      token: getToken(),
      localAccount: nativeDataActive(),
    })) {
      setError('Sign in to view your notes.');
      return undefined;
    }
    const loaded = source.load();
    loaded
      .then(({ doc: paperDoc, notes: loaded }) => {
        if (cancelled) return;
        setPaper(paperDoc);
        setNotes(loaded);
        markViewerPerformance('paper-loaded');
      })
      .catch((e) => { if (!cancelled) setError(e.message); });
    // Exact-hash nook membership is useful for the toolbar, but it must not
    // delay an opened file. Start it beside the ordinary source load and
    // apply it only after that initial paper has landed.
    if (source.loadNookPaper) {
      const nookPaper = source.loadNookPaper();
      Promise.all([loaded, nookPaper])
        .then(([, found]) => {
          if (!cancelled && found) setPaper(found);
        })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [source]);

  useEffect(() => {
    if (paper?.title) document.title = `${paper.title} — Papol`;
  }, [paper?.title]);

  // Files opened by the operating system already have enough identity in the
  // URL to load their bytes. Start that work alongside annotations and nook
  // metadata instead of putting those local database reads in front of PDF.js.
  const pdfPaper = source?.openedFile ? source.initialPaper : paper;
  const pdfIdentity = pdfPaper
    ? `${pdfPaper.opened_file && !pdfPaper.uuid ? 'opened:' : 'paper:'}${pdfPaper.edition_sha256 || ''}`
    : null;

  useLayoutEffect(() => {
    if (!pdfPaper) return undefined;
    let cancelled = false;
    let task = null;
    setPdfProgress(null);
    markViewerPerformance('pdf-bytes-requested');
    const inputReady = pdfLoadInput(pdfPaper).then((input) => {
      markViewerPerformance('pdf-bytes-ready', {
        bytes: input?.data?.byteLength ?? null,
      });
      return input;
    });
    Promise.all([inputReady, pdfjsReady])
      .then(([input, pdfjs]) => {
        if (!input?.url && !input?.data) throw new Error('This paper has no PDF.');
        if (cancelled) return null;
        task = pdfjs.getDocument({
          ...input,
          standardFontDataUrl: 'standard_fonts/',
          wasmUrl: 'wasm/',
        });
        task.onProgress = ({ loaded, total }) => {
          if (!cancelled) setPdfProgress({ loaded, total });
        };
        return task.promise;
      })
      .then(async (d) => {
        if (!d || cancelled) return;
        markViewerPerformance('document-loaded', { pages: d.numPages });
        // PDF.js has already parsed enough to expose page one. Resolve its
        // geometry before mounting every PdfPage, then commit document, page
        // shape, and fitted scale together without an intermediate render.
        const firstPage = await d.getPage(1);
        if (cancelled) return;
        const viewport = firstPage.getViewport({ scale: 1 });
        const pageSize = { width: viewport.width, height: viewport.height };
        setDefaultPageSize(pageSize);
        const el = scrollerRef.current;
        if (el && !chosenZoom.current) {
          const style = getComputedStyle(el);
          const room = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
          if (room > 0) {
            const next = clampScale(Math.min(room, FIT_MAX_WIDTH) / pageSize.width);
            setScale(next);
            setRenderScale(next);
          }
        }
        setDoc(d);
      })
      .catch((failure) => {
        if (cancelled) return;
        const message = messageOf(failure);
        if (/blob is not available offline|pdf is not available in the local replica/i.test(message)) {
          setError('This PDF has not finished downloading to this Mac. Connect to the internet and choose Sync, then open it again.');
          return;
        }
        if (/requires a network connection/i.test(message)) {
          setError(message);
          return;
        }
        setError(`PDF failed to open: ${message}`);
        if (!DESKTOP) return;
        const report = unexpectedDesktopErrorReport(failure, 'opening a PDF in the viewer', {
          surface: window.__PAPOL_ENV__?.surface,
          platform: navigator.platform,
        });
        if (reportedPdfErrors.current.has(report.signature)) return;
        reportedPdfErrors.current.add(report.signature);
        void recordDiagnosticEvent({
          level: 'error', component: 'viewer', event: 'pdf_open_failed',
          message, fields: { operation: 'pdf_open' },
        });
        setFeedbackReportError(true);
        setFeedbackContent(report.content);
        setFeedbackOpen(true);
      });
    return () => {
      cancelled = true;
      task?.destroy();
    };
  }, [pdfIdentity, pdfPaper]);

  useEffect(() => {
    if (doc || source?.openedFile) {
      setShowPdfLoading(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setShowPdfLoading(true), 350);
    return () => window.clearTimeout(timer);
  }, [doc, pdfIdentity, source]);

  useEffect(() => {
    if (!paperInfoOpen || paperInfo) return undefined;
    const pdfHash = paper?.edition_sha256 || paper?.sha256;
    if (!pdfHash) return undefined;
    let cancelled = false;
    setPaperInfoError(null);
    // A demo paper is fictional: there is nothing to look up and no server to
    // ask, so the demo's source answers from the paper itself.
    (source?.info ? source.info() : getViewerPaperInfo(pdfHash))
      .then((info) => {
        if (!cancelled) setPaperInfo(info);
      })
      .catch((e) => {
        if (!cancelled) setPaperInfoError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [paper, paperInfo, paperInfoOpen, source]);

  const paperPopupOpen = paperInfoOpen || nookPromptOpen || pdfViewerTip;

  // Everything hung from the paper menu is the same kind of transient
  // window, even though the contents differ. A click beyond the menu puts
  // whichever one is showing away; Escape is handled with the viewer's
  // other keyboard dismissals below.
  useEffect(() => {
    if (!paperPopupOpen) return undefined;
    const closeAway = (event) => {
      if (paperMenuRef.current?.contains(event.target)) return;
      setPaperInfoOpen(false);
      setNookPromptOpen(false);
      setPdfViewerTip(false);
    };
    document.addEventListener('pointerdown', closeAway, true);
    return () => document.removeEventListener('pointerdown', closeAway, true);
  }, [paperPopupOpen]);

  useEffect(() => {
    if (!learnLinkNavigation) return undefined;
    const closeAway = (event) => {
      if (!learnLinkTipRef.current?.contains(event.target)) setLearnLinkNavigation(false);
    };
    document.addEventListener('pointerdown', closeAway, true);
    return () => document.removeEventListener('pointerdown', closeAway, true);
  }, [learnLinkNavigation]);

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
    const editionUuid = paper?.edition_uuid;
    const pdfHash = paper?.edition_sha256 || paper?.sha256;
    if (!firstPageReady || !editionUuid || !pdfHash) return undefined;

    let cancelled = false;
    let timer = null;
    // Back off as the wait goes on: a short paper is ready in a second, a
    // long one takes a minute, and neither should be asked about every
    // second for a minute.
    let wait = 1500;

    const ask = () => {
      getViewerReferences(pdfHash, editionUuid)
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
  }, [firstPageReady, paper]);

  useEffect(() => {
    localStorage.setItem('papol_viewer_rail_width', String(railWidth));
  }, [railWidth]);

  useEffect(() => {
    if (source?.annotationsRequireNook) return;
    localStorage.setItem('papol_viewer_tool', tool);
  }, [source, tool]);

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
      if (e.key === 'Escape' && returnPillNotice) {
        e.preventDefault();
        setReturnPillNotice(false);
        return;
      }
      if (e.key === 'Escape' && paperPopupOpen) {
        e.preventDefault();
        setPaperInfoOpen(false);
        setNookPromptOpen(false);
        setPdfViewerTip(false);
        return;
      }
      if (e.key === 'Escape' && sendSelection) {
        e.preventDefault();
        closeSendSelection();
        return;
      }
      if (e.key === 'Escape' && selectedClipUuid != null) {
        e.preventDefault();
        setSelectedClipUuid(null);
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
      // A viewer in Papol's main window can return to the library. Native
      // document windows use the standard Close Window command instead.
      if (DESKTOP && !DOCUMENT_WINDOW && (MAC ? e.metaKey : e.ctrlKey) && !e.altKey && !e.shiftKey && e.key === '[') {
        e.preventDefault();
        returnToPapol();
        return;
      }
      const historyDirection = linkHistoryDirection(e);
      if (historyDirection) {
        e.preventDefault();
        moveThroughLinks(historyDirection);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        setSheet(null);
        takeTool('arrow');
        return;
      }
      if (selectedClipUuid != null && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        removeClip(selectedClipUuid);
        return;
      }
      if (selectedInk && (
        e.key.toLowerCase() === 'd' ||
        e.key === 'Delete' ||
        e.key === 'Backspace'
      )) {
        const selected = inkRef.current.find((stroke) => (
          selectedInk.groupUuid
            ? stroke.group_uuid === selectedInk.groupUuid
            : stroke.uuid === selectedInk.uuid
        ));
        if (selected) {
          e.preventDefault();
          setSelectedInk(null);
          eraseStroke(selected.uuid);
        }
        return;
      }
      // Keys are looked up by their lower case, so shifted shortcuts still
      // choose the same tool.
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
      if (!event.target.closest?.('.ink-grab') && !event.target.closest?.('.ink-actions')) setSelectedInk(null);
      if (!event.target.closest?.('.paper-clip') && !event.target.closest?.('.clip-actions')) setSelectedClipUuid(null);
    };
    document.addEventListener('pointerdown', clearInkSelection, true);
    return () => document.removeEventListener('pointerdown', clearInkSelection, true);
  }, []);

  useEffect(() => {
    // A file opened from disk has no edition until it joins a nook.
    if ((!paper?.edition_uuid && !paper?.opened_file) || !source?.clips) return undefined;
    let cancelled = false;
    source.clips.list(paper.edition_uuid)
      .then((loaded) => { if (!cancelled) setClips(loaded); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [paper?.edition_uuid, source]);

  // The ink already on this edition. Like the references, it belongs to
  // the file rather than to the paper, so it is asked for once the paper
  // has said which edition is open.
  useEffect(() => {
    if (!paper || !source?.ink) return undefined;
    let cancelled = false;
    source.ink
      .list(paper.edition_uuid)
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

  const referencesByUuid = useMemo(
    () => new Map((analysis?.references || []).map((r) => [r.uuid, r])),
    [analysis]
  );

  // Opening a citation. What is already known is shown at once — the raw
  // reference always, and the looked-up work if anyone has opened this
  // reference before — and the lookup fills the rest in.
  const openReference = (referenceUuid, anchor, inlineReference = null, referenceUuids = null) => {
    const known = referencesByUuid.get(referenceUuid) || inlineReference || null;
    const ids = referenceUuids?.length ? referenceUuids : [referenceUuid];
    setOpenCite({ referenceUuid, referenceUuids: ids, index: Math.max(0, ids.indexOf(referenceUuid)), anchor });
    setReference(known);
    setReferenceError(null);
    // A PDF-native `cite.*` destination is recognizable before server-side
    // analysis has assigned it a database uuid. Read the printed bibliography
    // entry straight from the PDF so its card is useful without waiting for
    // that analysis or an external metadata service.
    if (String(referenceUuid).startsWith('pdf:')) {
      if (doc && inlineReference?.dest) {
        readNamedReference(doc, inlineReference.dest)
          .then(async (raw) => {
            if (!raw) {
              setReference((current) => current?.uuid === referenceUuid
                ? { ...current, resolved_status: 'error' }
                : current);
              setReferenceError('Reference unreadable.');
              return;
            }
            setReference((current) => current?.uuid === referenceUuid
              ? { ...current, raw, resolved_status: 'resolving' }
              : current);
            if (!paper?.edition_uuid) return;
            const pdfHash = paper.edition_sha256 || paper.sha256;
            const full = await resolveViewerReference(pdfHash, {
              key: inlineReference.key,
              raw,
            });
            setReference((current) => current?.uuid === referenceUuid ? full : current);
          })
          .catch(() => {
            // The card is already open. An unusual PDF text layout should
            // not turn a citation click into an error or a bibliography jump.
            setReference((current) => current?.uuid === referenceUuid
              ? { ...current, resolved_status: current.raw ? 'pdf_text' : 'error' }
              : current);
          });
      }
      return;
    }
    // Show a cached answer immediately, and ask the item endpoint, which
    // looks the reference up the first time anyone opens it.
    getViewerReference(referenceUuid)
      .then((full) => {
        setReference((current) =>
          current && current.uuid !== referenceUuid ? current : full
        );
        // Keep it, so opening the same marker again costs nothing.
        setAnalysis((prev) =>
          prev
            ? {
                ...prev,
                references: prev.references.map((r) => (r.uuid === full.uuid ? full : r)),
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
    const scroller = scrollerRef.current;
    const pageEl = scroller?.querySelector(`[data-page="${page}"]`);
    if (!scroller || !pageEl) return;
    const from = scroller.scrollTop;
    const viewBeforeJump = currentView();
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
      // The lesson on getting back belongs to the first time there is
      // somewhere to get back to, beside the pill that does it.
      // Where storage is unavailable the lesson cannot be remembered, but it
      // is still useful for this visit.
      if (!isFeatureStateSet(LINK_NAVIGATION_TIP)) {
        setFeatureState(LINK_NAVIGATION_TIP, true);
        setLearnLinkNavigation(true);
      }
    }
  };

  // A place in the document: where it was scrolled, at what zoom, and the
  // page being read there, so the way back to it can be named by its page.
  const currentView = () => {
    const scroller = scrollerRef.current;
    if (!scroller) return null;
    const box = scroller.getBoundingClientRect();
    const pages = [...scroller.querySelectorAll('.pdf-page[data-page]')].map((el) => {
      const rect = el.getBoundingClientRect();
      return { page: Number(el.dataset.page), top: rect.top, bottom: rect.bottom };
    });
    const page = pageAtLine(box.top + box.height * 0.3, pages);
    return { top: scroller.scrollTop, left: scroller.scrollLeft, scale, page };
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

  // Hiding the return pill is for good, in this browser: the reader has
  // said they do not want it, so later jumps do not bring it back. What
  // they lose is only the button — [ and ] still move through the jumps,
  // and the note that confirms the choice says so.
  const hideReturnPill = () => {
    setReturnPillHidden(true);
    setReturnPillNotice(true);
    setLearnLinkNavigation(false);
    // Unremembered, the choice still holds for this visit.
    setFeatureState(RETURN_PILL_HIDDEN, true);
  };

  const showReturnPill = () => {
    setReturnPillHidden(false);
    setReturnPillNotice(false);
    setFeatureState(RETURN_PILL_HIDDEN, false);
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
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!doc || !el) return undefined;
    let gone = false;
    let pageWidth = defaultPageSize?.width ?? null;

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

    fit();

    window.addEventListener('resize', fit);
    return () => {
      gone = true;
      window.removeEventListener('resize', fit);
    };
  }, [doc, defaultPageSize]);

  useEffect(() => {
    if (scale == null) return;
    markViewerPerformance('layout-ready', { scale });
  }, [scale]);

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
            n.anchor != null && paper != null && n.edition_uuid !== paper.edition_uuid,
        }))
        .sort(
          (a, b) =>
            (a.page ?? Infinity) - (b.page ?? Infinity) ||
            String(a.created_at).localeCompare(String(b.created_at)) ||
            String(a.uuid).localeCompare(String(b.uuid))
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
      selectedInk.groupUuid
        ? stroke.group_uuid === selectedInk.groupUuid
        : stroke.uuid === selectedInk.uuid
    )).map((stroke) => stroke.page));
  }, [ink, selectedInk]);

  // A stroke appears the instant the pointer lifts and is saved behind it.
  // Waiting for the server first would make the brush feel like it was
  // dragging something heavy; if the save fails the stroke is taken back,
  // which is the honest thing to do with a mark that was not kept.
  const drawStroke = async (stroke, record = true) => {
    if (await promptToAddForAnnotations()) return null;
    if (!source?.ink) return;
    const provisional = `wet-${++tempInkUuid.current}`;
    setInk((all) => [...all, { ...stroke, uuid: provisional }]);
    const saving = source.ink.create(paper?.edition_uuid, stroke);
    inkSaving.current.set(provisional, saving);
    try {
      const saved = await saving;
      setInk((all) => all.map((s) => (s.uuid === provisional ? saved : s)));
      if (record && saved) {
        const entry = { uuid: saved.uuid, stroke };
        remember({
          undo: async () => eraseStroke(entry.uuid, false),
          redo: async () => {
            const restored = await drawStroke(entry.stroke, false);
            entry.uuid = restored.uuid;
          },
        });
      }
      return saved;
    } catch (err) {
      setInk((all) => all.filter((s) => s.uuid !== provisional));
      setError(err.message || 'Stroke not saved.');
    } finally {
      inkSaving.current.delete(provisional);
    }
    return null;
  };

  // A browser selection is a collection of visual line fragments, sometimes
  // spanning columns or pages. Capture it into page-relative geometry as soon
  // as the drag finishes. Off-screen PDF text layers are rebuilt while the
  // reader scrolls, which invalidates a native Range; Papol's snapshot remains
  // selected until the reader starts another selection or uses an action.
  useEffect(() => {
    let pointerSelecting = false;
    let finishFrame = null;
    const update = () => {
      const selection = window.getSelection();
      const scroller = scrollerRef.current;
      if (!selection || selection.isCollapsed || !selection.rangeCount || !scroller) return;
      const elementFor = (node) =>
        node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      const anchor = elementFor(selection.anchorNode);
      const focusNode = elementFor(selection.focusNode);
      if (!anchor?.closest('.textLayer') || !focusNode?.closest('.textLayer')) return;
      const rects = [...selection.getRangeAt(0).getClientRects()];
      const usable = rects.filter((rect) => rect.width > 0.5 && rect.height > 1);
      if (!usable.length) return;
      const pageBoxes = [...scroller.querySelectorAll('.pdf-page')].map((page) => ({
        page: Number(page.dataset.page),
        box: page.getBoundingClientRect(),
      }));
      const strokes = selectionStrokes(usable, pageBoxes);
      if (!strokes.length) return;
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
      // The snapshot above now owns both the text and its page geometry. Do
      // not leave the browser Range attached to text-layer nodes that will be
      // discarded when this page scrolls out of the render window.
      selection.removeAllRanges();
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
  }, [doc, scale, paper?.edition_uuid, source]);

  // Every stroke of the paint mark in hand.
  const selectedStrokes = useMemo(() => (selectedInk
    ? ink.filter((stroke) => (
      selectedInk.groupUuid ? stroke.group_uuid === selectedInk.groupUuid : stroke.uuid === selectedInk.uuid
    ))
    : []), [ink, selectedInk]);

  // A selected paint mark offers to be removed, or to send the text under it
  // to a board. The text is worked out from the mark's shape and the text
  // layers of its pages (paintText.js); PdfPage builds those for a selected
  // mark even where scrolling has kept them waiting, so this waits for them.
  const [inkActions, setInkActions] = useState(null);
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!selectedStrokes.length || !scroller) {
      setInkActions(null);
      return undefined;
    }
    let cancelled = false;
    let frame = null;
    const pageElement = (n) => scroller.querySelector(`.pdf-page[data-page="${n}"]`);
    const pageSize = (el) => ({ width: Number(el.dataset.pageWidth), height: Number(el.dataset.pageHeight) });

    // Beside the end of the mark: above it where there is room, as a
    // selection's actions sit.
    const last = selectedStrokes[selectedStrokes.length - 1];
    const lastPage = pageElement(last.page);
    if (!lastPage) {
      setInkActions(null);
      return undefined;
    }
    const size = pageSize(lastPage);
    const pageBox = lastPage.getBoundingClientRect();
    const bounds = markBounds(last, size);
    const right = pageBox.left + (bounds.right / size.width) * pageBox.width;
    const top = pageBox.top + (bounds.top / size.height) * pageBox.height;
    const bottom = pageBox.top + (bounds.bottom / size.height) * pageBox.height;
    const scrollerBox = scroller.getBoundingClientRect();
    const above = top - 38;
    const position = {
      left: Math.max(22, Math.min(window.innerWidth - 22, right)) - scrollerBox.left + scroller.scrollLeft,
      top: (above >= 8 ? above : Math.min(window.innerHeight - 44, bottom + 8)) - scrollerBox.top + scroller.scrollTop,
    };
    setInkActions({ ...position, text: null, bands: [] });

    const pageNumbers = [...new Set(selectedStrokes.map((stroke) => stroke.page))].sort((a, b) => a - b);
    const began = performance.now();
    const readText = () => {
      if (cancelled) return;
      const elements = pageNumbers.map(pageElement);
      if (!elements.every((el) => el?.dataset.text) && performance.now() - began < 4000) {
        frame = requestAnimationFrame(readText);
        return;
      }
      const pages = new Map();
      const characters = [];
      pageNumbers.forEach((n, index) => {
        const el = elements[index];
        if (!el?.dataset.text) return;
        const pageUnits = pageSize(el);
        pages.set(n, pageUnits);
        const within = selectedStrokes
          .filter((stroke) => stroke.page === n)
          .map((stroke) => markBounds(stroke, pageUnits))
          .reduce((a, b) => ({
            left: Math.min(a.left, b.left),
            right: Math.max(a.right, b.right),
            top: Math.min(a.top, b.top),
            bottom: Math.max(a.bottom, b.bottom),
          }));
        characters.push(...pageCharacters(el, within));
      });
      const { text, bands } = textUnderMarks(characters, selectedStrokes, pages);
      setInkActions((current) => current && { ...current, text: cleanExcerptText(text), bands });
    };
    readText();
    return () => {
      cancelled = true;
      if (frame != null) cancelAnimationFrame(frame);
    };
  }, [selectedStrokes, scale]);

  const removeSelectedInk = () => {
    const [first] = selectedStrokes;
    if (!first) return;
    setSelectedInk(null);
    eraseStroke(first.uuid);
  };

  const openSendPaint = () => {
    if (!inkActions?.text || !inkActions.bands.length) return;
    const { text, bands } = inkActions;
    setSelectedInk(null);
    openSendText(text, bands);
  };

  const paintSelection = async () => {
    if (!selectionPaint) return;
    if (await promptToAddForAnnotations()) return;
    const groupUuid = crypto.randomUUID();
    const specs = selectionPaint.strokes.map((fragment) => ({
        ...fragment,
        group_uuid: groupUuid,
        color: inkColor,
        opacity: inkOpacity,
        shape: 'flat',
      }));
    window.getSelection()?.removeAllRanges();
    setSelectionPaint(null);
    const results = await Promise.all(specs.map((stroke) => drawStroke(stroke, false)));
    const entries = results
      .map((stroke, index) => stroke && ({ uuid: stroke.uuid, stroke: specs[index] }))
      .filter(Boolean);
    if (!entries.length) return;
    remember({
      undo: async () => Promise.all(entries.map((entry) => eraseStroke(entry.uuid, false))),
      redo: async () => {
        const restored = await Promise.all(
          entries.map((entry) => drawStroke(entry.stroke, false))
        );
        restored.forEach((stroke, index) => { entries[index].uuid = stroke.uuid; });
      },
    });
  };

  const closeSendSelection = () => {
    setSendSelection(null);
    setSendBoards([]);
    setSendBoardUuid('');
    setSendError(null);
    setSendComplete(false);
  };

  const openSendSelection = () => {
    if (!selectionPaint?.text) return;
    if (source?.annotationsRequireNook) {
      void promptToAddForAnnotations();
      return;
    }
    const { text, strokes } = selectionPaint;
    window.getSelection()?.removeAllRanges();
    setSelectionPaint(null);
    openSendText(text, strokes);
  };

  // The send sheet for text and the line bands it sits in: what a selection,
  // or a paint mark, sends to a board. The bands become the backlink's
  // highlight.
  const openSendText = async (text, strokes) => {
    const first = strokes[0];
    setSendSelection({
      text: cleanExcerptText(text),
      comment: '',
      page: first.page,
      y: first.points[0]?.y ?? 0.5,
      strokes,
    });
    setSendError(null);
    setSendComplete(false);
    try {
      const boards = await listBoards();
      setSendBoards(boards);
      setSendBoardUuid(boards[0]?.uuid || '');
    } catch (e) {
      setSendError(e.status === 401 ? 'Sign in to send excerpts to a board.' : e.message);
    }
  };

  const sendSelectionToBoard = async () => {
    if (!sendSelection || !sendBoardUuid || (sendSelection.kind !== 'clip' && !sendSelection.text.trim())) return;
    setSendBusy(true);
    setSendError(null);
    // The desktop viewer itself has a tauri:// URL, which the backend rejects
    // (and which would be useless outside this Mac). Keep board backlinks on
    // the canonical hosted viewer while preserving the current paper query.
    const viewerPath = window.location.pathname.includes('/demo/viewer')
      ? '/demo/viewer/'
      : '/viewer/';
    const backlink = new URL(backendPath(viewerPath), window.location.href);
    backlink.search = window.location.search;
    backlink.hash = window.location.hash;
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
      const sourceLabel = `${paper?.title || 'Paper'}, page ${sendSelection.page}`;
      if (sendSelection.kind === 'clip') {
        await stageBoardClip(sendBoardUuid, {
          blob: sendSelection.blob,
          comment: sendSelection.comment.trim(),
          sourceUrl: backlink.href,
          sourceLabel,
        });
      } else {
        await stageBoardExcerpt(sendBoardUuid, {
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

  // The uuid the server knows this stroke by, waiting for it if the stroke is
  // still on its way there.
  //
  // Rubbing out a stroke drawn a moment ago used to send its temporary uuid
  // to the server, which refused it — and refusing is not a 404, so the
  // stroke was put back. Worse, the save landing in the meantime tried to
  // swap the temporary uuid for the real one on a list the stroke had already
  // been taken out of, so it came back wearing a name the server had never
  // heard of and could not be erased again until the page was reloaded.
  // Which is exactly what it looked like from the outside.
  const settledInkUuid = async (uuid) => {
    if (!String(uuid).startsWith('wet-')) return uuid;
    const saving = inkSaving.current.get(uuid);
    if (!saving) return null;
    try {
      return (await saving)?.uuid ?? null;
    } catch {
      return null; // it was never saved, so there is nothing to erase
    }
  };

  // Carried on screen as it is dragged and written down when it is put
  // down, so the page keeps up with the hand and the server hears once.
  const moveStroke = async (uuid, points, record = true) => {
    if (!source?.ink?.move) return;
    const was = inkRef.current.find((s) => s.uuid === uuid);
    if (!was) return;
    const members = was.group_uuid
      ? inkRef.current.filter((s) => s.group_uuid === was.group_uuid)
      : [was];
    const dx = points[0].x - was.points[0].x;
    const dy = points[0].y - was.points[0].y;
    const clamp = (value) => Math.min(1, Math.max(0, value));
    const moves = members.map((stroke) => ({
      uuid: stroke.uuid,
      before: stroke.points,
      after: stroke.uuid === uuid
        ? points
        : stroke.points.map((point) => ({
            x: clamp(point.x + dx),
            y: clamp(point.y + dy),
          })),
    }));
    const movedByUuid = new Map(moves.map((move) => [move.uuid, move.after]));
    setInk((all) => all.map((stroke) => (
      movedByUuid.has(stroke.uuid)
        ? { ...stroke, points: movedByUuid.get(stroke.uuid) }
        : stroke
    )));
    try {
      const saved = await Promise.all(moves.map(async (move) => {
        const real = await settledInkUuid(move.uuid);
        return real == null ? null : source.ink.move(real, move.after);
      }));
      const savedByUuid = new Map(
        saved.map((stroke, index) => stroke && [moves[index].uuid, stroke]).filter(Boolean)
      );
      setInk((all) => all.map((stroke) => savedByUuid.get(stroke.uuid) || stroke));
      if (record && saved.some(Boolean)) {
        const first = moves[0];
        remember({
          undo: () => moveStroke(first.uuid, first.before, false),
          redo: () => moveStroke(first.uuid, first.after, false),
        });
      }
      return saved.find((stroke) => stroke?.uuid === uuid) || saved.find(Boolean);
    } catch (err) {
      const beforeByUuid = new Map(moves.map((move) => [move.uuid, move.before]));
      setInk((all) => all.map((stroke) => (
        beforeByUuid.has(stroke.uuid)
          ? { ...stroke, points: beforeByUuid.get(stroke.uuid) }
          : stroke
      )));
      setError(err.message || 'Stroke not moved.');
    }
  };

  const eraseStroke = async (uuid, record = true) => {
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
    // stayed in here for the life of the page. SQLite hands out the uuid of
    // the last row again when that row has been deleted, so the next stroke
    // drawn after erasing one is very often given the same number — and
    // arrived already on the list of things not to erase. It could not be
    // rubbed out at all until the page was reloaded, which emptied the set.
    // That is the bug this looked like from the outside, and an uuid is the
    // server's business anyway: nothing here should assume one is never
    // used twice.
    if (erasing.current.has(uuid)) return;
    // Whatever the eraser was over, it was over: the page is rendering it,
    // which is a better witness than this render's copy of the list.
    const target = inkRef.current.find((s) => s.uuid === uuid);
    const gone = target?.group_uuid
      ? inkRef.current.filter((s) => s.group_uuid === target.group_uuid)
      : target ? [target] : [];
    if (!gone.length) return;
    const goneUuids = new Set(gone.map((stroke) => stroke.uuid));
    gone.forEach((stroke) => erasing.current.add(stroke.uuid));
    setInk((all) => all.filter((s) => !goneUuids.has(s.uuid)));
    try {
      const realUuids = await Promise.all(gone.map((stroke) => settledInkUuid(stroke.uuid)));
      await Promise.all(realUuids.filter((real) => real != null).map((real) => source.ink.remove(real)));
      if (record) {
        const entries = gone.map((stroke, index) => ({
          uuid: realUuids[index],
          stroke: (({ uuid: _id, ...spec }) => spec)(stroke),
        }));
        remember({
          undo: async () => {
            const restored = await Promise.all(
              entries.map((entry) => drawStroke(entry.stroke, false))
            );
            restored.forEach((stroke, index) => { entries[index].uuid = stroke.uuid; });
          },
          redo: () => eraseStroke(entries[0].uuid, false),
        });
      }
    } catch (err) {
      // A stroke the server does not have is a stroke that is gone, which
      // is what was wanted; anything else is a failure worth undoing.
      if (err.status === 404) return;
      setInk((all) => [...all, ...gone]);
      setError(err.message || 'Stroke not erased.');
    } finally {
      gone.forEach((stroke) => erasing.current.delete(stroke.uuid));
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
    if (!animalFollow || placedAnimals.length === 0) {
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

    // Binary-search the vertically ordered sheets: a handful of rectangle
    // reads. Asking the browser what is under the pointer instead
    // (elementFromPoint) hit-tests every span of every text layer — about
    // 4ms a zoom frame in WebKit on a text-dense paper, against almost
    // nothing for the reads.
    const pages = el.querySelectorAll('.pdf-page');
    const boxes = new Map();
    const boxFor = (index) => {
      if (!boxes.has(index)) boxes.set(index, pages[index].getBoundingClientRect());
      return boxes.get(index);
    };
    let pageEl = null;
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

  // The zoom a gesture has reached. While fingers move it runs ahead of
  // `scale`: each frame goes straight into the pages' geometry, and the rest
  // of the viewer — React, and every effect that reads the zoom — hears of
  // it once, when the gesture pauses, which is also when the pages are
  // redrawn sharp.
  const liveScale = useRef(null);
  const zoomCommit = useRef(null);
  // The spot a gesture zooms about, held while the pointer stays put:
  // measured again every frame, each scroll position's rounding would be
  // taken for movement and the page would creep out from under the pointer.
  const gestureFocus = useRef(null);

  // Page geometry for a zoom: three style values a page, straight onto the
  // DOM, so React does not reconcile every stroke, pin, clip and link on
  // every sheet for a scale-only change. PdfPage's memo comparator mirrors
  // this boundary.
  const applyScale = (value) => {
    const el = scrollerRef.current;
    if (!el || value == null) return;
    el.dataset.scale = String(value);
    for (const pageEl of el.querySelectorAll('.pdf-page')) {
      const width = Number(pageEl.dataset.pageWidth);
      const height = Number(pageEl.dataset.pageHeight);
      const drawnAt = Number(pageEl.dataset.renderScale);
      if (!width || !height) continue;
      pageEl.style.width = `${width * value}px`;
      pageEl.style.height = `${height * value}px`;
      const inner = pageEl.querySelector(':scope > .page-inner');
      if (inner && drawnAt) inner.style.transform = value === drawnAt ? '' : `scale(${value / drawnAt})`;
    }
  };

  // Scroll so a spot captured by captureFocus is back under the point it
  // was taken at.
  const keepFocus = (f) => {
    const el = scrollerRef.current;
    const pageEl = f && el?.querySelector(`[data-page="${f.page}"]`);
    if (!pageEl) return;
    const r = pageEl.getBoundingClientRect();
    el.scrollLeft += r.left + f.fx * r.width - f.cx;
    el.scrollTop += r.top + f.fy * r.height - f.cy;
  };

  // Commits the zoom a gesture reached once input has paused for
  // ZOOM_SETTLE_MS — counted from the last event, not the last frame, so one
  // slow frame in the middle of a pinch is not taken for the fingers
  // stopping.
  const armZoomCommit = () => {
    window.clearTimeout(zoomCommit.current);
    zoomCommit.current = window.setTimeout(function commit() {
      if (pendingZoom.current.frame != null) {
        zoomCommit.current = window.setTimeout(commit, ZOOM_SETTLE_MS);
        return;
      }
      zoomCommit.current = null;
      gestureFocus.current = null;
      // Text comes back once the view is still. There is nothing in it to
      // see, and showing a dense paper's text again repaints it — tens of
      // milliseconds, which here fall where nothing is moving.
      pageRenderQueue().quiet().then(() => {
        if (zoomCommit.current == null) scrollerRef.current?.classList.remove('zooming');
      });
      if (liveScale.current == null) return;
      // The gesture has paused: the viewer takes the zoom, and the pages
      // are redrawn sharp now rather than after a further wait.
      setScale(liveScale.current);
      setRenderScale(liveScale.current);
    }, ZOOM_SETTLE_MS);
  };

  const zoomBy = (factor, at) => {
    const el = scrollerRef.current;
    if (!el) return;
    chosenZoom.current = true;
    const pending = pendingZoom.current;
    pending.factor *= factor;
    pending.at = at;
    armZoomCommit();
    // A pinch is the reader moving the page as much as a scroll is: work
    // that waits for stillness (text layers, detail) waits for this too.
    pageRenderQueue().scrolled();
    if (pending.frame != null) return;
    // Browsers can deliver several wheel events inside one display frame.
    // Accumulate them and apply one geometry change for that frame.
    pending.frame = requestAnimationFrame(() => {
      pending.frame = null;
      const combinedFactor = pending.factor;
      const latestAt = pending.at;
      pending.factor = 1;
      pending.at = null;
      const from = liveScale.current;
      const next = from == null ? null : clampScale(from * combinedFactor);
      if (next == null || next === from) return;
      const held = gestureFocus.current;
      const captured = held && latestAt && Math.abs(held.cx - latestAt.x) < 2 && Math.abs(held.cy - latestAt.y) < 2
        ? held
        : captureFocus(latestAt);
      if (!captured) return;
      gestureFocus.current = captured;
      liveScale.current = next;
      // Text layers are hidden until the gesture pauses (.zooming, styles.js).
      el.classList.add('zooming');
      applyScale(next);
      keepFocus(captured);
    });
  };

  useEffect(() => () => window.clearTimeout(zoomCommit.current), []);

  useLayoutEffect(() => {
    // A gesture still under way owns the geometry, and this commit is
    // already behind it.
    if (zoomCommit.current != null || scale == null) return;
    liveScale.current = scale;
    applyScale(scale);
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
    keepFocus(f);
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
    if (source?.annotationsRequireNook) {
      void promptToAddForAnnotations();
      return null;
    }
    // Counted, not clocked. This was -Date.now(), so two anchors dropped in
    // the same millisecond took the same temporary uuid: two notes with one
    // key, and a `pending` entry for the second standing in for the first,
    // whose real uuid could then never be found — leaving an anchor that
    // could not be moved, renamed or deleted until the page was reloaded.
    // Negative still, so it can never be mistaken for one of the server's.
    const tempUuid = -(tempNoteUuid.current += 1);
    const optimistic = {
      uuid: tempUuid,
      ...spot,
      anchor_type: spot.anchor.type,
      content: '',
      created_at: new Date().toISOString(),
    };
    setNotes((prev) => [...prev, optimistic]);
    setActiveNoteUuid(tempUuid);

    const saving = source.notes
      .create({ ...spot, content: '' })
      .then((saved) => {
        setNotes((prev) => prev.map((n) => (n.uuid === tempUuid ? saved : n)));
        setActiveNoteUuid((uuid) => (uuid === tempUuid ? saved.uuid : uuid));
        const entry = { uuid: saved.uuid, snapshot: saved };
        remember({
          undo: () => removeNote(entry.uuid, false),
          redo: async () => {
            const restored = await restoreNote(entry.snapshot);
            entry.uuid = restored.uuid;
          },
        });
        return saved;
      })
      .catch((e) => {
        // Nothing was saved, so the mark should not linger.
        setNotes((prev) => prev.filter((n) => n.uuid !== tempUuid));
        pending.current.delete(tempUuid);
        setError(e.message);
        return null;
      });
    pending.current.set(tempUuid, saving);
    return tempUuid;
  };

  // Picking up an anchor remembers what was put down for it, so that
  // dropping one in the middle of marking a paper up does not cost the
  // brush that was in hand.
  const takeTool = (picked) => {
    if (ANNOTATION_TOOLS.has(picked) && source?.annotationsRequireNook) {
      void promptToAddForAnnotations();
      return;
    }
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
    if (await promptToAddForAnnotations()) return;
    const provisional = `clip-${Date.now()}`;
    setClips((all) => [...all, { ...clip, uuid: provisional }]);
    // A clipper is a one-shot form of the reading cursor. Put it down as
    // soon as the rectangle lands; persistence must not keep it in hand.
    setTool('arrow');
    toolBefore.current = null;
    try {
      const saving = source.clips.create(paper.edition_uuid, clip);
      clipSaving.current.set(provisional, saving);
      const saved = await saving;
      setClips((all) => all.map((candidate) => (
        candidate.uuid === provisional ? { ...saved, frame: candidate.frame } : candidate
      )));
      setSelectedClipUuid((selected) => (selected === provisional ? saved.uuid : selected));
    } catch (e) {
      setClips((all) => all.filter((candidate) => candidate.uuid !== provisional));
      setError(e.message);
    } finally {
      clipSaving.current.delete(provisional);
    }
  };

  const settledClipUuid = async (uuid) => {
    const saving = clipSaving.current.get(uuid);
    return saving ? (await saving).uuid : uuid;
  };

  const updateClip = (uuid, change) => {
    setClips((all) => all.map((clip) => (clip.uuid === uuid ? { ...clip, ...change } : clip)));
  };

  const commitClip = async (uuid, change) => {
    try {
      const realUuid = await settledClipUuid(uuid);
      const current = clips.find((clip) => clip.uuid === uuid || clip.uuid === realUuid);
      const frame = change.frame || current?.frame;
      const floating = change.floating ?? current?.floating ?? false;
      const saved = await source.clips.move(realUuid, frame, floating);
      setClips((all) => all.map((clip) => (
        clip.uuid === uuid || clip.uuid === realUuid ? saved : clip
      )));
    } catch (e) {
      setError(e.message);
    }
  };

  const removeClip = async (uuid) => {
    setSelectedClipUuid((selected) => (selected === uuid ? null : selected));
    setClips((all) => all.filter((clip) => clip.uuid !== uuid));
    try {
      await source.clips.remove(await settledClipUuid(uuid));
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
      setSendBoardUuid(boards[0]?.uuid || '');
    } catch (e) {
      setSendError(e.status === 401 ? 'Sign in to send excerpts to a board.' : e.message);
    }
  };

  // Editing, moving or deleting an anchor that is still in flight waits for
  // its real uuid rather than failing.
  const settledUuid = async (uuid) => {
    // Temporary anchors wear negative numbers; saved ones, their UUID.
    if (typeof uuid !== 'number') return uuid;
    const saved = await pending.current.get(uuid);
    return saved ? saved.uuid : null;
  };

  // Dragging a pin moves the anchor; the words it carries are untouched.
  const moveNote = async (uuid, spot, record = true) => {
    const was = notesRef.current.find((note) => note.uuid === uuid);
    setNotes((prev) => prev.map((n) => (n.uuid === uuid ? { ...n, ...spot } : n)));
    try {
      const real = await settledUuid(uuid);
      if (real == null) return;
      const saved = await source.notes.move(real, spot);
      if (saved) setNotes((prev) => prev.map((n) => (n.uuid === real ? saved : n)));
      if (record && was && saved) {
        remember({
          undo: () => moveNote(saved.uuid, { page: was.page, anchor: was.anchor }, false),
          redo: () => moveNote(saved.uuid, spot, false),
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
    setNotes((prev) => prev.map((n) => (n.uuid === note.uuid ? { ...n, name } : n)));
    try {
      const real = await settledUuid(note.uuid);
      if (real == null) return;
      const saved = await source.notes.rename(real, name);
      if (saved) setNotes((prev) => prev.map((n) => (n.uuid === real ? saved : n)));
      if (record && saved) {
        remember({
          undo: () => renameNote(saved.uuid, note.name || '', false),
          redo: () => renameNote(saved.uuid, name, false),
        });
      }
    } catch (e) {
      setError(e.message);
    }
  };

  const label = (note) =>
    naming === note.uuid ? (
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
          startNaming(note);
        }}
      >
        {note.name || (note.anchor ? `page ${note.page}` : 'not placed on the page')}
      </button>
    );

  const startNaming = (note) => {
    setNameDraft(note.name || '');
    setNaming(note.uuid);
  };

  // Clicking an anchor on the page says which entry it is: the row lights
  // up, scrolls into view, and fades back on its own.
  const flashTimer = useRef(null);
  const pointAtNote = (uuid) => {
    if (uuid == null) {
      setActiveNoteUuid(null);
      setFlashUuid(null);
      clearTimeout(flashTimer.current);
      return;
    }
    setActiveNoteUuid(uuid);
    setRailOpen(true);
    setFlashUuid(uuid);
    clearTimeout(flashTimer.current);
    // A shade longer than the 5s fade in styles.js, so the class outlives
    // the animation rather than cutting it short.
    flashTimer.current = setTimeout(() => setFlashUuid(null), 6100);
    requestAnimationFrame(() => {
      document
        .querySelector(`.rail [data-note="${uuid}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  };

  const startWriting = (note) => {
    setEditing(note.uuid);
    setEditText(note.content || '');
    goToNote(note);
  };

  const updateNoteContent = async (uuid, content) => {
    const real = await settledUuid(uuid);
    if (real == null) return null;
    const updated = await source.notes.update(real, content);
    setNotes((prev) => prev.map((note) => (note.uuid === real ? updated : note)));
    return updated;
  };

  const renameNote = async (uuid, name, record = false) => {
    const note = notesRef.current.find((candidate) => candidate.uuid === uuid);
    const real = await settledUuid(uuid);
    if (real == null) return null;
    const saved = await source.notes.rename(real, name);
    if (saved) setNotes((prev) => prev.map((n) => (n.uuid === real ? saved : n)));
    if (record && note && saved) {
      remember({
        undo: () => renameNote(saved.uuid, note.name || '', false),
        redo: () => renameNote(saved.uuid, name, false),
      });
    }
    return saved;
  };

  const saveEdit = async (uuid, record = true) => {
    if (!editText.trim()) return;
    const before = notesRef.current.find((note) => note.uuid === uuid)?.content || '';
    const content = editText.trim();
    try {
      const updated = await updateNoteContent(uuid, content);
      setEditing(null);
      if (record && updated) {
        remember({
          undo: () => updateNoteContent(updated.uuid, before),
          redo: () => updateNoteContent(updated.uuid, content),
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
    if (snapshot.name) restored = await source.notes.rename(restored.uuid, snapshot.name);
    setNotes((prev) => [...prev, restored]);
    return restored;
  };

  const removeNote = async (uuid, record = true) => {
    const gone = notesRef.current.find((note) => note.uuid === uuid);
    setNotes((prev) => prev.filter((n) => n.uuid !== uuid));
    // Let go of it everywhere. SQLite hands out a deleted row's uuid again,
    // so a number kept here after the note it named has gone will one day
    // name a different note — and open its card, or light its row, for no
    // reason anyone could see.
    setActiveNoteUuid((open) => (open === uuid ? null : open));
    setFlashUuid((lit) => (lit === uuid ? null : lit));
    setDraggingNoteUuid((carried) => (carried === uuid ? null : carried));
    try {
      const real = await settledUuid(uuid);
      if (real != null) await source.notes.remove(real);
      if (record && gone) {
        const entry = { uuid: real, snapshot: gone };
        remember({
          undo: async () => {
            const restored = await restoreNote(entry.snapshot);
            entry.uuid = restored.uuid;
          },
          redo: () => removeNote(entry.uuid, false),
        });
      }
    } catch (e) {
      setError(e.message);
    }
  };

  const noteContextMenu = (event, note) => openContextMenu(event, [
    { label: 'Go to Anchor', onSelect: () => goToNote(note) },
    { label: note.content ? 'Edit Note…' : 'Add Note…', onSelect: () => startWriting(note) },
    { label: 'Rename Anchor…', onSelect: () => startNaming(note) },
    { separator: true },
    { label: 'Delete Anchor', onSelect: () => removeNote(note.uuid) },
    { separator: true },
    { label: 'Undo', shortcut: '⌘Z', disabled: history.current.running || history.current.undo.length === 0, onSelect: () => runHistory('undo') },
    { label: 'Redo', shortcut: '⇧⌘Z', disabled: history.current.running || history.current.redo.length === 0, onSelect: () => runHistory('redo') },
  ]);

  const pageContextMenu = contextMenuHandler((event) => event.target.closest?.('.pdf-page') ? [
    { label: 'Undo', shortcut: '⌘Z', disabled: history.current.running || history.current.undo.length === 0, onSelect: () => runHistory('undo') },
    { label: 'Redo', shortcut: '⇧⌘Z', disabled: history.current.running || history.current.redo.length === 0, onSelect: () => runHistory('redo') },
  ] : []);

  // Reading position is implicit: remember the point at the centre of the
  // viewport, in page coordinates, together with its zoom. Page coordinates
  // survive a different window size; raw scroll offsets do not.
  useLayoutEffect(() => {
    if (readingViewRestored.current || wantedNoteUuid || wantedPage || !doc || !scale) return;
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
  }, [doc, scale, wantedNoteUuid, wantedPage]);

  // Excerpts sent to a board link back to the selected line, without
  // needing to create a permanent anchor merely to preserve provenance.
  // Once for the document: a later zoom must not pull the reader back.
  const revealedWantedPage = useRef(null);
  useEffect(() => {
    const pageNumber = Number(wantedPage);
    if (!pageNumber || !doc || !scale || pageNumber > doc.numPages) return undefined;
    if (revealedWantedPage.current === doc) return undefined;
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
      revealedWantedPage.current = doc;
    };
    reveal();
    return () => {
      cancelled = true;
      if (frame != null) cancelAnimationFrame(frame);
    };
  }, [doc, scale, wantedPage, wantedY]);

  // Subscribed once the pages have a zoom, not again at every zoom: a zoom
  // moves the scroll position, and that is what saves.
  const hasScale = scale != null;
  useEffect(() => {
    const scroller = scrollerRef.current;
    const key = readingView.current.key;
    if (!scroller || !key || !doc || !hasScale) return undefined;
    let timer = null;
    const save = () => {
      if (!readingViewRestored.current && !wantedNoteUuid) return;
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
        scale: liveScale.current,
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
  }, [doc, hasScale, wantedNoteUuid]);

  // Arriving from a link to one note: show it, once the pages exist.
  useEffect(() => {
    if (!wantedNoteUuid || !doc || notes.length === 0) return;
    const note = notes.find((n) => String(n.uuid) === wantedNoteUuid);
    if (note) goToNoteWhenLaid(note);
  }, [wantedNoteUuid, doc, notes]);

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
    setActiveNoteUuid(note.uuid);
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


  // Once imported, leave the ephemeral file URL. The canonical nook viewer
  // is the only surface allowed to load or persist paper state.
  const addToNook = async () => {
    await hydrateCredential();
    if (!nativeDataActive()) {
      setNookStep('ask');
      setNookPromptOpen(true);
      return;
    }
    setNookStep('adding');
    setNookPromptOpen(false);
    try {
      await source.addToNook();
      const nookUrl = new URL(window.location.href);
      for (const key of [
        'file', 'name', 'opened_at_ms', 'native_read_ms', 'native_hash_ms',
      ]) nookUrl.searchParams.delete(key);
      window.location.assign(nookUrl.href);
    } catch (failure) {
      setNookStep('idle');
      setError(`Could not add this paper: ${messageOf(failure)}`);
    }
  };
  const addToNookOnceSignedIn = useEvent(addToNook);
  const askToSignIn = () => {
    setNookStep('waiting');
    setNookPromptOpen(true);
    requestSignIn().catch(() => setNookStep('ask'));
  };
  // Signing in happens in the library window. This window hears of it when
  // the account is written to shared storage, or when it is focused again.
  useEffect(() => {
    if (nookStep !== 'waiting') return undefined;
    const check = () => {
      if (nativeDataActive()) addToNookOnceSignedIn();
    };
    window.addEventListener('storage', check);
    window.addEventListener('focus', check);
    return () => {
      window.removeEventListener('storage', check);
      window.removeEventListener('focus', check);
    };
  }, [nookStep, addToNookOnceSignedIn]);

  const dismissPdfViewerTip = () => {
    try { localStorage.setItem(PDF_VIEWER_PROMPT_KEY, 'dismissed'); } catch { /* hide for now */ }
    setPdfViewerTip(false);
  };
  const makeDefaultPdfViewer = async () => {
    try {
      await makePdfViewerDefault();
    } catch (failure) {
      setError(messageOf(failure));
    }
    dismissPdfViewerTip();
  };

  const closeFeedback = () => {
    setFeedbackOpen(false);
    setFeedbackReportError(false);
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
        content: feedbackWithDiagnosticLog(
          feedbackContent,
          feedbackIncludeLog ? feedbackLog : '',
          appLimits.text.feedback,
        ),
        // Where the reporter was standing, so an admin can retrace it.
        page: window.location.pathname || '/viewer/',
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
    uuid: stroke.uuid,
    groupUuid: stroke.group_uuid || null,
  } : null));
  const pageHoverInk = useEvent((_page, objects) => {
    const wanted = new Set(objects);
    const pages = new Set();
    for (const stroke of inkRef.current) {
      const object = stroke.group_uuid ? `group:${stroke.group_uuid}` : `stroke:${stroke.uuid}`;
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
        <div className="shell">
          <div className="error">{error}</div>
          {!DOCUMENT_WINDOW && <p className="hint">
            <a
              href={source?.backHref || appPath('/')}
              onClick={(event) => {
                if (closeDesktopDocumentWindow()) {
                  event.preventDefault();
                } else {
                  markReturnToPapol();
                }
              }}
            >
              Back to Papol
            </a>
          </p>}
        </div>
      </>
    );
  }

  const pages = doc ? Array.from({ length: doc.numPages }, (_, i) => i + 1) : [];
  const initiallyVisiblePage = wantedPage || readingView.current.view?.page || 1;
  const mountedFilePages = materializedFilePages.doc === doc
    ? materializedFilePages.pages
    : FIRST_PAGE_ONLY;
  const pagePreviews = filePagePreviews.doc === doc
    ? filePagePreviews.urls
    : new Map();

  // A percentage once the server has said how big the file is; null while
  // that is still unknown, which reads as "under way" rather than "stuck
  // at zero".
  const pdfPct =
    pdfProgress && pdfProgress.total > 0
      ? Math.min(100, Math.round((pdfProgress.loaded / pdfProgress.total) * 100))
      : null;
  const openReferencePage = Number(openCite?.anchor?.closest?.('.pdf-page')?.dataset.page) || null;

  // Arriving from Papol, going back is a step back in history, not a new
  // entry — otherwise Papol's own Back walks the reader straight into the
  // viewer again. A direct visit has no Papol behind it, so it goes to the
  // paper's page instead.
  const returnToPapol = () => {
    // Papol Desktop opens papers as document windows. Closing that window
    // returns to the library that has remained mounted behind it.
    if (closeDesktopDocumentWindow()) return;
    markReturnToPapol();
    if (document.referrer.startsWith(window.location.origin) && window.history.length > 1) {
      window.history.back();
    } else {
      window.location.assign(source?.backHref || appPath('/'));
    }
  };
  // The document's own history, kept apart from the window's Back: the return
  // pill over the pages names the page each way leads to.
  const returnView = linkHistory.current.back[linkHistory.current.back.length - 1] || null;
  const onwardView = linkHistory.current.forward[linkHistory.current.forward.length - 1] || null;

  const learnLinkTip = learnLinkNavigation && (
    <span ref={learnLinkTipRef} className="learn-papol" role="dialog" aria-labelledby="learn-link-title">
      <span className="learn-papol-kicker">Learn Papol</span>
      <strong id="learn-link-title">Jump back to where you were</strong>
      <span>
        Use this pill after following a link, or press <kbd>[</kbd> and <kbd>]</kbd>
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
  );

  const beginRailResize = (event) => {
    if (window.innerWidth <= NARROW) return;
    event.preventDefault();
    const pointerId = event.pointerId;
    const handle = event.currentTarget;
    handle.setPointerCapture(pointerId);
    document.body.classList.add('resizing-rail');

    const move = (moveEvent) => {
      const available = Math.min(MAX_RAIL_WIDTH, window.innerWidth * 0.45);
      setRailWidth(clampRailWidth(Math.min(available, window.innerWidth - moveEvent.clientX)));
    };
    const finish = () => {
      document.body.classList.remove('resizing-rail');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('pointercancel', finish);
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    };

    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  };

  const resizeRailWithKeyboard = (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') return setRailWidth(MIN_RAIL_WIDTH);
    if (event.key === 'End') return setRailWidth(MAX_RAIL_WIDTH);
    setRailWidth((width) => clampRailWidth(width + (event.key === 'ArrowLeft' ? 16 : -16)));
  };

  return (
    <>
      <header
        className="viewer-bar"
        // Empty stretches of the bar move the window in Papol Desktop;
        // everywhere else the attribute is inert.
        data-tauri-drag-region="deep"
        // A tool taken with the pointer should not be left holding keyboard
        // focus. Nothing shows while the pointer is what moved, but the
        // moment a key is pressed the browser promotes that parked focus to
        // a ring around a tool that is no longer in hand.
        // Two selections, disagreeing. Focus that arrives by Tab is left
        // alone, so the bar is still walkable and still says where you are.
        onClick={(e) => {
          if (e.detail === 0) return;
          e.target.closest?.('button')?.blur();
        }}
      >
        {/* The bar is the window's navigation: back to Papol and a quick way
            to bring the library back to the front. */}
        {DESKTOP ? (
          <DesktopNav
            library={{ onClick: focusDesktopLibraryWindow, label: 'Open Library' }}
          />
        ) : !DESKTOP ? (
          // The href stays for a direct visit, and for opening in a new tab.
          <a
            className="back"
            href={source?.backHref || appPath('/')}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) {
                markReturnToPapol();
                return;
              }
              e.preventDefault();
              returnToPapol();
            }}
          >
            ← <span className="back-word">Back to </span>Papol
          </a>
        ) : null}
        <span className="spacer" />
        <DesktopSyncingStatus />
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
                    ? `${t.label} (V) — ${t.hint}. V again for colour and width`
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
              onClick={() => {
                setPaperInfoOpen((open) => !open);
                setNookPromptOpen(false);
                setPdfViewerTip(false);
              }}
              aria-expanded={paperInfoOpen}
              aria-haspopup="dialog"
            >
              <span className="info-glyph" aria-hidden="true">i</span> Info
            </button>
            {source?.openedFile && (
              paper.uuid ? (
                <button
                  type="button"
                  className="bar-link nook-add-button"
                  onClick={() => focusDesktopLibraryWindow(paper.uuid)}
                >
                  Show in nook
                </button>
              ) : (
                <button
                  type="button"
                  className="bar-link nook-add-button"
                  onClick={addToNook}
                  disabled={nookStep === 'adding'}
                >
                  {nookStep === 'adding' ? 'Adding…' : 'Add to nook'}
                </button>
              )
            )}
            {!source?.openedFile && !(DESKTOP && MAC) && <a
              className="bar-link"
              href={pdfHref(paper)}
              download={`${(paper.title || 'paper').replace(/[\\/:*?"<>|]/g, '-')}.pdf`}
              onClick={(event) => {
                // Desktop saves the copy already in its local store.
                if (!nativeDataActive()) return;
                event.preventDefault();
                const name = event.currentTarget.getAttribute('download');
                downloadablePdfHref(paper).then((href) => {
                  const link = document.createElement('a');
                  link.href = href;
                  link.download = name;
                  link.click();
                  setTimeout(() => URL.revokeObjectURL(href), 60_000);
                }).catch(() => {});
              }}
            >
              Download
            </a>}
            {nookPromptOpen && ['confirm', 'ask', 'waiting'].includes(nookStep) && (
              <div className="paper-info-pop nook-ask" role="dialog" aria-labelledby="nook-ask-title">
                <strong id="nook-ask-title">Add this paper to your nook</strong>
                <p>
                  {nookStep === 'waiting'
                    ? 'Continue in the Papol window. The paper is added as soon as you are signed in.'
                    : nookStep === 'confirm'
                      ? 'Notes, ink, clips and other paper state are available after this file is added to your nook.'
                      : 'Sign in first. Notes, ink and clips are available after the paper is added to your nook.'}
                </p>
                <div className="nook-ask-actions">
                  <button type="button" onClick={() => { setNookPromptOpen(false); setNookStep('idle'); }}>Not now</button>
                  <button
                    type="button"
                    className={nookStep === 'waiting' ? '' : 'primary'}
                    onClick={nookStep === 'confirm' ? addToNook : askToSignIn}
                  >
                    {nookStep === 'confirm' ? 'Add to nook' : nookStep === 'ask' ? 'Sign in' : 'Show sign-in'}
                  </button>
                </div>
              </div>
            )}
            {pdfViewerTip && nookStep === 'idle' && !paperInfoOpen && (
              <span className="learn-papol pdf-viewer-tip" role="dialog" aria-labelledby="pdf-viewer-tip-title">
                <strong id="pdf-viewer-tip-title">Use Papol as your default PDF viewer?</strong>
                <span className="pdf-viewer-tip-actions">
                  <button type="button" onClick={dismissPdfViewerTip}>Not now</button>
                  <button type="button" className="learn-papol-close" onClick={makeDefaultPdfViewer}>
                    Use Papol
                  </button>
                </span>
              </span>
            )}
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
                  {paper.uuid && (
                    <a className="ref-link here" href={appPath(`/paper/${paper.uuid}`)}>In Papol</a>
                  )}
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


      <div
        className={`viewer-body${railOpen ? '' : ' rail-hidden'}`}
        style={{ '--rail-user-w': `${railWidth}px` }}
      >
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
          {railOpen ? (
            <span aria-hidden="true">›</span>
          ) : (
            <span className="rail-handle-icon" aria-hidden="true"><ToolGlyph id="anchor" /></span>
          )}
        </button>
        <ReturnPill
          returnView={returnView}
          onwardView={onwardView}
          hidden={returnPillHidden}
          notice={returnPillNotice}
          onBack={() => moveThroughLinks('back')}
          onForward={() => moveThroughLinks('forward')}
          onHide={hideReturnPill}
          onUndo={showReturnPill}
          onDismiss={() => setReturnPillNotice(false)}
        >
          {learnLinkTip}
        </ReturnPill>
        <div
          className="pages"
          ref={scrollerRef}
          aria-busy={!doc}
          onContextMenu={pageContextMenu}
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
          {!doc && showPdfLoading && (
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
              {source?.openedFile && !mountedFilePages.has(n) ? (
                <LazyPageShell
                  pageNumber={n}
                  size={defaultPageSize}
                  scale={scale}
                  previewUrl={pagePreviews.get(n)}
                />
              ) : <PdfPage
              doc={doc}
              pageNumber={n}
              initiallyNear={source?.openedFile || n === initiallyVisiblePage}
              initialSize={defaultPageSize}
              previewUrl={pagePreviews.get(n)}
              scale={scale}
              renderScaleStore={renderScaleStore}
              notes={notesByPage.get(n) || EMPTY_INK}
              activeNoteUuid={notesByPage.get(n)?.some((note) => note.uuid === activeNoteUuid) ? activeNoteUuid : null}
              analysis={analysis}
              openReferenceUuid={openReferencePage === n ? openCite?.referenceUuid ?? null : null}
              onOpenReference={pageOpenReference}
              onFollowLink={pageFollowLink}
              onSelectNote={pageSelectNote}
              onMoveNote={pageMoveNote}
              tool={tool}
              ink={inkByPage.get(n) || EMPTY_INK}
              provenanceHighlights={wantedSelectionByPage.get(n) || EMPTY_INK}
              selectionHighlights={selectionHighlightsByPage.get(n) || EMPTY_INK}
              provenanceBox={wantedBox?.page === n ? wantedBox : null}
              selectedInk={selectedInkPages.has(n) ? selectedInk : null}
              hoveredInkObjects={hoveredInk.pages.has(n) ? hoveredInk.objects : EMPTY_INK}
              inkColor={inkColor}
              inkWidth={inkWidth}
              inkOpacity={inkOpacity}
              inkShape={inkShape}
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
              selectedClipUuid={clipsByPage.get(n)?.some((clip) => clip.uuid === selectedClipUuid)
                ? selectedClipUuid
                : null}
              onSelectClip={setSelectedClipUuid}
              onSendClip={pageSendClip}
              onMoveStroke={pageMoveStroke}
              onDragNote={setDraggingNoteUuid}
              onContextNote={noteContextMenu}
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
              />}
            </React.Fragment>
          ))}
          {openCite && (
            <ReferenceCard
              anchor={openCite.anchor}
              reference={reference}
              error={referenceError}
              requiresNook={source?.openedFile && !paper?.edition_uuid}
              onAddToNook={() => {
                closeReference();
                addToNook();
              }}
              onClose={closeReference}
              position={openCite.index}
              count={openCite.referenceUuids.length}
              onPrevious={openCite.index > 0 ? () => openReference(
                openCite.referenceUuids[openCite.index - 1],
                openCite.anchor,
                null,
                openCite.referenceUuids
              ) : null}
              onNext={openCite.index < openCite.referenceUuids.length - 1 ? () => openReference(
                openCite.referenceUuids[openCite.index + 1],
                openCite.anchor,
                null,
                openCite.referenceUuids
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
          {inkActions && (
            <span
              className="selection-actions ink-actions"
              style={{ left: inkActions.left, top: inkActions.top }}
            >
              <button
                type="button"
                className="selection-action ink-remove"
                aria-label="Remove paint"
                title="Remove paint (Delete)"
                onPointerDown={(event) => event.preventDefault()}
                onClick={removeSelectedInk}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10.5 11v5M13.5 11v5" />
                </svg>
              </button>
              <button
                type="button"
                className="selection-action selection-send"
                aria-label="Send painted text to a board"
                title={inkActions.text == null
                  ? 'Reading the text under this paint…'
                  : inkActions.text
                    ? 'Send painted text to a board'
                    : 'No text under this paint'}
                disabled={!inkActions.text}
                onPointerDown={(event) => event.preventDefault()}
                onClick={openSendPaint}
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
          onClick={() => {
            setFeedbackReportError(false);
            setFeedbackContent('');
            setFeedbackOpen(true);
          }}
        >
          Feedback
        </button>

        {feedbackOpen && (
          <div
            className="help-back"
            role="dialog"
            aria-modal="true"
            aria-label={feedbackReportError ? 'Send an error report' : 'Report a bug or ask for a feature'}
            onClick={closeFeedback}
          >
            <div className="help-sheet feedback-sheet" onClick={(e) => e.stopPropagation()}>
              <h3>{feedbackSent
                ? (feedbackReportError ? 'Report sent' : 'Thank you')
                : (feedbackReportError ? 'Send an error report?' : 'Report a bug or ask for a feature')}</h3>
              {feedbackSent ? (
                <>
                  <div className="feedback-actions">
                    <button type="button" className="primary" onClick={closeFeedback}>
                      Close
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {feedbackReportError && (
                    <p className="feedback-note">
                      Papol encountered an unexpected error while opening this PDF. Review the details below and choose whether to send them to the developer.
                    </p>
                  )}
                  <div className="feedback-field">
                    <label>
                      {feedbackReportError ? 'Diagnostic details' : 'What went wrong, or what would you like the viewer to do?'}
                    </label>
                    <textarea
                      rows="5"
                      maxLength={appLimits.text.feedback}
                      value={feedbackContent}
                      onChange={(e) => setFeedbackContent(e.target.value)}
                      placeholder={feedbackReportError ? undefined : 'I clicked … and the page …, or: it would help if …'}
                      autoFocus
                    />
                  </div>

                  {feedbackLog && (
                    <div className="feedback-diagnostics">
                      <label>
                        <input
                          type="checkbox"
                          checked={feedbackIncludeLog}
                          onChange={(event) => setFeedbackIncludeLog(event.target.checked)}
                        />
                        Include recent diagnostic events
                      </label>
                      <details>
                        <summary>Review diagnostic log</summary>
                        <pre>{feedbackLog}</pre>
                      </details>
                    </div>
                  )}

                  {feedbackError && <p className="feedback-error">{feedbackError}</p>}

                  <div className="feedback-actions">
                    <button type="button" onClick={closeFeedback} disabled={feedbackSending}>
                      {feedbackReportError ? 'Not now' : 'Cancel'}
                    </button>
                    <button
                      type="button"
                      className="primary"
                      onClick={sendFeedback}
                      disabled={feedbackSending || !feedbackContent.trim()}
                    >
                      {feedbackSending ? 'Sending…' : (feedbackReportError ? 'Send report' : 'Submit')}
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
                      maxLength={appLimits.text.board_content}
                      value={sendSelection.text}
                      onChange={(event) => setSendSelection({ ...sendSelection, text: event.target.value })}
                      autoFocus
                    />
                  </label>}
                  <label className="send-selection-field">
                    <span>Board</span>
                    <select
                      value={sendBoardUuid}
                      onChange={(event) => setSendBoardUuid(event.target.value)}
                      disabled={!sendBoards.length}
                    >
                      {!sendBoards.length && <option value="">No boards available</option>}
                      {sendBoards.map((candidate) => (
                        <option key={candidate.uuid} value={candidate.uuid}>{candidate.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="send-selection-field">
                    <span>Comment <small>optional</small></span>
                    <textarea
                      rows="3"
                      maxLength={appLimits.text.board_content}
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
                      disabled={sendBusy || !sendBoardUuid || (sendSelection.kind !== 'clip' && !sendSelection.text.trim())}
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

        {railOpen && <button className="rail-scrim" type="button" aria-label="Close anchors" onClick={() => setRailOpen(false)} />}

        {railOpen && (
          <div
            className="rail-resizer"
            role="separator"
            aria-label="Resize anchors sidebar"
            aria-orientation="vertical"
            aria-valuemin={MIN_RAIL_WIDTH}
            aria-valuemax={MAX_RAIL_WIDTH}
            aria-valuenow={Math.round(railWidth)}
            tabIndex={0}
            onPointerDown={beginRailResize}
            onKeyDown={resizeRailWithKeyboard}
          />
        )}

        {railOpen && (
        <aside className="rail" aria-label="Paper anchors">
          <div className="rail-header">
            <div className="rail-heading">
              <span className="rail-kicker">Paper notes</span>
              <div className="rail-title-row">
                <h2>Anchors</h2>
                <span className="rail-count" aria-label={`${numbered.length} ${numbered.length === 1 ? 'anchor' : 'anchors'}`}>
                  {numbered.length}
                </span>
              </div>
            </div>
            <div className="rail-header-actions">
              <button
                type="button"
                className="rail-help"
                aria-label="Open tools help"
                title="Tools help"
                onClick={() => setHelpOpen(true)}
              >
                <span aria-hidden="true">?</span>
              </button>
              <button
                type="button"
                className="rail-close"
                aria-label="Close anchors"
                title="Close anchors"
                onClick={() => setRailOpen(false)}
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
          </div>

          {numbered.length === 0 && (
            <div className="rail-empty">
              <span className="rail-empty-glyph" aria-hidden="true">
                <ToolGlyph id="anchor" />
              </span>
              <h3>No anchors yet</h3>
              <p>Choose the Anchor tool, then click anywhere on the paper to save your place.</p>
              <button type="button" className="link" onClick={() => setHelpOpen(true)}>See all annotation tools</button>
            </div>
          )}

          {numbered.length > 0 && (
            <p className="rail-intro">Select an anchor to return to that place in the paper.</p>
          )}

          <div className="rail-list">

          {numbered.map((note) =>
            // An anchor with nothing written on it is a mark, not a note:
            // one quiet line, until there are words to show.
            !note.content && editing !== note.uuid ? (
              <div
                key={note.uuid}
                data-note={note.uuid}
                className={`anchor-row${
                  note.uuid === flashUuid ? ' flash' : ''
                }${note.uuid === draggingNoteUuid ? ' carrying' : ''}`}
                onClick={() => goToNote(note)}
                onContextMenu={(event) => noteContextMenu(event, note)}
              >
                <span className="row-glyph">
                  <GlyphFor note={note} />
                </span>
                <span className="anchor-where">{label(note)}</span>
                <button
                  type="button"
                  className="link anchor-jump"
                  aria-label={`Go to ${note.name || (note.anchor ? `page ${note.page}` : 'unplaced anchor')}`}
                  title="Go to anchor"
                  onClick={(event) => {
                    event.stopPropagation();
                    goToNote(note);
                  }}
                >
                  <span aria-hidden="true">→</span>
                </button>
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
                    removeNote(note.uuid);
                  }}
                >
                  ×
                </button>
              </div>
            ) : (
              <div
                key={note.uuid}
                data-note={note.uuid}
                className={`note-card${
                  note.uuid === flashUuid ? ' flash' : ''
                }${note.uuid === draggingNoteUuid ? ' carrying' : ''}`}
                onClick={() => goToNote(note)}
                onContextMenu={(event) => noteContextMenu(event, note)}
              >
                <button
                  className="card-x"
                  title="Delete this anchor"
                  aria-label="Delete this anchor"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeNote(note.uuid);
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
                {editing === note.uuid ? (
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
                          saveEdit(note.uuid);
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
                          goToNote(note);
                        }}
                      >
                        go to anchor
                      </button>
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

          </div>

        </aside>
        )}
      </div>
    </>
  );
}
