import React, { useMemo, useRef } from 'react';

/**
 * The paper, drawn to length across the bar.
 *
 * Not a menu that has to be opened: the whole document is already on
 * screen, so its shape is read rather than recalled. Each section is a
 * segment as wide as the section is long, which is why a glance says
 * Method is half the paper and Conclusion is a paragraph — a list of names
 * can never say that. The anchors run in a lane underneath at the same
 * scale, so an anchor sitting under the middle of Results is *in* Results,
 * and nothing has to say so. One click anywhere goes there.
 *
 * Everything is placed in document units: 0 at the top of page one, one
 * unit per page. A section and an anchor both reduce to a number on that
 * line, which is the whole of the arithmetic here.
 */

const positionOf = (page, y) => (
  (Math.max(1, page || 1) - 1) + (1 - Math.max(0, Math.min(1, y ?? 0)))
);

// A label needs about this much of the bar before it says anything useful.
// Below it a name is cut to three letters and an ellipsis, which is worse
// than no name at all: the segment is shape alone and its tooltip says the
// rest.
const ROOM_FOR_A_NAME = 0.06;

export default function DocumentMap({
  pages = 0,
  sections = [],
  anchors = [],
  place = null,
  current = null,
  onSection,
  onAnchor,
  onTop,
}) {
  const trackRef = useRef(null);
  const laneRef = useRef(null);

  const segments = useMemo(() => {
    if (!pages) return [];
    const marks = sections
      // Top-level sections only. A paper's subsections outnumber its
      // sections three to one, and drawn as their equals they turn the
      // strip into a barcode of boxes too narrow to name — which is the
      // opposite of seeing the shape of the paper. The sections are the
      // shape; the subsections are detail inside it.
      .filter((section) => (section.level ?? 0) === 0)
      .map((section) => ({ ...section, at: positionOf(section.page, section.y) }))
      .filter((section) => section.at >= 0 && section.at <= pages)
      // The outline keeps the author's order; a map keeps the paper's.
      .sort((a, b) => a.at - b.at);
    if (!marks.length) return [];
    const out = marks.map((mark, index) => ({
      ...mark,
      span: Math.max(0, (index + 1 < marks.length ? marks[index + 1].at : pages) - mark.at),
    }));
    // Whatever comes before the first heading is the front of the paper —
    // its title, its authors, usually its abstract. Part of the document,
    // so part of the map.
    if (marks[0].at > 0.02) {
      out.unshift({ id: 'front', front: true, at: 0, span: marks[0].at, title: 'Start' });
    }
    return out;
  }, [sections, pages]);

  const marks = useMemo(
    () => anchors.map((anchor) => ({ ...anchor, at: positionOf(anchor.page, anchor.anchorY) })),
    [anchors],
  );

  if (!pages || (segments.length === 0 && marks.length === 0)) return <span className="spacer" />;

  const percent = (at) => `${Math.max(0, Math.min(1, at / pages)) * 100}%`;

  // One tab stop for the strip, arrows to walk it — a bar should not cost
  // twenty-five presses to get past.
  const walk = (event, container) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const stops = [...(container.current?.children || [])].filter((el) => el.tagName === 'BUTTON');
    if (!stops.length) return;
    event.preventDefault();
    const at = stops.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? stops.length - 1
        : event.key === 'ArrowRight' ? Math.min(stops.length - 1, at + 1)
          : Math.max(0, at < 0 ? 0 : at - 1);
    stops[next]?.focus();
  };

  const focusable = (index, isCurrent) => (current ? (isCurrent ? 0 : -1) : (index === 0 ? 0 : -1));

  return (
    <div className="docmap" data-tauri-drag-region="false">
      <div
        className="docmap-track"
        ref={trackRef}
        role="toolbar"
        aria-label="Sections"
        onKeyDown={(event) => walk(event, trackRef)}
      >
        {segments.map((segment, index) => {
          const name = [segment.number, segment.title].filter(Boolean).join(' ');
          const isCurrent = !segment.front && segment.id === current;
          return (
            <button
              key={segment.id}
              type="button"
              className={`docmap-seg${isCurrent ? ' now' : ''}${segment.appendix ? ' back' : ''}${segment.front ? ' front' : ''}`}
              style={{ flexGrow: Math.max(segment.span, 0.0001) }}
              data-level={segment.level ?? 0}
              tabIndex={focusable(index, isCurrent)}
              aria-current={isCurrent ? 'true' : undefined}
              title={segment.front ? 'The start of the paper' : `${name} — page ${segment.page}`}
              aria-label={segment.front ? 'The start of the paper' : `${name}, page ${segment.page}`}
              onClick={() => (segment.front ? onTop() : onSection(segment))}
            >
              {segment.span / pages > ROOM_FOR_A_NAME && (
                <span className="docmap-name">{segment.front ? segment.title : name}</span>
              )}
            </button>
          );
        })}
      </div>

      <div
        className="docmap-lane"
        ref={laneRef}
        role="toolbar"
        aria-label="Anchors"
        onKeyDown={(event) => walk(event, laneRef)}
      >
        {marks.map((mark, index) => (
          <button
            key={mark.uuid}
            type="button"
            className="docmap-anchor"
            style={{ left: percent(mark.at) }}
            tabIndex={index === 0 ? 0 : -1}
            title={`${mark.label} — page ${mark.page}`}
            aria-label={`${mark.label}, page ${mark.page}`}
            onClick={() => onAnchor(mark)}
          >
            <span className="docmap-tick" aria-hidden="true" />
          </button>
        ))}
      </div>

      {place && (
        <span className="docmap-here" style={{ left: percent(positionOf(place.page, place.y)) }} />
      )}
    </div>
  );
}
