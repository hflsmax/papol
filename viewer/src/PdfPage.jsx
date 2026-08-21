import React, { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import { GlyphFor } from './glyphs';
import { pageOverlays } from './references';

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
// Samples nearer than this to the last add nothing but points to draw.
const LASER_STEP = 1.0;
// Points nearer than this to the last one add bytes and no shape. In page
// units, so it means the same thing on a tall page as on a wide one.
const MIN_STEP = 1.2;
// How near the eraser has to pass. Generous: rubbing something out is a
// gesture, not a click on a one-pixel line.
const ERASE_REACH = 9;
// An anchor is a pin the size of a fingertip rather than a line, so the
// eraser has to be nearer its point before it counts as over it.
const ANCHOR_REACH = 13;
// The ceiling the API enforces, applied here so a stroke is never refused
// after it has been drawn.
const MAX_POINTS = 4000;
// One object, so clearing the highlight does not count as a change.
const EMPTY_DOOMED = { ink: [], notes: [] };
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
  onPlace,
  onMarkPlace,
  onSelectNote,
  onMoveNote,
  tool,
  ink,
  inkColor,
  inkWidth,
  onDrawStroke,
  onEraseStroke,
  onEraseNote,
  onHover,
  onDropAnchor,
}) {
  const canvasRef = useRef(null);
  const holderRef = useRef(null);
  const textRef = useRef(null);
  const renderTaskRef = useRef(null);
  const textTaskRef = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [visible, setVisible] = useState(false);
  // The citation markers on this page. Worked out when the page first
  // comes into view, because finding them means resolving the PDF's own
  // links, and a page nobody has reached should not cost that.
  const [citations, setCitations] = useState([]);
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
  // The anchor the last double-click made, so a third click can turn it
  // into the reader's place rather than leaving a stray mark behind.
  const justPlacedRef = useRef(null);
  // Ink being laid down now. In a ref for the same reason the drag is:
  // pointermove outruns React, and the state beside it exists only to put
  // the wet stroke on screen while it is being made.
  const wetRef = useRef(null);
  const [wet, setWet] = useState(null);
  // Set once a stroke has snapped straight: from then on the pointer moves
  // the far end of the line rather than adding to a freehand path.
  const straightRef = useRef(false);
  const holdRef = useRef(null);
  // What the eraser is over. Shown lit rather than left to be guessed at:
  // rubbing out is not undoable here, and a reader should be able to see
  // what is about to go before they press.
  const [doomed, setDoomed] = useState(EMPTY_DOOMED);
  // The laser keeps nothing, so its trail is points with the moment each
  // was made, thrown away by a frame loop rather than stored anywhere.
  const laserRef = useRef([]);
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
      task.promise.catch((err) => {
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
      const task = new pdfjs.TextLayer({
        textContentSource: page.streamTextContent(),
        container,
        viewport,
      });
      textTaskRef.current = task;
      try {
        await task.render();
      } catch (err) {
        if (err?.name !== 'AbortException') throw err;
      }
    });

    return () => {
      cancelled = true;
      textTaskRef.current?.cancel();
    };
  }, [doc, pageNumber, renderScale, visible]);

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

  // Double-click marks a place. A single click belongs to the text layer,
  // so reading and selecting are never interrupted by note-taking.
  const handleDoubleClick = async (e) => {
    // Read the event before awaiting: React clears currentTarget once the
    // handler returns, so anything needed after an await must be captured
    // now.
    const box = e.currentTarget.getBoundingClientRect();
    const { clientX, clientY } = e;
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const [x, y] = viewport.convertToPdfPoint(clientX - box.left, clientY - box.top);
    // Stored as a fraction of the page, so the note lands in the same place
    // at any zoom, on any screen, at any rotation.
    const [, , pageWidth, pageHeight] = page.view;
    // A double-click also selects a word; the reader asked for an anchor.
    window.getSelection()?.removeAllRanges();
    justPlacedRef.current = onPlace({
      page: pageNumber,
      anchor: {
        type: 'point',
        x: Math.min(Math.max(x / pageWidth, 0), 1),
        y: Math.min(Math.max(y / pageHeight, 0), 1),
      },
    });
  };

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

  const onDragMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const moved =
      d.moved ||
      Math.abs(e.clientX - d.from.x) + Math.abs(e.clientY - d.from.y) > DRAG_SLOP;
    if (!moved) return;
    d.moved = true;
    const under = anchorAt(e.clientX, e.clientY);
    const clamp = (v) => Math.min(1, Math.max(0, v));
    d.anchor = {
      type: 'point',
      x: clamp(under.x - d.grab.x),
      y: clamp(under.y - d.grab.y),
    };
    setDrag({ id: d.id, anchor: d.anchor, moved: true });
  };

  const endDrag = (e, note) => {
    e.stopPropagation();
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d) return;
    draggedRef.current = d.moved;
    if (d.moved) onMoveNote(note.id, { page: pageNumber, anchor: d.anchor });
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
    if (last && inPageUnits(last, at) < LASER_STEP) return;
    laserRef.current = [...trail, { ...at, t: performance.now(), life: LASER_PASSING, held }];
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
    frameLaser();
  };

  // Quadratic segments through the midpoints of the samples: consecutive
  // segments meet at a midpoint sharing a tangent, so the trail is a curve
  // where straight lines between raw pointer samples showed every sample as
  // a corner. Each segment keeps its own age, so the tail can fade along
  // its length — which one smooth path could not do.
  const laserSegments = () => {
    const pts = laserRef.current;
    if (pts.length < 2) return [];
    const px = (p) => [p.x * size.width, (1 - p.y) * size.height];
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const at = (q) => `${q[0].toFixed(2)} ${q[1].toFixed(2)}`;
    const now = performance.now();
    const out = [];
    for (let i = 1; i < pts.length; i += 1) {
      const prev = px(pts[i - 1]);
      const here = px(pts[i]);
      const next = i + 1 < pts.length ? px(pts[i + 1]) : here;
      const left = i === 1 ? prev : mid(prev, here);
      const right = i + 1 < pts.length ? mid(here, next) : here;
      out.push({
        key: `${pts[i].t}-${i}`,
        d: `M${at(left)}Q${at(here)} ${at(right)}`,
        // Fading and thinning together: a trail that only faded read as a
        // line going grey rather than as one running out.
        fade: pts[i].held ? 1 : Math.max(0, 1 - (now - pts[i].t) / pts[i].life),
      });
    }
    return out;
  };

  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    if (holdRef.current != null) clearTimeout(holdRef.current);
  }, []);

  // Putting the eraser down puts out what it was lighting. Otherwise the
  // highlight is left behind on whatever happened to be under it, and
  // stays there — nothing else lights it, so nothing else turns it off.
  useEffect(() => {
    if (tool !== 'eraser') setDoomed(EMPTY_DOOMED);
  }, [tool]);

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
  // The same reckoning the eraser itself uses, so what lights up is exactly
  // what would go.
  const under = (at) => {
    const found = { ink: [], notes: [] };
    for (const stroke of ink) {
      const reach = ERASE_REACH + (stroke.width * size.width) / 2;
      if (stroke.points.some((p) => inPageUnits(p, at) < reach)) found.ink.push(stroke.id);
    }
    for (const note of notes) {
      if (note.content || note.current_place || !note.anchor) continue;
      if (inPageUnits(note.anchor, at) < ANCHOR_REACH) found.notes.push(note.id);
    }
    return found;
  };

  const eraseUnder = (at) => {
    for (const stroke of ink) {
      const reach = ERASE_REACH + (stroke.width * size.width) / 2;
      if (stroke.points.some((p) => inPageUnits(p, at) < reach)) onEraseStroke(stroke.id);
    }
    // An anchor is a mark on the page, so the eraser takes it too. What it
    // does not take is a note with words in it, or the reader's place: the
    // first is writing and the second is a bookmark, neither is something
    // drawn, and a swipe of the hand is no way to lose either — there is no
    // undo here. Both are still deleted from the pin's own menu.
    for (const note of notes) {
      if (note.content || note.current_place || !note.anchor) continue;
      if (inPageUnits(note.anchor, at) < ANCHOR_REACH) onEraseNote(note.id);
    }
  };

  const inkDown = (e) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const at = anchorAt(e.clientX, e.clientY);
    if (tool === 'anchor' || tool === 'here') {
      onDropAnchor({ page: pageNumber, anchor: { type: 'point', ...at } }, tool === 'here');
      return;
    }
    if (tool === 'brush') {
      stopStraighten();
      wetRef.current = [at];
      setWet(wetRef.current);
    } else if (tool === 'eraser') {
      eraseUnder(at);
    } else if (tool === 'laser') {
      pushLaser(at, true);
    }
  };

  const inkMove = (e) => {
    const at = anchorAt(e.clientX, e.clientY);
    // The laser follows a pointer that is only passing over, not just one
    // that is pressed: pointing at a figure while you talk about it is the
    // ordinary way to use it, and holding a button down to do that is not
    // how anyone points at anything.
    if (tool === 'laser') {
      pushLaser(at, (e.buttons & 1) === 1);
      return;
    }
    // The eraser lights up what it is over whether or not it is pressed:
    // knowing what would go is most useful before deciding to press.
    if (tool === 'eraser') {
      const found = under(at);
      setDoomed((was) =>
        was.ink.join() === found.ink.join() && was.notes.join() === found.notes.join()
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
      if (straightRef.current) {
        wetRef.current = [points[0], axisSnap(points[0], at)];
        setWet(wetRef.current);
        return;
      }
      if (points.length >= MAX_POINTS) return;
      if (inPageUnits(points[points.length - 1], at) < MIN_STEP) return;
      wetRef.current = [...points, at];
      setWet(wetRef.current);
      armStraighten();
    } else if (tool === 'laser') {
      laserRef.current = [...laserRef.current, { ...at, t: performance.now() }];
      frameLaser();
    }
  };

  // Kept when the pointer lifts, not as it moves: a stroke is one mark,
  // and half of one is not worth storing.
  const inkUp = () => {
    if (tool === 'laser') {
      releaseLaser();
      return;
    }
    stopStraighten();
    const points = wetRef.current;
    wetRef.current = null;
    setWet(null);
    if (tool === 'brush' && points?.length) {
      onDrawStroke({ page: pageNumber, points, color: inkColor, width: inkWidth });
    }
  };

  // A lone point is a dot the reader meant to make, and a path that only
  // moves draws nothing — so it is given somewhere to go.
  const pathFor = (points) => {
    const at = (p) => `${(p.x * size.width).toFixed(2)} ${((1 - p.y) * size.height).toFixed(2)}`;
    if (points.length === 1) return `M${at(points[0])}L${at(points[0])}`;
    return points.map((p, i) => `${i ? 'L' : 'M'}${at(p)}`).join('');
  };

  // The cursor is the mark it makes: a dot the width of the stroke, in the
  // colour of the stroke. A picture of a brush says which tool is in hand,
  // which the bar already says; what a reader aiming one actually wants to
  // know is where the ink will land and how much of it there will be.
  //
  // Built here rather than in the stylesheet because the answer moves: the
  // width is a fraction of the page, so how many pixels across it is
  // depends on the zoom.
  const brushCursor = () => {
    const across = inkWidth * size.width * scale;
    // Past about 128px a browser ignores a cursor image entirely, and a dot
    // that small is no longer a dot; both ends fall back to a crosshair.
    if (!across || across > 96) return 'crosshair';
    const r = Math.max(3, across / 2);
    const box = Math.ceil(r * 2 + 4);
    const c = box / 2;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${box}" height="${box}">` +
      `<circle cx="${c}" cy="${c}" r="${r}" fill="${inkColor}" ` +
      `stroke="#ffffff" stroke-width="1.4" stroke-opacity="0.9"/></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${c} ${c}, crosshair`;
  };

  const strokeProps = {
    fill: 'none',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };

  // A triple-click is a third click on the pair that just placed an anchor.
  // It may land on the page or on the new pin itself, so both ask.
  const markedPlace = (e) => {
    if (e.detail !== 3 || justPlacedRef.current == null) return false;
    onMarkPlace(justPlacedRef.current);
    justPlacedRef.current = null;
    return true;
  };

  const pointAt = (e, note) => {
    e.stopPropagation();
    if (markedPlace(e)) return;
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
      }}
      onPointerMove={(e) => onHover({ page: pageNumber, anchor: anchorAt(e.clientX, e.clientY) })}
      onPointerLeave={() => {
        onHover(null);
        setDoomed(EMPTY_DOOMED);
      }}
      onDoubleClick={tool === 'arrow' ? handleDoubleClick : undefined}
      onClick={tool === 'arrow' ? markedPlace : undefined}
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
            {ink.map((stroke) => {
              const going = doomed.ink.includes(stroke.id);
              return (
                <g key={stroke.id}>
                  {/* Lit from behind in its own colour, so a stroke about
                      to go still looks like the stroke it is. */}
                  {going && (
                    <path
                      d={pathFor(stroke.points)}
                      stroke={stroke.color}
                      strokeWidth={stroke.width * size.width * 3.4}
                      opacity="0.3"
                      {...strokeProps}
                    />
                  )}
                  <path
                    d={pathFor(stroke.points)}
                    stroke={stroke.color}
                    strokeWidth={stroke.width * size.width}
                    {...strokeProps}
                  />
                </g>
              );
            })}
            {wet && (
              <path
                d={pathFor(wet)}
                stroke={inkColor}
                strokeWidth={inkWidth * size.width}
                {...strokeProps}
              />
            )}
            {laserSegments().map((seg) => (
              <path
                key={seg.key}
                d={seg.d}
                stroke="#d0342c"
                strokeWidth={size.width * 0.005 * (0.35 + 0.65 * seg.fade)}
                strokeLinecap="round"
                fill="none"
                opacity={seg.fade}
              />
            ))}
            {laserRef.current.length > 0 && (
              <circle
                cx={laserRef.current[laserRef.current.length - 1].x * size.width}
                cy={(1 - laserRef.current[laserRef.current.length - 1].y) * size.height}
                r={size.width * 0.0055}
                fill="#d0342c"
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
            style={tool === 'brush' ? { cursor: brushCursor() } : undefined}
            onPointerDown={inkDown}
            onPointerMove={inkMove}
            onPointerUp={inkUp}
            onPointerCancel={inkUp}
          />
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
                title={`Go to page ${link.spot.page}`}
                aria-label={`Go to page ${link.spot.page}`}
                style={boxStyle(link)}
                onClick={(e) => {
                  e.stopPropagation();
                  onFollowLink(link.spot);
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
              className={`cite${cite.referenceId === openReferenceId ? ' open' : ''}${
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
                onOpenReference(cite.referenceId, e.currentTarget.getBoundingClientRect());
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
                note.current_place ? ' here' : ''
              }${drag?.id === note.id && drag.moved ? ' dragging' : ''}`}
              style={{
                // The y fraction is measured from the bottom in PDF space and
                // drawn from the top in CSS.
                left: `${(drag?.id === note.id ? drag.anchor : note.anchor).x * 100}%`,
                top: `${(1 - (drag?.id === note.id ? drag.anchor : note.anchor).y) * 100}%`,
              }}
              title={
                note.current_place
                  ? `Where you are${note.content ? `: ${note.content}` : ''}`
                  : note.content || 'An anchor with no note yet'
              }
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
      <span className="page-number">{pageNumber}</span>
    </div>
  );
}
