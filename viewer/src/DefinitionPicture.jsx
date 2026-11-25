import React, { useEffect, useRef, useState } from 'react';

// A definition as the paper prints it, for the reader choosing a term's
// definition to read before they choose: the definition's box cut from its
// page and drawn across the row. Drawn when the row comes into view, so a
// paper with fifty definitions draws the few being looked at.
export default function DefinitionPicture({ doc, page, box }) {
  const holderRef = useRef(null);
  const canvasRef = useRef(null);
  const [shape, setShape] = useState(null);

  useEffect(() => {
    const holder = holderRef.current;
    if (!doc || !holder) return undefined;
    let cancelled = false;
    let task = null;
    const draw = async () => {
      const sheet = await doc.getPage(page);
      if (cancelled) return;
      const viewport = sheet.getViewport({ scale: 1 });
      const width = box.w * viewport.width;
      const height = box.h * viewport.height;
      if (!cancelled) setShape(width / height);
      const across = holder.clientWidth || 480;
      const scale = (across / width) * Math.min(window.devicePixelRatio || 1, 2);
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      task = sheet.render({
        canvasContext: context,
        viewport,
        transform: [scale, 0, 0, scale, -box.x * viewport.width * scale, -box.y * viewport.height * scale],
      });
      try { await task.promise; } catch { /* put away before it was drawn */ }
    };
    if (typeof IntersectionObserver !== 'function') {
      draw();
      return () => { cancelled = true; task?.cancel(); };
    }
    const seen = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      seen.disconnect();
      draw();
    }, { rootMargin: '200px' });
    seen.observe(holder);
    return () => { cancelled = true; seen.disconnect(); task?.cancel(); };
  }, [doc, page, box.x, box.y, box.w, box.h]);

  return (
    <span className="define-picture" ref={holderRef} style={{ aspectRatio: shape ?? (box.w / box.h) * 0.77 }}>
      <canvas ref={canvasRef} aria-hidden="true" />
    </span>
  );
}
