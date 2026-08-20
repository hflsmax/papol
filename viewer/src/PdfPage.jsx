import React, { useEffect, useRef, useState } from 'react';

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
  notes,
  activeNoteId,
  placing,
  onPlace,
  onSelectNote,
}) {
  const canvasRef = useRef(null);
  const holderRef = useRef(null);
  const renderTaskRef = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [visible, setVisible] = useState(false);

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

  // The page's size is known before it is drawn, so the placeholder holds
  // its place in the scroll and nothing jumps when the canvas arrives.
  useEffect(() => {
    let cancelled = false;
    doc.getPage(pageNumber).then((page) => {
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      setSize({ width: viewport.width, height: viewport.height });
    });
    return () => {
      cancelled = true;
    };
  }, [doc, pageNumber, scale]);

  useEffect(() => {
    if (!visible || !canvasRef.current) return undefined;
    let cancelled = false;

    doc.getPage(pageNumber).then((page) => {
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
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
  }, [doc, pageNumber, scale, visible]);

  const handleClick = async (e) => {
    if (!placing) return;
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
    onPlace({
      page: pageNumber,
      anchor: {
        type: 'point',
        x: Math.min(Math.max(x / pageWidth, 0), 1),
        y: Math.min(Math.max(y / pageHeight, 0), 1),
      },
    });
  };

  return (
    <div
      ref={holderRef}
      className={`pdf-page${placing ? ' placing' : ''}`}
      style={{ width: size.width || undefined, height: size.height || undefined }}
      onClick={handleClick}
      data-page={pageNumber}
    >
      {visible ? <canvas ref={canvasRef} /> : <div className="pdf-page-blank" />}
      <div className="pin-layer">
        {notes.map((note) => (
          <button
            key={note.id}
            type="button"
            className={`pin${note.id === activeNoteId ? ' active' : ''}${
              note.drifted ? ' drifted' : ''
            }`}
            style={{
              // The y fraction is measured from the bottom in PDF space and
              // drawn from the top in CSS.
              left: `${note.anchor.x * 100}%`,
              top: `${(1 - note.anchor.y) * 100}%`,
            }}
            title={note.content}
            onClick={(e) => {
              e.stopPropagation();
              onSelectNote(note.id);
            }}
          >
            {note.index}
          </button>
        ))}
      </div>
      <span className="page-number">{pageNumber}</span>
    </div>
  );
}
