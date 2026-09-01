import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import { GlyphFor, AnimalJointed, ANCHOR_D, ANCHOR_HANG } from './glyphs';
import { animalFor } from './animals';
import { stepCow as stepAnimal, poseCow as poseAnimal } from './cow';
import { pageOverlays } from './references';
import { STRIP_RATIO } from './ink';

/**
 * One rendered page, plus the pins that live on it.
 *
 * Two coordinate systems meet here and only here. pdf.js draws in device
 * pixels at whatever scale the reader has chosen; a note is stored as a
 * fraction of the page in PDF user space, origin bottom-left. `viewport`
 * converts between them, so nothing above this component ever sees a pixel.
 */
// The laser is doing two things, so its trail behaves two ways. Passing
// over the page it is a pointer, and wants only enough tail to show which
// way it is going, each point fading a moment after it was made.
const LASER_PASSING = 260;
// Held down it is a drawing gesture — underlining a line, circling a term
// while you talk about it — and while the button is down it does not fade
// at all: the shape is not finished, and half of it going pale before the
// rest is drawn is no help to anyone looking at it. Letting go is what
// starts the clock, and then the whole shape goes together, slowly enough
// to still be there while you say what it was for.
const LASER_LINGER = 2000;
// A laser's beam is one width: it is a pointer, not a brush.
const LASER_WIDTH = 0.005;
// Samples nearer than this to the last add nothing but points to draw.
const LASER_STEP = 1.0;
// Points nearer than this to the last one add bytes and no shape. In page
// units, so it means the same thing on a tall page as on a wide one.
const MIN_STEP = 1.2;
// How near the eraser has to pass. Generous, because rubbing something out
// is a gesture rather than a click on a one-pixel line — and the same for
// everything, whatever it was drawn at. It used to widen with the stroke,
// on the reasoning that a heavier line covers more page; what that meant in
// the hand was that the eraser reached further for some ink than for other
// ink, and reaching is the part the reader has to aim.
const ERASE_REACH = 9;
// How far the glow stands out from a stroke the eraser is over. A margin,
// not a multiple: the halo used to be drawn at a multiple of the stroke's
// own width, so a heavy line got a heavy glow and a fine one got almost
// none — when what the glow is saying, "this one", is the same either way.
const HALO_SPREAD = 5;
// An anchor is a pin the size of a fingertip rather than a line, so the
// eraser has to be nearer its point before it counts as over it.
const ANCHOR_REACH = 13;
// The ceiling the API enforces, applied here so a stroke is never refused
// after it has been drawn.
const MAX_POINTS = 4000;
// One object, so clearing the highlight does not count as a change.
const EMPTY_DOOMED = { ink: [], notes: [], animals: [] };
// How wide a stroke is to take hold of, whatever it was drawn at.
const GRAB_WIDTH = 14;
// Draw, then stop and hold: the stroke snaps to a straight line from where
// it began, square to the page. Underlining a sentence and ruling a bar
// down a margin are most of what a brush is used for on a paper, and both
// want a line that is exactly level or exactly upright — which is the one
// thing a hand drawing freehand never manages. Long enough not to fire on
// someone drawing slowly and carefully.
const STRAIGHTEN_HOLD = 550;

// A box stored as fractions of the page, as CSS.
const boxStyle = (box) => ({
  left: `${box.x * 100}%`,
  top: `${box.y * 100}%`,
  width: `${box.w * 100}%`,
  height: `${box.h * 100}%`,
});

function ClipBox({ clip, sourceCanvas, sourceRevision, selected, onChange, onCommit, onRemove, onSelect, onSend }) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const gestureRef = useRef(null);
  const draggedRef = useRef(false);
  const [floatViewport, setFloatViewport] = useState(null);
  // Pointer movement is local to this one clip. Sending every pixel through
  // App rerendered every PDF page; the shared state only needs the result
  // once the clip is put down.
  const [liveFrame, setLiveFrame] = useState(clip.frame);

  useEffect(() => {
    if (!gestureRef.current) setLiveFrame(clip.frame);
  }, [clip.frame]);

  useLayoutEffect(() => {
    if (!clip.floating) return undefined;
    const viewport = rootRef.current?.closest('.pages');
    const update = () => {
      const box = viewport?.getBoundingClientRect();
      if (box) setFloatViewport({ left: box.left, top: box.top, width: box.width, height: box.height });
    };
    update();
    const observer = new ResizeObserver(update);
    if (viewport) observer.observe(viewport);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [clip.floating]);

  useLayoutEffect(() => {
    const output = canvasRef.current;
    if (!output || !sourceCanvas?.width || !sourceCanvas?.height) return undefined;
    const paint = () => {
      const bounds = output.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      output.width = Math.max(1, Math.round(bounds.width * ratio));
      output.height = Math.max(1, Math.round(bounds.height * ratio));
      const context = output.getContext('2d');
      context.imageSmoothingEnabled = true;
      context.drawImage(
        sourceCanvas,
        clip.source.x * sourceCanvas.width,
        clip.source.y * sourceCanvas.height,
        clip.source.w * sourceCanvas.width,
        clip.source.h * sourceCanvas.height,
        0,
        0,
        output.width,
        output.height
      );
    };
    paint();
    const observer = new ResizeObserver(paint);
    observer.observe(output);
    observer.observe(sourceCanvas);
    return () => observer.disconnect();
  }, [sourceCanvas, sourceRevision, clip.source, clip.frame.w, clip.frame.h]);

  const begin = (event, kind) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const container = clip.floating
      ? event.currentTarget.closest('.pages').getBoundingClientRect()
      : event.currentTarget.closest('.pdf-page').getBoundingClientRect();
    gestureRef.current = {
      kind,
      x: event.clientX,
      y: event.clientY,
      page: container,
      frame: liveFrame,
      lastFrame: liveFrame,
    };
    if (kind === 'move' && rootRef.current) rootRef.current.style.willChange = 'transform';
    draggedRef.current = false;
  };

  const move = (event) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    event.stopPropagation();
    const dx = (event.clientX - gesture.x) / gesture.page.width;
    const dy = (event.clientY - gesture.y) / gesture.page.height;
    if (Math.abs(event.clientX - gesture.x) + Math.abs(event.clientY - gesture.y) > 5) {
      draggedRef.current = true;
    }
    if (gesture.kind === 'move') {
      const frame = {
        ...gesture.frame,
        x: Math.min(1 - gesture.frame.w, Math.max(0, gesture.frame.x + dx)),
        y: Math.min(1 - gesture.frame.h, Math.max(0, gesture.frame.y + dy)),
      };
      gesture.lastFrame = frame;
      // Moving does not change the clip's contents or dimensions. Let the
      // compositor carry the already-painted layer instead of asking React
      // and layout to reposition it for every pointer sample.
      if (rootRef.current) {
        rootRef.current.style.transform =
          `translate(${event.clientX - gesture.x}px, ${event.clientY - gesture.y}px)`;
      }
      return;
    }
    const aspect = clip.source.w / clip.source.h;
    let w = Math.min(0.9, Math.max(0.08, gesture.frame.w + dx));
    let h = w / aspect;
    if (h > 0.9) {
      h = 0.9;
      w = h * aspect;
    }
    const frame = {
        ...gesture.frame,
        x: Math.min(1 - w, gesture.frame.x),
        y: Math.min(1 - h, gesture.frame.y),
        w,
        h,
    };
    gesture.lastFrame = frame;
    setLiveFrame(frame);
  };

  const finish = (event) => {
    event.stopPropagation();
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (gesture?.kind === 'move' && rootRef.current) {
      setLiveFrame(draggedRef.current ? gesture.lastFrame : gesture.frame);
      rootRef.current.style.transform = '';
      rootRef.current.style.willChange = '';
    }
    if (gesture && draggedRef.current) {
      onChange({ frame: gesture.lastFrame });
      onCommit({ frame: gesture.lastFrame });
    }
  };

  const toggleFloating = (event) => {
    event.stopPropagation();
    const element = rootRef.current.getBoundingClientRect();
    const destination = clip.floating
      ? rootRef.current.closest('.pdf-page').getBoundingClientRect()
      : rootRef.current.closest('.pages').getBoundingClientRect();
    const w = Math.min(0.9, element.width / destination.width);
    const h = Math.min(0.9, element.height / destination.height);
    const frame = {
      x: Math.min(1 - w, Math.max(0, (element.left - destination.left) / destination.width)),
      y: Math.min(1 - h, Math.max(0, (element.top - destination.top) / destination.height)),
      w,
      h,
    };
    const floating = !clip.floating;
    setLiveFrame(frame);
    onChange({ frame, floating });
    onCommit({ frame, floating });
  };

  const positionStyle = clip.floating && floatViewport
    ? {
        position: 'fixed',
        left: floatViewport.left + liveFrame.x * floatViewport.width,
        top: floatViewport.top + liveFrame.y * floatViewport.height,
        width: liveFrame.w * floatViewport.width,
        height: liveFrame.h * floatViewport.height,
      }
    : boxStyle(liveFrame);

  const actions = selected && (
    <span className="clip-actions" onPointerDown={(event) => event.stopPropagation()}>
      <button
        type="button"
        className={`clip-float${clip.floating ? ' floating' : ''}`}
        aria-label={clip.floating ? 'Lock clip to paper' : 'Let clip float with the viewport'}
        title={clip.floating ? 'Lock to paper' : 'Free float'}
        aria-pressed={clip.floating}
        onClick={toggleFloating}
      >
        {clip.floating ? (
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="10" width="11" height="9" rx="2" /><path d="M10 10V7.5a4 4 0 0 1 7.2-2.4M4 12h1.5M3 16h2.5" /><circle cx="12.5" cy="14.5" r="1" fill="currentColor" stroke="none" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5.5" y="10" width="13" height="9" rx="2" /><path d="M8.5 10V7.2a3.5 3.5 0 0 1 7 0V10" /><circle cx="12" cy="14.5" r="1" fill="currentColor" stroke="none" /></svg>
        )}
      </button>
      <button type="button" className="clip-send" aria-label="Send clipped content to a board" title="Send clipped content to a board" onClick={() => canvasRef.current?.toBlob((blob) => { if (blob) onSend(blob); }, 'image/png')}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8" /></svg>
      </button>
      <button type="button" className="clip-remove" aria-label="Remove clipped view" title="Remove" onClick={onRemove}>×</button>
    </span>
  );

  return (<>
    <aside
      ref={rootRef}
      className={`paper-clip${selected ? ' selected' : ''}`}
      style={positionStyle}
      aria-label="Clipped paper content"
      title="Drag clipped view"
      onPointerDown={(event) => begin(event, 'move')}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={finish}
      onClick={(event) => {
        event.stopPropagation();
        if (!draggedRef.current) onSelect();
        draggedRef.current = false;
      }}
    >
      <canvas ref={canvasRef} className="clip-canvas" />
      {actions}
      <span
        className="clip-resize"
        role="button"
        tabIndex="0"
        aria-label="Resize clipped view"
        title="Resize"
        onPointerDown={(event) => begin(event, 'resize')}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={finish}
      />
    </aside>
  </>);
}

