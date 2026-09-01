import React, { useLayoutEffect, useRef, useState } from 'react';
import { appPath } from './base';
import ExperimentalBadge from './ExperimentalBadge';

/**
 * What a citation turns out to be, shown beside the marker that was
 * clicked.
 *
 * The card is deliberately willing to be thin. A reference that could not
 * be matched still shows the line exactly as the author printed it, with a
 * way to go and search for it — which is more than the reader had before
 * clicking, and honest about what is known.
 */

const WIDTH = 400;
const MARGIN = 12;

export default function ReferenceCard({
  anchor, reference, error, onClose, position = 0, count = 1, onPrevious, onNext,
}) {
  const cardRef = useRef(null);
  const [placement, setPlacement] = useState(null);
  const [showAll, setShowAll] = useState(false);

  // Placed after measuring: whether the card fits below the marker depends
  // on how tall it turned out to be, which depends on what came back.
  //
  // On a narrow screen 400 points is wider than the window, and on a short
  // one neither side of the marker has room for the whole card. So the
  // width is what the window can spare, and the card takes the roomier
  // side of the marker and is capped to what that side actually holds —
  // scrolling inside itself rather than hanging off the screen.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el || !anchor) return undefined;

    const place = () => {
      if (!anchor.isConnected) return;
      const box = anchor.getBoundingClientRect();
      const width = Math.min(WIDTH, window.innerWidth - 2 * MARGIN);
      const height = el.offsetHeight;
      const roomBelow = window.innerHeight - box.bottom - 2 * MARGIN;
      const roomAbove = box.top - 2 * MARGIN;
      const below = height <= roomBelow || roomBelow >= roomAbove;
      // Never taller than the side it sits on, and never more than about
      // two thirds of the window even when there is room: the card is an
      // aside about the page, not a replacement for it.
      const cap = Math.max(
        160,
        Math.min(below ? roomBelow : roomAbove, window.innerHeight * 0.62)
      );
      setPlacement({
        width,
        left: Math.min(
          Math.max(MARGIN, box.left + box.width / 2 - width / 2),
          Math.max(MARGIN, window.innerWidth - width - MARGIN)
        ),
        top: below
          ? box.bottom + MARGIN
          : Math.max(MARGIN, box.top - MARGIN - Math.min(height, cap)),
        maxHeight: cap,
      });
    };

    place();
    // Scroll is captured because it does not bubble; this follows the
    // paper's own scroller as well as the window. ResizeObserver covers a
    // zoom changing the marker's box without changing the window itself.
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    const observer = new ResizeObserver(place);
    observer.observe(anchor);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      observer.disconnect();
    };
  }, [anchor, reference, error, showAll]);

  // A click anywhere else puts the card away. Registered on the window in
  // a capture phase so it fires before anything else takes the click.
  useLayoutEffect(() => {
    const onDown = (e) => {
      if (!cardRef.current?.contains(e.target)) onClose();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [onClose]);

  const work = reference?.resolution;
  const raw = reference?.raw;
  const looking = !reference || (!work && !reference.resolved_status && !error);
  const status = reference?.resolved_status;
  const waiting = looking || status === 'pending_analysis' || status === 'resolving';
  const waitingMessage = status === 'pending_analysis'
    ? 'Preparing this reference’s details…'
    : status === 'resolving'
      ? 'Looking up abstract and citation data…'
      : 'Looking this reference up…';
  const showRaw = raw && (looking || status === 'resolving' || status === 'pdf_text');

  return (
    <div
      ref={cardRef}
      className="ref-card"
      style={{
        width: placement ? placement.width : WIDTH,
        left: placement ? placement.left : -9999,
        top: placement ? placement.top : 0,
        maxHeight: placement ? placement.maxHeight : undefined,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button className="card-x" onClick={onClose} aria-label="Close" title="Close">
        ×
      </button>

      <div className="ref-card-header">
        <div className="ref-experimental">
          <ExperimentalBadge />
        </div>
        {count > 1 && (
          <nav className="ref-range-nav" aria-label="References in citation range">
            <button type="button" onClick={onPrevious} disabled={!onPrevious} aria-label="Previous reference">
              ←
            </button>
            <span>{position + 1}/{count}</span>
            <button type="button" onClick={onNext} disabled={!onNext} aria-label="Next reference">
              →
            </button>
          </nav>
        )}
      </div>

      {waiting && <p className="ref-looking">{waitingMessage}</p>}

      {showRaw && (
        <>
          <p className="ref-raw">{raw}</p>
          <div className="ref-links">
            <a
              className="ref-link"
              href={scholarSearch(raw)}
              target="_blank"
              rel="noreferrer"
            >
              {status === 'pdf_text' ? 'Search for it' : 'Search now'}
            </a>
          </div>
        </>
      )}

      {!looking && work && (
        <>
          <h3 className="ref-title">
            {work.url ? (
              <a href={work.url} target="_blank" rel="noreferrer">
                {work.title || raw}
              </a>
            ) : (
              work.title || raw
            )}
          </h3>

          {!!(work.authors || []).length && (
            <p className="ref-authors">{authorLine(work.authors)}</p>
          )}

          <p className="ref-where">
            {[work.venue, work.year].filter(Boolean).join(' · ')}
            {typeof work.citations === 'number' && (
              <span className="ref-cited">
                Cited by {work.citations.toLocaleString()}
              </span>
            )}
          </p>

          {work.abstract && (
            <p className={`ref-abstract${showAll ? ' full' : ''}`}>
              {work.abstract}
            </p>
          )}
          {work.abstract && work.abstract.length > 280 && (
            <button className="link ref-more" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'less' : 'more'}
            </button>
          )}

          <div className="ref-links">
            {reference.papol_paper_id && (
              // Papol already holds this paper: the reader can go to it
              // rather than out to a publisher.
              <a className="ref-link here" href={appPath(`/paper/${reference.papol_paper_id}`)}>
                In Papol
              </a>
            )}
            {work.pdf_url && (
              <a className="ref-link" href={work.pdf_url} target="_blank" rel="noreferrer">
                PDF
              </a>
            )}
            {work.url && (
              <a className="ref-link" href={work.url} target="_blank" rel="noreferrer">
                {work.doi ? 'DOI' : 'Page'}
              </a>
            )}
            {raw && (
              <a
                className="ref-link"
                href={scholarSearch(raw)}
                target="_blank"
                rel="noreferrer"
              >
                Scholar
              </a>
            )}
          </div>
        </>
      )}

      {!waiting && !work && status !== 'pdf_text' && (
        <>
          <p className="ref-unmatched">
            {error || reference?.resolved_status === 'error'
              ? 'Could not look this up just now — try again in a moment.'
              : 'No match found for this reference.'}
          </p>
          {raw && <p className="ref-raw">{raw}</p>}
          {raw && (
            <div className="ref-links">
              <a
                className="ref-link"
                href={scholarSearch(raw)}
                target="_blank"
                rel="noreferrer"
              >
                Search for it
              </a>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Long author lists are a wall of names; the first few say who wrote it.
function authorLine(authors) {
  if (authors.length <= 4) return authors.join(', ');
  return `${authors.slice(0, 3).join(', ')}, and ${authors.length - 3} others`;
}

function scholarSearch(raw) {
  return `https://scholar.google.com/scholar?q=${encodeURIComponent(raw.slice(0, 250))}`;
}
