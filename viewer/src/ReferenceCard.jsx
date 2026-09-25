import React, { useLayoutEffect, useRef, useState } from 'react';
import { appPath } from './base';
import { useDismiss } from '../../shared/useDismiss.js';
import { paperName } from '../../shared/paperName.js';
import ExperimentalBadge from '../../shared/ui/ExperimentalBadge.jsx';

/**
 * What a citation turns out to be, shown beside the marker that was
 * clicked.
 *
 * The card is deliberately willing to be thin. A reference that could not
 * be matched still shows the line exactly as the author printed it, with a
 * way to go and search for it — which is more than the user had before
 * clicking, and honest about what is known.
 */

const WIDTH = 440;
const MARGIN = 12;

export default function ReferenceCard({
  anchor, reference, error, requiresNook = false, onClose,
  position = 0, count = 1, onPrevious, onNext, onReportProblem,
  places = null, exploring = false, onPreviousPlace, onNextPlace, backTo = null, onBack,
}) {
  const cardRef = useRef(null);
  // Where the card last sat across the window. While the reader steps
  // through the places a work is cited, each marker is brought to where the
  // last one was, so the card keeps its height by itself; it keeps this too,
  // or a marker in the other column would carry it — and the button under
  // the pointer — half a page sideways.
  const heldLeft = useRef(null);
  const holding = exploring;
  const [showAll, setShowAll] = useState(false);

  // Placed after measuring: whether the card fits below the marker depends
  // on how tall it turned out to be, which depends on what came back.
  //
  // On a narrow screen the card is wider than the window, and on a short
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
      const scroller = anchor.closest('.pages');
      if (!scroller) return;
      const scrollerBox = scroller.getBoundingClientRect();
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
      const viewportLeft = Math.min(
        Math.max(MARGIN, holding && heldLeft.current != null
          ? heldLeft.current
          : box.left + box.width / 2 - width / 2),
        Math.max(MARGIN, window.innerWidth - width - MARGIN)
      );
      heldLeft.current = viewportLeft;
      const viewportTop = below
        ? box.bottom + MARGIN
        : Math.max(MARGIN, box.top - MARGIN - Math.min(height, cap));

      // The card lives in the same scroll container as the PDF. Convert its
      // viewport placement into that container's content coordinates once;
      // after that the browser scrolls marker and card in one operation.
      el.style.width = `${width}px`;
      el.style.maxHeight = `${cap}px`;
      el.style.transform = `translate3d(${
        viewportLeft - scrollerBox.left + scroller.scrollLeft
      }px, ${viewportTop - scrollerBox.top + scroller.scrollTop}px, 0)`;
    };

    place();
    // Scroll is captured because it does not bubble; this follows the
    // paper's own scroller as well as the window. ResizeObserver covers a
    // zoom changing the marker's box without changing the window itself.
    window.addEventListener('resize', place);
    const observer = new ResizeObserver(place);
    observer.observe(anchor);
    return () => {
      window.removeEventListener('resize', place);
      observer.disconnect();
    };
  }, [anchor, reference, error, requiresNook, showAll, holding]);

  // A press anywhere else puts the card away; Escape is the viewer's
  // central keyboard business.
  useDismiss(true, cardRef, onClose, { escape: false });

  const work = reference?.resolution;
  const raw = reference?.raw;
  const looking = !reference || (!work && !reference.resolved_status && !error);
  const status = reference?.resolved_status;
  const waiting = !requiresNook && (
    looking || status === 'pending_analysis' || status === 'resolving'
  );
  const waitingMessage = status === 'pending_analysis'
    ? 'Preparing this reference’s details…'
    : status === 'resolving'
      ? 'Looking up abstract and citation data…'
      : 'Looking this reference up…';
  const showRaw = raw && (
    requiresNook || looking || status === 'resolving' || status === 'pdf_text'
  );

  // A wrong match, a wrong reference behind the marker, a card that never
  // finishes: the reader is the one who can tell. It sits at the end of
  // the links row when the card has one.
  const report = onReportProblem && (
    <button type="button" className="link-button ref-report-button" onClick={onReportProblem}>
      Report a problem
    </button>
  );
  const linksRow = (!looking && work)
    || (!requiresNook && !waiting && !work && status !== 'pdf_text' && raw);

  // Where else the paper cites this work, and the way through them. From
  // the first step it is an exploration, and says so, and where it has got
  // to; Back ends it where it began, as [ does.
  //
  // A press does not take the focus: the reader goes on with ↑ and ↓ on the
  // keyboard, and a button left focused would light up as the keyboard's.
  const keepFocus = (e) => e.preventDefault();
  const placesRow = places && (
    <div className={`ref-places${holding ? ' exploring' : ''}`}>
      <div className="ref-places-row">
        <span className="ref-places-what" aria-live="polite">
          {holding ? (
            <>
              <strong>Exploring</strong>
              {` ${places.at + 1} of ${places.count} · page ${places.page}${places.exact ? '' : ' · guessed'}`}
            </>
          ) : places.count === 1 ? 'Cited only here' : `Cited ${places.count} times in this paper`}
        </span>
        {places.count > 1 && (
          <nav className="ref-places-nav" aria-label="Places this paper cites it">
            {holding && onBack && (
              <button
                type="button"
                className="ref-places-home"
                onMouseDown={keepFocus}
                onClick={onBack}
                title={`Back to ${backTo ? `page ${backTo}` : 'where you were'} ([)`}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.25 5.25 8 10 12.75" /></svg>
                Back
              </button>
            )}
            <button type="button" onMouseDown={keepFocus} onClick={onPreviousPlace} aria-label="Previous place it is cited" title={`Previous place it is cited${holding ? ' (↑)' : ''}`}>
              ↑
            </button>
            <button type="button" onMouseDown={keepFocus} onClick={onNextPlace} aria-label="Next place it is cited" title={`Next place it is cited${holding ? ' (↓)' : ''}`}>
              ↓
            </button>
          </nav>
        )}
      </div>
    </div>
  );

  return (
    <div
      ref={cardRef}
      className="ref-card"
      style={{
        width: WIDTH,
        left: 0,
        top: 0,
        transform: 'translate3d(-9999px, 0, 0)',
        visibility: anchor ? undefined : 'hidden',
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button className="dismiss-button card-x" onClick={onClose} aria-label="Close" title="Close">
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

      {requiresNook && (
        <p className="ref-unmatched">
          Add this paper to your nook to enable citation lookup feature.
        </p>
      )}

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
              {status === 'pdf_text' ? 'Search for it' : 'Open on Google Scholar'}
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
            <button className="link-button ref-more" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'less' : 'more'}
            </button>
          )}

          <div className="ref-links">
            {reference.papol_paper_sha256 && (
              // Papol already holds this paper: the user can go to it
              // rather than out to a publisher.
              <a className="ref-link here" href={appPath(`/paper/${paperName(reference.papol_paper_sha256)}`)}>
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
            {report}
          </div>
        </>
      )}

      {!requiresNook && !waiting && !work && status !== 'pdf_text' && (
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
              {report}
            </div>
          )}
        </>
      )}

      {/* Without a row of links, the report stands on its own. */}
      {report && !linksRow && <div className="ref-report">{report}</div>}

      {placesRow}
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