export default function PdfPage({
  doc,
  pageNumber,
  scale,
  renderScale,
  notes,
  activeNoteId,
  analysis,
  openReferenceId,
  onOpenReference,
  onFollowLink,
  onSelectNote,
  onMoveNote,
  tool,
  ink,
  provenanceHighlights = [],
  provenanceBox = null,
  selectedInk,
  hoveredInkObjects,
  inkColor,
  inkWidth,
  inkOpacity,
  inkShape,
  laserColor,
  onDrawStroke,
  onSelectInk,
  onHoverInkObjects,
  onEraseStroke,
  onEraseNote,
  onHover,
  onDropAnchor,
  clips = [],
  onCreateClip,
  onUpdateClip,
  onCommitClip,
  onRemoveClip,
  selectedClipId,
  onSelectClip,
  onSendClip,
  onMoveStroke,
  onDragNote,
  animal,
  animalSpeed,
  animalActivity,
  animals,
  onDropAnimal,
  onMoveAnimal,
  onEraseAnimal,
  searchMatches,
  activeSearchId,
}) {
  const canvasRef = useRef(null);
  const holderRef = useRef(null);
  const textRef = useRef(null);
  const renderTaskRef = useRef(null);
  const textTaskRef = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [visible, setVisible] = useState(false);
  // A canvas ref becoming non-null does not itself render React. Clips need
  // an explicit signal after pdf.js has actually painted its pixels, or a
  // restored clip snapshots the canvas while it is still blank.
  const [canvasRevision, setCanvasRevision] = useState(0);
  // The citation markers on this page. Worked out when the page first
  // comes into view, because finding them means resolving the PDF's own
  // links, and a page nobody has reached should not cost that.
  const [citations, setCitations] = useState([]);
  const [hoveredCitation, setHoveredCitation] = useState(-1);
  // The PDF's own links: "see Section 3", "Figure 4", a URL in a footnote.
  const [links, setLinks] = useState([]);
  // The drag lives in a ref, because pointermove fires faster than React
  // re-renders and a stale `moved` flag would read a drag as a click. The
  // state alongside it exists only to redraw the pin under the pointer.
  const dragRef = useRef(null);
  const [drag, setDrag] = useState(null);
  // Set when a drag ends, so the click that follows it is not also read as
  // "open the menu".
  const draggedRef = useRef(false);
  // Ink being laid down now. In a ref for the same reason the drag is:
  // pointermove outruns React, and the state beside it exists only to put
  // the wet stroke on screen while it is being made.
  const wetRef = useRef(null);
  const [wet, setWet] = useState(null);
  const clipRef = useRef(null);
  const clipOverlayRef = useRef(null);
  const clipWindowRef = useRef(null);
  const clipVerticalRef = useRef(null);
  const clipHorizontalRef = useRef(null);
  // Set once a stroke has snapped straight: from then on the pointer moves
  // the far end of the line rather than adding to a freehand path.
  const straightRef = useRef(false);
  const holdRef = useRef(null);
  // Shift, held now. Unlike the hold, this is not sticky: let go of shift
  // and the freehand line the hand actually drew comes back, because it was
  // never thrown away — only drawn over.
  const shiftRef = useRef(false);
  // What the eraser is over. Shown lit rather than left to be guessed at:
  // rubbing out is not undoable here, and a reader should be able to see
  // what is about to go before they press.
  const [doomed, setDoomed] = useState(EMPTY_DOOMED);
  // Where the brush is hovering, so its own footprint can be drawn on the
  // page under it.
  const [brushAt, setBrushAt] = useState(null);
  // Where the pointer is over this page, and whether it is over it at all —
  // kept whatever tool is in hand, so that picking up the brush can show it
  // straight away instead of waiting to be told where the hand is.
  const overRef = useRef(false);
  const lastAtRef = useRef(null);
  // A stroke being carried. Like the pin's drag, in a ref because
  // pointermove outruns React, with state beside it only to redraw the ink
  // under the hand.
  const inkDragRef = useRef(null);
  const [inkDrag, setInkDrag] = useState(null);
  // The laser keeps nothing, so its trail is points with the moment each
  // was made, thrown away by a frame loop rather than stored anywhere.
  const laserRef = useRef([]);
  // Which pass of the pointer a point belongs to. A trail that was let go
  // of must not be joined to wherever the pointer wandered next, so letting
  // go — and pressing again — starts a new one.
  const laserRunRef = useRef(0);
  const [, setLaserTick] = useState(0);
  const rafRef = useRef(null);

  // Only pages the reader can see are rendered: a 40-page PDF should not
  // cost 40 canvases up front.
  useEffect(() => {
    const el = holderRef.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: '400px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Measured once, unscaled: every size below is then arithmetic, so a
  // zoom changes the layout in the same frame instead of a promise later.
  useEffect(() => {
    let cancelled = false;
    doc.getPage(pageNumber).then((page) => {
      if (cancelled) return;
      const viewport = page.getViewport({ scale: 1 });
      setSize({ width: viewport.width, height: viewport.height });
    });
    return () => {
      cancelled = true;
    };
  }, [doc, pageNumber]);

  useEffect(() => {
    if (!visible || !canvasRef.current) return undefined;
    let cancelled = false;

    doc.getPage(pageNumber).then((page) => {
      if (cancelled) return;
      const viewport = page.getViewport({ scale: renderScale });
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      renderTaskRef.current?.cancel();
      const task = page.render({
        canvasContext: canvas.getContext('2d'),
        viewport,
        transform: dpr === 1 ? null : [dpr, 0, 0, dpr, 0, 0],
      });
      renderTaskRef.current = task;
      task.promise
        .then(() => {
          if (!cancelled) setCanvasRevision((revision) => revision + 1);
        })
        .catch((err) => {
          if (err?.name !== 'RenderingCancelledException') throw err;
        });
    });

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
    };
  }, [doc, pageNumber, renderScale, visible]);

  // The text layer: invisible spans positioned over the drawing, which is
  // what makes the page's text selectable and searchable by the browser.
  // It is rebuilt on zoom, since the spans are laid out in scaled pixels.
  useEffect(() => {
    const container = textRef.current;
    if (!visible || !container) return undefined;
    let cancelled = false;

    doc.getPage(pageNumber).then(async (page) => {
      if (cancelled) return;
      const viewport = page.getViewport({ scale: renderScale });
      container.replaceChildren();
      container.style.width = `${viewport.width}px`;
      container.style.height = `${viewport.height}px`;
      // pdf.js sizes and positions its spans through this variable; without
      // it every span collapses and selection lands on the wrong words.
      container.style.setProperty('--total-scale-factor', String(renderScale));
      textTaskRef.current?.cancel();
      // Use the same text-content shape as the document-wide search index.
      // In particular, do not introduce marked-content wrapper items here:
      // they change rendered span indexes and make a correct match point at
      // an unrelated line.
      const textContent = await page.getTextContent();
      // Canvas rendering has already registered pdf.js's converted embedded
      // fonts under these internal names. Measure and lay out selectable text
      // with those same faces instead of generic serif/sans-serif fallbacks.
      // That keeps browser Range boxes on the glyph advances in the PDF.
      for (const [fontName, style] of Object.entries(textContent.styles)) {
        style.fontFamily = `"${fontName}", ${style.fontFamily}`;
      }
      const task = new pdfjs.TextLayer({
        textContentSource: textContent,
        container,
        viewport,
      });
      textTaskRef.current = task;
      try {
        await task.render();
        if (cancelled) return;
        const spans = [...container.querySelectorAll(':scope > span')];
        const containerBox = container.getBoundingClientRect();
        const visualScale = scale / renderScale;
        let activeHighlight = null;
        for (const match of searchMatches) {
          for (const part of match.parts) {
            const textNode = spans[part.spanIndex]?.firstChild;
            if (!textNode || textNode.nodeType !== Node.TEXT_NODE) continue;
            const range = document.createRange();
            range.setStart(textNode, Math.min(part.start, textNode.length));
            range.setEnd(textNode, Math.min(part.end, textNode.length));
            for (const box of range.getClientRects()) {
              const highlight = document.createElement('span');
              const active = match.id === activeSearchId;
              highlight.className = `search-highlight${active ? ' search-highlight-active' : ''}`;
              highlight.style.left = `${(box.left - containerBox.left) / visualScale}px`;
              highlight.style.top = `${(box.top - containerBox.top) / visualScale}px`;
              highlight.style.width = `${box.width / visualScale}px`;
              highlight.style.height = `${box.height / visualScale}px`;
              container.appendChild(highlight);
              if (active && !activeHighlight) activeHighlight = highlight;
            }
            range.detach();
          }
        }
        // Follow the result only when it has left the viewport. `nearest`
        // asks the scroller for the shortest possible movement instead of
        // pulling every result to the middle of the screen.
        activeHighlight?.scrollIntoView({
          block: 'nearest',
          inline: 'nearest',
          behavior: 'smooth',
        });
      } catch (err) {
        if (err?.name !== 'AbortException') throw err;
      }
    });

    return () => {
      cancelled = true;
      textTaskRef.current?.cancel();
    };
  }, [doc, pageNumber, scale, renderScale, visible, searchMatches, activeSearchId]);

  // Only that the page is on screen — not that the references are ready.
  // The PDF's own links are in the file itself: they need no analyzer, and
  // in the demo, where there is no analysis at all, they are the whole of
  // what this layer has to offer.
  useEffect(() => {
    if (!visible) return undefined;
    let cancelled = false;
    pageOverlays(doc, pageNumber, analysis).then((found) => {
      if (cancelled) return;
      setCitations(found.citations);
      setLinks(found.links);
    });
    return () => {
      cancelled = true;
    };
  }, [doc, pageNumber, visible, analysis]);

  // Anchors are placed with the explicit tool, at a spot the reader can see
  // before committing to it. An ordinary double-click remains text selection.

  // A pin is dragged with the pointer captured, so the gesture survives
  // leaving the pin. A small movement is a click, not a drag — otherwise
  // opening the menu would nudge the anchor.
  const DRAG_SLOP = 6;

  const anchorAt = (clientX, clientY) => {
    const rect = holderRef.current.getBoundingClientRect();
    const clamp = (v) => Math.min(1, Math.max(0, v));
    return {
      type: 'point',
      x: clamp((clientX - rect.left) / rect.width),
      // Stored from the bottom of the page, drawn from the top.
      y: 1 - clamp((clientY - rect.top) / rect.height),
    };
  };

  const startDrag = (e, note) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    // Where the pointer sits relative to the anchor's own point, so the
    // shape keeps that offset instead of snapping its point to the cursor.
    const grabbed = anchorAt(e.clientX, e.clientY);
    dragRef.current = {
      id: note.id,
      from: { x: e.clientX, y: e.clientY },
      anchor: note.anchor,
      grab: { x: grabbed.x - note.anchor.x, y: grabbed.y - note.anchor.y },
      moved: false,
    };
    setDrag({ id: note.id, anchor: note.anchor, moved: false });
  };

  // The pin follows from the first pixel, and the slop decides only what
  // the gesture turns out to have been. Holding the pin still until six
  // pixels had gone by and then catching up in one step is what made the
  // start of a drag feel like it was lagging behind the hand — the pin was
  // not moving yet, and then it was six pixels away.
  const onDragMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    d.moved =
      d.moved ||
      Math.abs(e.clientX - d.from.x) + Math.abs(e.clientY - d.from.y) > DRAG_SLOP;
    const under = anchorAt(e.clientX, e.clientY);
    const clamp = (v) => Math.min(1, Math.max(0, v));
    d.anchor = {
      type: 'point',
      x: clamp(under.x - d.grab.x),
      y: clamp(under.y - d.grab.y),
    };
    setDrag({ id: d.id, anchor: d.anchor, moved: d.moved });
    if (d.moved) onDragNote(d.id);
  };

  const endDrag = (e, note) => {
    e.stopPropagation();
    const d = dragRef.current;
    dragRef.current = null;
    onDragNote(null);
    // Dropping the drag state is also what puts a pin back that moved a
    // pixel or two and turned out to be a click: it is drawn from the
    // note's own anchor again.
    setDrag(null);
    if (!d) return;
    draggedRef.current = d.moved;
    if (d.moved) {
      onMoveNote(note.id, { page: pageNumber, anchor: d.anchor });
      onSelectNote(null);
    }
    // A click that did not drag opens the menu — and it is left to the
    // click event, so pressing Enter on a focused pin works too.
  };

  // --- Ink ---------------------------------------------------------------
  //
  // Strokes are stored as fractions of the page, like every other mark in
  // this file, so they sit where they were drawn at any zoom. The work
  // here is all in page units: x and y are fractions of different lengths,
  // and treating them as the same one makes a circle into an ellipse.

  const inPageUnits = (a, b) => Math.hypot(
    (a.x - b.x) * size.width,
    (a.y - b.y) * size.height
  );

  const frameLaser = () => {
    if (rafRef.current != null) return;
    const step = () => {
      const now = performance.now();
      laserRef.current = laserRef.current.filter((p) => p.held || now - p.t < p.life);
      setLaserTick((n) => n + 1);
      // A held trail is not going anywhere, so there is nothing to redraw
      // until it moves again or is let go of.
      rafRef.current = laserRef.current.some((p) => !p.held)
        ? requestAnimationFrame(step)
        : null;
    };
    rafRef.current = requestAnimationFrame(step);
  };

  const pushLaser = (at, held) => {
    const trail = laserRef.current;
    const last = trail[trail.length - 1];
    if (last && last.run === laserRunRef.current && inPageUnits(last, at) < LASER_STEP) return;
    laserRef.current = [
      ...trail,
      { ...at, t: performance.now(), life: LASER_PASSING, held, run: laserRunRef.current },
    ];
    frameLaser();
  };

  // Letting go is what starts the fade, and the whole held shape fades as
  // one: it was made as one gesture, and unravelling it from the tail
  // would read as something coming apart rather than something ending.
  const releaseLaser = () => {
    const now = performance.now();
    laserRef.current = laserRef.current.map((p) =>
      p.held ? { ...p, held: false, t: now, life: LASER_LINGER } : p
    );
    // The shape is finished. What the pointer does next is a new one, and
    // is not to be drawn back to the end of this — which is what left the
    // last stroke of it hanging off the cursor.
    laserRunRef.current += 1;
    frameLaser();
  };

  // One path per pass of the pointer, not one per sample.
  //
  // Each sample used to be its own stroke with its own width and its own
  // opacity, and a row of separately drawn semi-transparent strokes with
  // round ends is not a line: it is beads. One path, curved through the
  // midpoints so consecutive spans share a tangent, is a line — and it
  // fades as a whole, at the age of its newest point, which is the age of
  // the gesture. The tail still runs out, because points are dropped from
  // the back as they expire; the trail shortens rather than greying.
  const smoothPath = (pts) => {
    const px = (p) => [p.x * size.width, (1 - p.y) * size.height];
    const at = (q) => `${q[0].toFixed(2)} ${q[1].toFixed(2)}`;
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const P = pts.map(px);
    if (P.length === 1) return `M${at(P[0])}L${at(P[0])}`;
    let d = `M${at(P[0])}`;
    for (let i = 1; i < P.length - 1; i += 1) d += `Q${at(P[i])} ${at(mid(P[i], P[i + 1]))}`;
    return `${d}L${at(P[P.length - 1])}`;
  };

  const laserRuns = () => {
    const pts = laserRef.current;
    if (!pts.length) return [];
    const now = performance.now();
    const runs = [];
    for (const p of pts) {
      const last = runs[runs.length - 1];
      if (!last || last.run !== p.run) runs.push({ run: p.run, pts: [p] });
      else last.pts.push(p);
    }
    return runs.map((r) => {
      const newest = r.pts[r.pts.length - 1];
      return {
        key: r.run,
        d: smoothPath(r.pts),
        fade: newest.held ? 1 : Math.max(0, 1 - (now - newest.t) / newest.life),
      };
    });
  };

  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    if (holdRef.current != null) clearTimeout(holdRef.current);
  }, []);

  // Putting the eraser down puts out what it was lighting. Otherwise the
  // highlight is left behind on whatever happened to be under it, and
  // stays there — nothing else lights it, so nothing else turns it off.
  useEffect(() => {
    if (tool !== 'eraser') {
      setDoomed(EMPTY_DOOMED);
      onHoverInkObjects([]);
    }
    // Reaching for the brush while the pointer is already over the page put
    // it in your hand and showed you nothing, because nothing had moved
    // since — so the mark you were about to make only appeared once you
    // jogged the mouse. It is drawn where the pointer already is.
    if (tool !== 'brush') setBrushAt(null);
    else if (overRef.current) setBrushAt(lastAtRef.current);
    if (tool !== 'clipper') {
      clipRef.current = null;
    }
  }, [tool]);

  const paintClipper = (at, draft = clipRef.current) => {
    const vertical = clipVerticalRef.current;
    const horizontal = clipHorizontalRef.current;
    if (vertical && horizontal) {
      vertical.style.display = at ? 'block' : 'none';
      horizontal.style.display = at ? 'block' : 'none';
      if (at) {
        vertical.style.left = `${at.x * 100}%`;
        horizontal.style.top = `${(1 - at.y) * 100}%`;
      }
    }
    const overlay = clipOverlayRef.current;
    const windowEl = clipWindowRef.current;
    if (!overlay || !windowEl) return;
    if (!draft) {
      overlay.classList.remove('selecting');
      windowEl.style.display = 'none';
      return;
    }
    const x = Math.min(draft.from.x, draft.to.x);
    const y = Math.min(1 - draft.from.y, 1 - draft.to.y);
    overlay.classList.add('selecting');
    windowEl.style.display = 'block';
    windowEl.style.left = `${x * 100}%`;
    windowEl.style.top = `${y * 100}%`;
    windowEl.style.width = `${Math.abs(draft.to.x - draft.from.x) * 100}%`;
    windowEl.style.height = `${Math.abs(draft.to.y - draft.from.y) * 100}%`;
  };

  // Square to the page, along whichever axis the stroke went furthest —
  // recomputed as the pointer moves, so a line that snapped level can be
  // swung upright without lifting the hand.
  const axisSnap = (from, to) => {
    const across = Math.abs(to.x - from.x) * size.width;
    const down = Math.abs(to.y - from.y) * size.height;
    return across >= down ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
  };

  // Restarted by every movement, so it only ever fires on a hand that has
  // come to rest with the button still down.
  const armStraighten = () => {
    if (holdRef.current != null) clearTimeout(holdRef.current);
    holdRef.current = setTimeout(() => {
      const points = wetRef.current;
      if (!points || points.length < 2) return;
      straightRef.current = true;
      wetRef.current = [points[0], axisSnap(points[0], points[points.length - 1])];
      setWet(wetRef.current);
    }, STRAIGHTEN_HOLD);
  };

  const stopStraighten = () => {
    if (holdRef.current != null) clearTimeout(holdRef.current);
    holdRef.current = null;
    straightRef.current = false;
  };

  // The eraser works by the stroke, not by the pixel: what the reader drew
  // is what they undraw. A stroke counts as touched if the pointer passes
  // near any of its points, which for hand-drawn ink is every part of it.
  // How near the pointer came to the stroke — to the line, not to the
  // points it is described by. Measuring to the points alone was enough for
  // freehand ink, where they are a pixel or two apart, and wrong for
  // everything else: a line straightened by draw-and-hold is stored as its
  // two ends, so the whole length between them could not be rubbed out at
  // all, while the pointer could still take hold of it with the arrow.
  const nearStroke = (points, at, reach) => {
    const ax = at.x * size.width;
    const ay = at.y * size.height;
    for (let i = 0; i < points.length; i += 1) {
      const px = points[i].x * size.width;
      const py = points[i].y * size.height;
      if (i === points.length - 1) return Math.hypot(px - ax, py - ay) < reach;
      const qx = points[i + 1].x * size.width;
      const qy = points[i + 1].y * size.height;
      const dx = qx - px;
      const dy = qy - py;
      const len2 = dx * dx + dy * dy;
      // How far along this span the nearest point lies, kept on the span.
      const t = len2 ? Math.min(1, Math.max(0, ((ax - px) * dx + (ay - py) * dy) / len2)) : 0;
      if (Math.hypot(px + t * dx - ax, py + t * dy - ay) < reach) return true;
    }
    return false;
  };

  // The same reckoning the eraser itself uses, so what lights up is exactly
  // what would go.
  const under = (at) => {
    const found = { ink: [], notes: [], animals: [] };
    const inkObjects = new Set();
    for (const stroke of ink) {
      if (nearStroke(stroke.points, at, ERASE_REACH)) {
        inkObjects.add(stroke.group_id ? `group:${stroke.group_id}` : `stroke:${stroke.id}`);
      }
    }
    for (const stroke of ink) {
      const object = stroke.group_id ? `group:${stroke.group_id}` : `stroke:${stroke.id}`;
      if (inkObjects.has(object)) found.ink.push(stroke.id);
    }
    for (const note of notes) {
      if (note.content || !note.anchor) continue;
      if (inPageUnits(note.anchor, at) < ANCHOR_REACH) found.notes.push(note.id);
    }
    for (const animalRecord of animals) {
      if (inPageUnits(animalRecord, at) < (animalFor(animalRecord.kind).size * size.width) / 2) found.animals.push(animalRecord.id);
    }
    return { ...found, inkObjects: [...inkObjects] };
  };

  const eraseUnder = (at) => {
    for (const stroke of ink) {
      if (nearStroke(stroke.points, at, ERASE_REACH)) onEraseStroke(stroke.id);
    }
    // An anchor is a mark on the page, so the eraser takes it. What it does
    // not take is a note with words in it: that is
    // writing, there is no undo here, and a swipe of the hand is no way to
    // lose it. Those are still deleted from the pin's own menu.
    for (const note of notes) {
      if (note.content || !note.anchor) continue;
      if (inPageUnits(note.anchor, at) < ANCHOR_REACH) onEraseNote(note.id);
    }
    for (const animalRecord of animals) {
      if (inPageUnits(animalRecord, at) < (animalFor(animalRecord.kind).size * size.width) / 2) onEraseAnimal(animalRecord.id);
    }
  };

  const inkDown = (e) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const at = anchorAt(e.clientX, e.clientY);
    if (tool === 'clipper') {
      clipRef.current = { from: at, to: at };
      paintClipper(at);
      return;
    }
    if (tool === 'cow') {
      // Under its feet, not under its middle. The cursor is a cow standing
      // on the pointer, so that is where the cow has to end up standing —
      // and a cow is kept by its middle, which is this much above them.
      const held = animalFor(animal);
      const feet = ((held.ground - held.box.h / 2) * held.size * size.width)
        / (held.box.w * size.height);
      onDropAnimal(pageNumber, {
        x: Math.max(-0.08, Math.min(1.08, at.x)),
        y: Math.max(-0.10, Math.min(1.10, at.y + feet)),
      });
      return;
    }
    if (tool === 'anchor') {
      onDropAnchor({ page: pageNumber, anchor: { type: 'point', ...at } });
      return;
    }
    if (tool === 'brush') {
      setBrushAt(at);
      stopStraighten();
      wetRef.current = [at];
      setWet(wetRef.current);
    } else if (tool === 'eraser') {
      eraseUnder(at);
    } else if (tool === 'laser') {
      laserRunRef.current += 1;
      pushLaser(at, true);
    }
  };

  const inkMove = (e) => {
    const at = anchorAt(e.clientX, e.clientY);
    if (tool === 'clipper') {
      if (clipRef.current && e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        clipRef.current = { ...clipRef.current, to: at };
      }
      paintClipper(at);
      return;
    }
    if (tool === 'brush') setBrushAt(at);
    // The laser follows a pointer that is only passing over, not just one
    // that is pressed: pointing at a figure while you talk about it is the
    // ordinary way to use it, and holding a button down to do that is not
    // how anyone points at anything.
    if (tool === 'laser') {
      const pressed = (e.buttons & 1) === 1;
      // Ruled, while shift is down: the run keeps where it started and its
      // far end follows the pointer square to the page. Everything it had
      // wandered through in between is not part of a ruled line.
      if (pressed && e.shiftKey) {
        const trail = laserRef.current;
        const run = laserRunRef.current;
        const from = trail.findIndex((pt) => pt.run === run);
        if (from >= 0) {
          laserRef.current = [
            ...trail.slice(0, from + 1),
            {
              ...axisSnap(trail[from], at),
              t: performance.now(),
              life: LASER_PASSING,
              held: true,
              run,
            },
          ];
          frameLaser();
          return;
        }
      }
      pushLaser(at, pressed);
      return;
    }
    // The eraser lights up what it is over whether or not it is pressed:
    // knowing what would go is most useful before deciding to press.
    if (tool === 'eraser') {
      const found = under(at);
      onHoverInkObjects(found.inkObjects);
      setDoomed((was) =>
        was.ink.join() === found.ink.join() &&
        was.notes.join() === found.notes.join() &&
        was.animals.join() === found.animals.join()
          ? was
          : found
      );
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) eraseUnder(at);
      return;
    }
    if (!e.currentTarget.hasPointerCapture?.(e.pointerId)) return;
    if (tool === 'brush') {
      const points = wetRef.current;
      if (!points) return;
      // Snapped already: the line keeps its start and follows the pointer
      // with its far end, so it can still be aimed after it has gone
      // straight.
      if (points.length >= MAX_POINTS) return;
      if (inPageUnits(points[points.length - 1], at) < MIN_STEP) return;
      wetRef.current = [...points, at];
      shiftRef.current = e.shiftKey;
      setWet(wetRef.current);
      // Holding shift is a decision, not a pause: it needs no waiting for.
      if (e.shiftKey) stopStraighten();
      else armStraighten();
    } else if (tool === 'laser') {
      laserRef.current = [...laserRef.current, { ...at, t: performance.now() }];
      frameLaser();
    }
  };

  // Kept when the pointer lifts, not as it moves: a stroke is one mark,
  // and half of one is not worth storing.
  const inkUp = () => {
    if (tool === 'clipper') {
      const draft = clipRef.current;
      clipRef.current = null;
      paintClipper(null, null);
      if (!draft) return;
      const x = Math.min(draft.from.x, draft.to.x);
      const y = Math.min(1 - draft.from.y, 1 - draft.to.y);
      const w = Math.abs(draft.to.x - draft.from.x);
      const h = Math.abs(draft.to.y - draft.from.y);
      if (w < 0.01 || h < 0.01) return;
      let frameW = Math.min(0.7, Math.max(w, 0.18));
      let frameH = frameW * (h / w);
      if (frameH > 0.7) {
        frameH = 0.7;
        frameW = frameH * (w / h);
      }
      onCreateClip({
        page: pageNumber,
        source: { x, y, w, h },
        frame: {
          x: Math.min(0.98 - frameW, Math.max(0.02, x + w + 0.025)),
          y: Math.min(0.98 - frameH, Math.max(0.02, y)),
          w: frameW,
          h: frameH,
        },
      });
      return;
    }
    if (tool === 'laser') {
      releaseLaser();
      return;
    }
    stopStraighten();
    const points = wetRef.current;
    wetRef.current = null;
    setWet(null);
    if (tool === 'brush' && points?.length) {
      onDrawStroke({
        page: pageNumber,
        points: laid(points),
        color: inkColor,
        width: inkWidth,
        opacity: inkOpacity,
        shape: inkShape,
      });
    }
    shiftRef.current = false;
  };

  // The shape a wet stroke is currently making: what the hand drew, or —
  // while shift is down, or once holding still has snapped it — the
  // straight line square to the page between where it started and where the
  // pointer is now.
  const laid = (points) =>
    points && points.length > 1 && (shiftRef.current || straightRef.current)
      ? [points[0], axisSnap(points[0], points[points.length - 1])]
      : points;

  // What a flat nib leaves behind.
  //
  // A stroke used to be drawn as a line of constant thickness, which is a
  // round pipe dragged over the page: it looked the same whichever way the
  // hand went, and so had nothing to do with the upright strip the reader
  // was holding. A real flat brush is wide across and thin along, so moving
  // sideways leaves a broad band and moving up the page leaves a hairline,
  // and the mark records the direction it was made in.
  //
  // The shape is the region the nib swept: for each step of the hand, the
  // convex hull of the nib in both places. Consecutive hulls overlap on the
  // point they share, so the joins fill themselves, and all of them wound
  // the same way means a nonzero fill unions the lot into one mark.
  const convexHull = (pts) => {
    const by = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) =>
      (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const half = (list) => {
      const out = [];
      for (const pt of list) {
        while (out.length > 1 && cross(out[out.length - 2], out[out.length - 1], pt) <= 0) {
          out.pop();
        }
        out.push(pt);
      }
      out.pop();
      return out;
    };
    return [...half(by), ...half([...by].reverse())];
  };

  const nibPath = (points, thick, shape) => {
    // A round nib sweeps a circle, which is a line of constant thickness
    // whichever way it goes — so it is drawn the way it always was, as a
    // stroked path, and only the flat one needs a swept outline.
    if (shape === 'round') return null;
    const w = Math.max(thick / STRIP_RATIO, 0.2) / 2;
    const h = thick / 2;
    const at = (p) => [p.x * size.width, (1 - p.y) * size.height];
    const corners = ([x, y]) => [
      [x - w, y - h],
      [x + w, y - h],
      [x + w, y + h],
      [x - w, y + h],
    ];
    const poly = (pts) =>
      `M${pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join('L')}Z`;

    if (points.length === 1) return poly(corners(at(points[0])));
    let d = '';
    for (let i = 1; i < points.length; i += 1) {
      d += poly(convexHull([...corners(at(points[i - 1])), ...corners(at(points[i]))]));
    }
    return d;
  };

  // A lone point is a dot the reader meant to make, and a path that only
  // moves draws nothing — so it is given somewhere to go.
  const pathFor = (points) => {
    const at = (p) => `${(p.x * size.width).toFixed(2)} ${((1 - p.y) * size.height).toFixed(2)}`;
    if (points.length === 1) return `M${at(points[0])}L${at(points[0])}`;
    return points.map((p, i) => `${i ? 'L' : 'M'}${at(p)}`).join('');
  };

  // Ink is moved with the arrow, for the same reason an anchor is: the
  // tools each do their own thing to a stroke, and the hand that is not
  // holding one is the hand that rearranges what is already there.
  const startInkDrag = (e, stroke) => {
    if (tool !== 'arrow' || e.button !== 0) return;
    e.stopPropagation();
    onSelectInk(stroke);
    e.currentTarget.setPointerCapture(e.pointerId);
    inkDragRef.current = {
      id: stroke.id,
      groupId: stroke.group_id,
      points: stroke.points,
      from: anchorAt(e.clientX, e.clientY),
      by: { x: 0, y: 0 },
      moved: false,
    };
    setInkDrag({ id: stroke.id, groupId: stroke.group_id, by: { x: 0, y: 0 } });
  };

  // No slop here, unlike the pin's drag. A pin needs one because a click on
  // it opens its menu, so a small movement has to be allowed to stay a
  // click; nothing happens when a stroke is clicked, so there is nothing to
  // protect — and the threshold is not free. Waiting for six units and then
  // applying the whole offset makes the stroke jump that distance the
  // instant it starts moving, which is what the first moment of carrying
  // one felt like. It now follows from the first pixel.
  const moveInkDrag = (e) => {
    const d = inkDragRef.current;
    if (!d) return;
    const at = anchorAt(e.clientX, e.clientY);
    const by = { x: at.x - d.from.x, y: at.y - d.from.y };
    if (by.x === 0 && by.y === 0) return;
    d.moved = true;
    d.by = by;
    setInkDrag({ id: d.id, groupId: d.groupId, by });
  };

  const endInkDrag = (e) => {
    const d = inkDragRef.current;
    inkDragRef.current = null;
    setInkDrag(null);
    if (!d || !d.moved) return;
    e.stopPropagation();
    const clamp = (v) => Math.min(1, Math.max(0, v));
    onMoveStroke(
      d.id,
      d.points.map((pt) => ({ x: clamp(pt.x + d.by.x), y: clamp(pt.y + d.by.y) }))
    );
    onSelectInk(null);
  };

  // Where a stroke is being drawn right now: its own points, plus however
  // far it has been carried.
  const shifted = (stroke) =>
    (inkDrag?.groupId
      ? inkDrag.groupId === stroke.group_id
      : inkDrag?.id === stroke.id)
      ? stroke.points.map((pt) => ({ x: pt.x + inkDrag.by.x, y: pt.y + inkDrag.by.y }))
      : stroke.points;

  // A cow is carried the way a stroke is: with the arrow, from wherever it
  // was taken hold of, and it goes on grazing where it is put down.
  const animalDragRef = useRef(null);

  const startAnimalDrag = (e, animalRecord) => {
    if (tool !== 'arrow' || e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const at = anchorAt(e.clientX, e.clientY);
    animalDragRef.current = { id: animalRecord.id, grab: { x: at.x - animalRecord.x, y: at.y - animalRecord.y } };
    onMoveAnimal(animalRecord.id, { held: true });
  };

  const moveAnimalDrag = (e) => {
    const d = animalDragRef.current;
    if (!d) return;
    const at = anchorAt(e.clientX, e.clientY);
    const clamp = (v) => Math.min(0.95, Math.max(0.05, v));
    onMoveAnimal(d.id, { x: clamp(at.x - d.grab.x), y: clamp(at.y - d.grab.y) });
  };

  const endAnimalDrag = () => {
    const d = animalDragRef.current;
    animalDragRef.current = null;
    if (d) onMoveAnimal(d.id, { held: false, act: null, until: performance.now() + 1200 });
  };

  // Reduced motion means reduced motion. A cow wandering across a page is
  // a decoration, and a decoration is the kind of thing that setting is
  // about: it stands where it was put instead, and can still be picked up
  // and moved, because that is the reader doing it and not the page.
  const [stillAnimals, setStillAnimals] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  );

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return undefined;
    const onChange = () => setStillAnimals(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // The groups the frame loop writes to, found once when React puts a cow
  // on the page. The callback is kept and handed back for the same cow
  // every time, because a fresh one each render would have React take the
  // whole herd off the page and put it back on for every laser frame.
  const animalPartsRef = useRef(new Map());
  const animalRefsRef = useRef(new Map());

  const animalRef = (id) => {
    const made = animalRefsRef.current;
    if (!made.has(id)) {
      made.set(id, (node) => {
        if (!node) {
          animalPartsRef.current.delete(id);
          return;
        }
        animalPartsRef.current.set(id, {
          root: node,
          frame: node.querySelector('[data-cow="frame"]'),
          bob: node.querySelectorAll('[data-cow="bob"]'),
          head: node.querySelector('[data-cow="head"]'),
          ear: node.querySelector('[data-cow="ear"]'),
          tail: node.querySelector('[data-cow="tail"]'),
          legs: node.querySelectorAll('[data-cow="leg"]'),
          over: node.querySelectorAll('[data-cow="over"]'),
          shadow: node.querySelector('[data-cow="shadow"]'),
          prop: node.querySelector('[data-cow="prop"]'),
          ball: node.querySelector('[data-cow="ball"]'),
          dirt: node.querySelector('[data-cow="dirt"]'),
          chase: node.querySelector('[data-cow="chase"]'),
          sound: node.querySelector('[data-cow="sound"]'),
          scratchLeg: node.querySelector('[data-cow="scratch-leg"]'),
          scratchHoof: node.querySelector('[data-cow="scratch-hoof"]'),
          // A rigged species has these instead of the groups above; see
          // AnimalJointed. Empty for the four that are still capsules.
          rig: node.querySelectorAll('[data-rig]'),
        });
      });
    }
    return made.get(id);
  };

  // One frame loop for the whole herd on this page, and nothing about a
  // cow in React state between one being put down and it being rubbed out.
  //
  // Before a frame, so a cow that has just been put down is in the right
  // place in the frame it appears in rather than the one after it. And a
  // loop only while the page is somewhere near the window: a cow four
  // screens up is still grazing when you get back to it, but it is not
  // grazing on the battery in between.
  useLayoutEffect(() => {
    for (const id of [...animalRefsRef.current.keys()]) {
      if (!animals.some((c) => c.id === id)) animalRefsRef.current.delete(id);
    }
    if (!animals.length || !size.width) return undefined;
    const paint = (now) => {
      // A low-frequency social preference, not collision physics. This
      // vector is merely consulted the next time an animal chooses to walk;
      // it never pushes a body already standing or changes a route mid-step.
      for (let i = 0; i < animals.length; i += 1) {
        const c = animals[i];
        let openX = 0;
        let openY = 0;
        for (let j = 0; j < animals.length; j += 1) {
          if (i === j) continue;
          let dx = c.x - animals[j].x;
          let dy = c.y - animals[j].y;
          let distance = Math.hypot(dx, dy);
          if (distance >= 0.30) continue;
          if (distance < 0.002) {
            const angle = ((c.seed || 0.3) - (animals[j].seed || 0.7)) * Math.PI * 2;
            dx = Math.cos(angle) * 0.002;
            dy = Math.sin(angle) * 0.002;
            distance = 0.002;
          }
          const weight = (1 - distance / 0.30) ** 2;
          openX += (dx / distance) * weight;
          openY += (dy / distance) * weight;
        }
        c.crowdX = openX;
        c.crowdY = openY;
      }
      for (const c of animals) {
        const parts = animalPartsRef.current.get(c.id);
        if (!parts) continue;
        c.speedScale = animalSpeed;
        const previousActivity = c.activityScale ?? 1;
        c.activityScale = animalActivity;
        if (animalActivity > previousActivity) {
          c.specialAt = 0;
          c.until = Math.min(c.until || Infinity, performance.now() + 600);
        }
        const spec = animalFor(c.kind);
        const k = (spec.size * size.width) / spec.box.w;
        poseAnimal(c, parts, now, k, c.x * size.width, (1 - c.y) * size.height);
      }
    };
    if (stillAnimals) {
      for (const c of animals) {
        c.turn = c.facing === 1 ? -1 : 1;
        c.gait = 0;
        c.head = 0;
        c.ear = 0;
        // Everything an activity was holding the body in, let go of: a
        // reader who turns the setting on halfway through should get an
        // animal standing where it was put, not one frozen mid-scratch
        // with a foot in the air or sunk down into a loaf.
        c.paw = 0;
        c.pawWag = 0;
        c.tilt = 0;
        c.sink = 0;
        c.tailTill = 0;
        c.act = null;
        c.born = -1e6;
      }
      paint(performance.now());
      return undefined;
    }
    paint(performance.now());
    // Keep the lightweight animal clock running after its source page
    // scrolls out of view, otherwise a follower freezes before reaching
    // the gray gutter. PDF canvas and text work remain visibility-gated.
    let last = performance.now();
    let raf = 0;
    const frame = (now) => {
      // A tab in the background is given no frames at all, and comes back
      // holding a gap of minutes. Capped, because the herd should be where
      // it was left rather than somewhere across the field.
      const dt = Math.min(50, now - last);
      last = now;
      for (const c of animals) stepAnimal(c, dt, now);
      paint(now);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [animals, visible, size.width, size.height, stillAnimals, animalSpeed, animalActivity]);

  // The anchor in hand is the anchor it drops: the same path, at the size
  // the pin is drawn, with the hotspot on the point the pin hangs from — so
  // where the cursor says it will land is where it lands. A margin round
  // the box, because the white it is outlined in has to go somewhere.
  const anchorCursor = (gold) => {
    const PAD = 1.2;
    const unit = 24 + PAD * 2;
    const px = 30 * (unit / 24);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${px.toFixed(1)}" ` +
      `height="${px.toFixed(1)}" viewBox="${-PAD} ${-PAD} ${unit} ${unit}">` +
      `<path d="${ANCHOR_D}" fill="none" stroke="#ffffff" stroke-width="2.4" ` +
      `stroke-linejoin="round"/>` +
      `<path d="${ANCHOR_D}" fill="${gold ? '#b3923d' : '#2b4a6f'}" fill-rule="evenodd"/></svg>`;
    const hot = (v) => (((v + PAD) * px) / unit).toFixed(1);
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hot(ANCHOR_HANG.x)} ${hot(
      ANCHOR_HANG.y
    )}, copy`;
  };

  // A cow in hand, at the size the cow will be, with the hotspot under its
  // feet — a cow is put down on the ground, not centred on a point.
  //
  // The line the cursor is inked at, in screen pixels rather than in the
  // animal's box, so that it is the same line whatever species is in hand
  // and whatever the clamp below did to the size. A fifth again the page's
  // own weight, because a cursor is small and a hairline in one is a
  // cursor with nothing in it.
  const CURSOR_PEN = 1.8;
  const cowCursor = () => {
    const held = animalFor(animal);
    const w = Math.min(96, Math.max(28, held.size * size.width * scale));
    const h = (w * held.box.h) / held.box.w;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w.toFixed(1)}" height="${h.toFixed(1)}" ` +
      `viewBox="0 0 ${held.box.w} ${held.box.h}">` +
      // A fifth again the page's line, because a cursor is small and a
      // hairline in a cursor is a cursor with nothing in it. Worked out
      // from `w` rather than taken from the spec, because `w` is clamped:
      // a cat pinned to the twenty-eight-pixel floor is not being drawn at
      // its own size any more, and a stroke that assumed it was would come
      // out heavier on the small animals at exactly the sizes where it
      // shows most. This lands on the same pixels whatever the clamp did.
      (held.painted
        ? `<g stroke-width="${((CURSOR_PEN * held.box.w) / w).toFixed(3)}">${held.painted}</g>`
        : `<g fill="#faf7ef" stroke="#33383f" ` +
          `stroke-width="${((CURSOR_PEN * held.box.w) / w).toFixed(3)}" ` +
          `stroke-linejoin="round">` +
          `${held.pale}</g><g fill="#33383f">${held.dark}</g>`) +
      `</svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${(w / 2).toFixed(1)} ${(
      (h * held.ground) / held.box.h
    ).toFixed(1)}, copy`;
  };

  // Ends that stop where the stroke stops. A round cap puts a half-disc of
  // ink past each end and a square cap puts half a square there, so with
  // either the paint began before the pointer did — by half the width of
  // the brush, which at the heaviest weight is most of a word. A butt cap
  // ends on the last point, which is where the hand was.
  //
  // Except for a stroke that is one point: a dot has no length for a butt
  // cap to end, and would draw nothing at all, so it keeps the square cap
  // that gives it a body.
  //
  // Joins stay round either way: a mitre spikes at an acute bend, and a
  // hand drawing freehand makes a great many acute bends.
  // A click leaves the brush's own footprint: the upright strip that was
  // under the hand, not a square. A square cap on a stroke with no length
  // draws a square block, which is neither the shape of the brush nor
  // anything the reader was shown before they pressed.
  const markFor = (points, thick, shape, extra) => {
    const swept = nibPath(points, thick, shape);
    if (swept) return <path d={swept} fillRule="nonzero" stroke="none" {...extra} />;
    const { fill, ...rest } = extra;
    return (
      <path
        d={pathFor(points)}
        stroke={fill}
        strokeWidth={thick}
        {...strokeProps}
        // After the defaults, not before, and always round: this branch is
        // the round nib, and a circle sitting on the last point of a path
        // does put half a disc of ink past it. Cutting that off squared the
        // ends of a brush that has none. It is also the only cap that
        // renders a click at all, a subpath with no length being invisible
        // under the butt cap the defaults carry.
        strokeLinecap="round"
        {...rest}
      />
    );
  };

  const strokeProps = {
    fill: 'none',
    strokeLinecap: 'butt',
    strokeLinejoin: 'round',
  };

  const pointAt = (e, note) => {
    e.stopPropagation();
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    onSelectNote(note.id);
  };

  const stretch = scale / renderScale;

  return (
    <div
      ref={holderRef}
      className="pdf-page"
      style={{
        width: size.width ? size.width * scale : undefined,
        height: size.height ? size.height * scale : undefined,
        cursor: hoveredCitation >= 0 ? 'pointer' : undefined,
      }}
      onPointerMove={(e) => {
        const at = anchorAt(e.clientX, e.clientY);
        overRef.current = true;
        lastAtRef.current = at;
        onHover({ page: pageNumber, anchor: at });
        if (tool !== 'arrow' || !e.target.closest?.('.textLayer')) {
          setHoveredCitation(-1);
          return;
        }
        const box = holderRef.current?.getBoundingClientRect();
        if (!box?.width || !box.height) {
          setHoveredCitation(-1);
          return;
        }
        const x = (e.clientX - box.left) / box.width;
        const y = (e.clientY - box.top) / box.height;
        setHoveredCitation(citations.findIndex((cite) => (
          x >= cite.x && x <= cite.x + cite.w && y >= cite.y && y <= cite.y + cite.h
        )));
      }}
      onPointerLeave={() => {
        overRef.current = false;
        setHoveredCitation(-1);
        onHover(null);
        setDoomed(EMPTY_DOOMED);
        onHoverInkObjects([]);
        setBrushAt(null);
        if (tool === 'clipper' && !clipRef.current) paintClipper(null, null);
      }}
      onClick={(e) => {
        if (tool !== 'arrow' || e.button !== 0 || !e.target.closest?.('.textLayer')) return;
        // Citation boxes must not sit between the pointer and selectable PDF
        // text. Resolve a genuine click by coordinates instead; a completed
        // drag has a non-collapsed selection and remains purely a selection.
        if (!window.getSelection()?.isCollapsed) return;
        const box = holderRef.current?.getBoundingClientRect();
        if (!box?.width || !box.height) return;
        const x = (e.clientX - box.left) / box.width;
        const y = (e.clientY - box.top) / box.height;
        const index = citations.findIndex((cite) => (
          x >= cite.x && x <= cite.x + cite.w && y >= cite.y && y <= cite.y + cite.h
        ));
        if (index < 0) return;
        const cite = citations[index];
        const anchor = holderRef.current.querySelector(`[data-citation-index="${index}"]`);
        if (!anchor) return;
        onOpenReference(cite.referenceId, anchor, cite.reference || null, cite.referenceIds);
      }}
      data-page={pageNumber}
    >
      {/* Drawn at renderScale and stretched to the scale being looked at:
          during a pinch this is a compositor transform, and the sharp
          re-render arrives when the gesture settles. */}
      <div
        className="page-inner"
        style={{
          width: size.width ? size.width * renderScale : undefined,
          height: size.height ? size.height * renderScale : undefined,
          transform: stretch === 1 ? undefined : `scale(${stretch})`,
        }}
      >
        {visible ? <canvas ref={canvasRef} /> : <div className="pdf-page-blank" />}
        {/* Selectable text sits above the drawing; a double-click passes
            through it to the page, so both reading and marking work. */}
        <div className="textLayer" ref={textRef} />
        {provenanceBox && <div className="provenance-box" style={boxStyle(provenanceBox)} />}
        {/* Ink: over the page and under the pins, because a mark belongs to
            the paper and a pin is a control sitting on top of it. Drawn in
            page units so a stroke keeps its weight at every zoom. */}
        {size.width > 0 && (
          <svg
            className="ink-layer"
            viewBox={`0 0 ${size.width} ${size.height}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {provenanceHighlights.length > 0 && (
              <g className="provenance-highlight">
                {provenanceHighlights.map((stroke, index) => (
                  <React.Fragment key={`${stroke.page}-${index}`}>
                    {markFor(stroke.points, stroke.width * size.width, 'flat', {
                      fill: '#f6cb41',
                      opacity: 0.7,
                    })}
                  </React.Fragment>
                ))}
              </g>
            )}
            {ink.map((stroke) => {
              const going = doomed.ink.includes(stroke.id);
              const object = stroke.group_id
                ? `group:${stroke.group_id}`
                : `stroke:${stroke.id}`;
              const eraserSelected = hoveredInkObjects.includes(object);
              const selected = selectedInk && (
                selectedInk.groupId
                  ? selectedInk.groupId === stroke.group_id
                  : selectedInk.id === stroke.id
              );
              const points = shifted(stroke);
              return (
                <g
                  key={stroke.id}
                  // The id, on the mark. Ink that would not rub out has
                  // been hard to catch precisely because there was no way
                  // to ask the page which stroke it was looking at.
                  data-ink={stroke.id}
                  className={[
                    selected ? 'selected' : '',
                    (inkDrag?.groupId
                      ? inkDrag.groupId === stroke.group_id
                      : inkDrag?.id === stroke.id) ? 'carrying' : '',
                  ].filter(Boolean).join(' ') || undefined}
                >
                  {/* Lit from behind in its own colour, so a stroke about
                      to go still looks like the stroke it is. */}
                  {(going || eraserSelected || selected) &&
                    markFor(points, stroke.width * size.width + HALO_SPREAD * 2, stroke.shape, {
                      fill: stroke.color,
                      opacity: 0.3,
                    })}
                  {markFor(points, stroke.width * size.width, stroke.shape, {
                    fill: stroke.color,
                    opacity: stroke.opacity ?? 1,
                  })}
                  {/* Something to take hold of. A drawn line is a few pixels
                      wide and a hand is not that accurate, so the thing that
                      listens is a fat transparent copy of it. Only with the
                      arrow: the brush and the eraser have their own business
                      with a stroke. */}
                  {tool === 'arrow' && (
                    <path
                      className="ink-grab"
                      d={pathFor(points)}
                      stroke="transparent"
                      strokeWidth={Math.max(stroke.width * size.width * 3, GRAB_WIDTH)}
                      strokeLinecap="square"
                      onPointerDown={(e) => startInkDrag(e, stroke)}
                      onPointerMove={moveInkDrag}
                      onPointerUp={endInkDrag}
                      onPointerCancel={endInkDrag}
                      {...strokeProps}
                    />
                  )}
                </g>
              );
            })}
            {wet &&
              markFor(laid(wet), inkWidth * size.width, inkShape, {
                fill: inkColor,
                opacity: inkOpacity,
              })}
            {/* The brush itself, drawn on the page rather than handed to
                the browser as a cursor image. A cursor image is dropped
                past about 128px, so on a zoomed page it could not keep up
                with the ink and the two stopped agreeing — which is what
                capped the zoom. Here it is in the stroke's own coordinates,
                so it is the stroke's own thickness at any zoom, exactly,
                with nothing to clamp and no ceiling to reach. No rim: the
                brush is the mark, and a white edge around it is a thing the
                mark will not have. */}
            {tool === 'brush' && brushAt && (
              <g pointerEvents="none">
                {inkShape === 'round' ? (
                  <circle
                    cx={brushAt.x * size.width}
                    cy={(1 - brushAt.y) * size.height}
                    r={(inkWidth * size.width) / 2}
                    fill={inkColor}
                    opacity={inkOpacity}
                  />
                ) : (
                  <rect
                    x={brushAt.x * size.width - (inkWidth * size.width) / (2 * STRIP_RATIO)}
                    y={(1 - brushAt.y) * size.height - (inkWidth * size.width) / 2}
                    width={(inkWidth * size.width) / STRIP_RATIO}
                    height={inkWidth * size.width}
                    fill={inkColor}
                    opacity={inkOpacity}
                  />
                )}
              </g>
            )}
            {/* A cow is a set of groups with nothing on them: every
                transform here, down to where the animal is standing, is
                written by the frame loop above. Nothing React renders and
                the loop writes is ever the same attribute, so the two are
                never arguing over one. */}
            {animals.map((animalRecord) => (
              <g
                key={animalRecord.id}
                ref={animalRef(animalRecord.id)}
                className={doomed.animals.includes(animalRecord.id) ? 'cow going' : 'cow'}
              >
                <AnimalJointed spec={animalFor(animalRecord.kind)} />
                {/* Taken hold of anywhere on it. The box that listens sits
                    outside the turn, because halfway through one the animal
                    is edge-on and a box that turned with it would be a few
                    pixels wide just as a hand reached for it. */}
                {tool === 'arrow' && (
                  <rect
                    className="cow-grab"
                    x={-animalFor(animalRecord.kind).box.w / 2}
                    y={-animalFor(animalRecord.kind).box.h / 2}
                    width={animalFor(animalRecord.kind).box.w}
                    height={animalFor(animalRecord.kind).box.h}
                    fill="transparent"
                    onPointerDown={(e) => startAnimalDrag(e, animalRecord)}
                    onPointerMove={moveAnimalDrag}
                    onPointerUp={endAnimalDrag}
                    onPointerCancel={endAnimalDrag}
                  />
                )}
              </g>
            ))}
            {laserRuns().map((run) => (
              <path
                key={run.key}
                d={run.d}
                stroke={laserColor}
                strokeWidth={size.width * LASER_WIDTH}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                opacity={run.fade}
              />
            ))}
            {laserRef.current.length > 0 && (
              <circle
                cx={laserRef.current[laserRef.current.length - 1].x * size.width}
                cy={(1 - laserRef.current[laserRef.current.length - 1].y) * size.height}
                r={size.width * LASER_WIDTH * 1.1}
                fill={laserColor}
                opacity={
                  laserRef.current[laserRef.current.length - 1].held
                    ? 1
                    : Math.max(
                        0,
                        1 -
                          (performance.now() -
                            laserRef.current[laserRef.current.length - 1].t) /
                            laserRef.current[laserRef.current.length - 1].life
                      )
                }
              />
            )}
          </svg>
        )}
        {/* With a tool in hand the page is a surface to draw on: this sits
            over the text layer so a drag lays ink instead of selecting
            words. With the arrow it is not here at all, and reading is
            exactly as it was. */}
        {tool !== 'arrow' && (
          <div
            className={`ink-surface tool-${tool}`}
            style={
              tool === 'brush'
                ? undefined
                : tool === 'anchor'
                  ? { cursor: anchorCursor(false) }
                  : tool === 'cow'
                    ? { cursor: cowCursor() }
                    : undefined
            }
            onPointerDown={inkDown}
            onPointerMove={inkMove}
            onPointerUp={inkUp}
            onPointerCancel={inkUp}
          >
            {tool === 'clipper' && (
              <span className="clipper-overlay" ref={clipOverlayRef}>
                <i className="clip-window" ref={clipWindowRef} />
                <i className="clip-guide vertical" ref={clipVerticalRef} />
                <i className="clip-guide horizontal" ref={clipHorizontalRef} />
              </span>
            )}
          </div>
        )}
        {/* What the author linked: a place in the paper, or a page on the
            web. Under the citation layer, so where a link is both, the
            card wins over the jump. */}
        <div className="link-layer">
          {links.map((link, i) =>
            link.href ? (
              <a
                key={`u${i}`}
                className="pdf-link"
                href={link.href}
                target="_blank"
                rel="noreferrer noopener"
                title={link.href}
                style={boxStyle(link)}
              />
            ) : (
              <button
                key={`d${i}`}
                type="button"
                className="pdf-link"
                title={link.kind === 'figure'
                  ? `Go to Figure ${link.label}`
                  : `Go to page ${link.spot.page}`}
                aria-label={link.kind === 'figure'
                  ? `Go to Figure ${link.label}`
                  : `Go to page ${link.spot.page}`}
                style={boxStyle(link)}
                onClick={(e) => {
                  e.stopPropagation();
                  onFollowLink(link.spot);
                  e.currentTarget.blur();
                }}
              />
            )
          )}
        </div>
        {/* Citations sit above the text layer: a click on "[12]" belongs
            to the reference it names, not to the words beneath it. The
            layer itself lets everything else through. */}
        <div className="cite-layer">
          {citations.map((cite, i) => (
            <button
              key={`${cite.referenceId}-${i}`}
              type="button"
              data-citation-index={i}
              data-reference-id={cite.referenceId}
              className={`cite${i === hoveredCitation ? ' hovered' : ''}${
                (cite.referenceIds || [cite.referenceId]).includes(openReferenceId) ? ' open' : ''}${
                cite.exact ? '' : ' guessed'
              }`}
              style={{
                left: `${cite.x * 100}%`,
                top: `${cite.y * 100}%`,
                width: `${cite.w * 100}%`,
                height: `${cite.h * 100}%`,
              }}
              title={cite.exact ? 'What is this?' : 'What is this? (matched by number)'}
              aria-label={`Open reference ${cite.label || ''}`.trim()}
              onClick={(e) => {
                e.stopPropagation();
                onOpenReference(
                  cite.referenceId,
                  e.currentTarget,
                  cite.reference || null,
                  cite.referenceIds
                );
              }}
            />
          ))}
        </div>
        <div className="pin-layer">
          {notes.map((note) => (
            <button
              key={note.id}
              type="button"
              className={`pin${doomed.notes.includes(note.id) ? ' going' : ''}${
                note.id === activeNoteId ? ' active' : ''
              }${
                note.drifted ? ' drifted' : ''
              }${note.content ? '' : ' bare'}${
                drag?.id === note.id && drag.moved ? ' dragging' : ''
              }`}
              style={{
                // The y fraction is measured from the bottom in PDF space and
                // drawn from the top in CSS.
                left: `${(drag?.id === note.id ? drag.anchor : note.anchor).x * 100}%`,
                top: `${(1 - (drag?.id === note.id ? drag.anchor : note.anchor).y) * 100}%`,
              }}
              title={note.content || 'An anchor with no note yet'}
              onPointerDown={(e) => startDrag(e, note)}
              onPointerMove={onDragMove}
              onPointerUp={(e) => endDrag(e, note)}
              onClick={(e) => pointAt(e, note)}
            >
              <GlyphFor note={note} />
            </button>
          ))}
        </div>
      </div>
      {clips.map((clip) => (
        <ClipBox
          key={clip.id}
          clip={clip}
          sourceCanvas={canvasRef.current}
          sourceRevision={canvasRevision}
          selected={selectedClipId === clip.id}
          onChange={(change) => onUpdateClip(clip.id, change)}
          onCommit={(frame) => onCommitClip(clip.id, frame)}
          onRemove={() => onRemoveClip(clip.id)}
          onSelect={() => onSelectClip(clip.id)}
          onSend={(blob) => onSendClip(clip, blob)}
        />
      ))}
      <span className="page-number">{pageNumber}</span>
    </div>
  );
}
