import React, { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import { GlyphFor } from './glyphs';

/**
 * One rendered page, plus the pins that live on it.
 *
 * Two coordinate systems meet here and only here. pdf.js draws in device
 * pixels at whatever scale the reader has chosen; a note is stored as a
 * fraction of the page in PDF user space, origin bottom-left. `viewport`
 * converts between them, so nothing above this component ever sees a pixel.
 */
export default function PdfPage({
  doc,
  pageNumber,
  scale,
  renderScale,
  notes,
  activeNoteId,
  onPlace,
  onMarkPlace,
  onSelectNote,
  onMoveNote,
}) {
  const canvasRef = useRef(null);
  const holderRef = useRef(null);
  const textRef = useRef(null);
  const renderTaskRef = useRef(null);
  const textTaskRef = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [visible, setVisible] = useState(false);
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
      onDoubleClick={handleDoubleClick}
      onClick={markedPlace}
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
        <div className="pin-layer">
          {notes.map((note) => (
            <button
              key={note.id}
              type="button"
              className={`pin${note.id === activeNoteId ? ' active' : ''}${
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
