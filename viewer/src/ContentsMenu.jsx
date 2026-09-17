import React, { useEffect, useMemo, useRef } from 'react';
import { GlyphFor } from './glyphs';

/**
 * Where you are in the paper, and the way to anywhere else in it.
 *
 * It sits at the leading edge of the bar, beside Back, because that is
 * where navigation lives: the left of the bar answers "where am I", the
 * right is the tools you do things to the page with.
 *
 * The control is not an icon with a menu behind it — it says the section
 * being read. That makes the bar answer a question it never answered
 * before without anything being opened, and it makes the panel's purpose
 * obvious before anyone presses it. Where a paper offers no headings it
 * falls back to the word "Contents", which is also all it can honestly say.
 *
 * Inside, one list with one alignment: a number column on the left, a page
 * column on the right, the title taking whatever is between. That right
 * column running down the panel is what makes sections and anchors read as
 * one map of one document rather than two lists that happen to be adjacent.
 */

// Sections and anchors are kept apart rather than interleaved. Nested
// inside sections an anchor would take a third width of indent, under
// headings that already have two, and the eye could no longer pick out
// "my anchors" at all — which is the one thing that list is for.
export default function ContentsMenu({
  open,
  onOpen,
  onClose,
  loading = false,
  sections = [],
  anchors = [],
  current = null,
  currentAnchor = null,
  onSection,
  onAnchor,
}) {
  const popRef = useRef(null);
  const buttonRef = useRef(null);

  const body = useMemo(() => sections.filter((section) => !section.appendix), [sections]);
  const appendix = useMemo(() => sections.filter((section) => section.appendix), [sections]);
  const here = useMemo(
    () => sections.find((section) => section.id === current),
    [sections, current],
  );
  // Plenty of papers number nothing — their outline says "Introduction",
  // not "1 Introduction". A column no row has anything to put in is dead
  // space, so it is not set aside.
  const plain = sections.length > 0 && sections.every((section) => !section.number);
  const name = here ? [here.number, here.title].filter(Boolean).join(' ') : null;

  // A press anywhere else puts it away. Bound in the capture phase, like
  // the brush's sheet, so the press that closes it is not also the press
  // that reopens it.
  useEffect(() => {
    if (!open) return undefined;
    const away = (event) => {
      if (event.target?.closest?.('.contents')) return;
      onClose();
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [open, onClose]);

  // It opens on the place the reader is already in: the current section is
  // focused and brought into view, so someone halfway through a paper is
  // not shown the top of it and left to find themselves.
  useEffect(() => {
    if (!open) return;
    const pop = popRef.current;
    if (!pop) return;
    const row = pop.querySelector('.contents-row.now') || pop.querySelector('.contents-row');
    if (!row) return;
    row.focus({ preventScroll: true });
    // Scrolled by hand rather than with scrollIntoView, which would also
    // scroll the pages behind the panel.
    pop.scrollTop = Math.max(0, row.offsetTop - (pop.clientHeight - row.offsetHeight) / 2);
  }, [open, sections, anchors]);

  const walk = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      buttonRef.current?.focus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const rows = [...(popRef.current?.querySelectorAll('.contents-row') || [])];
    if (!rows.length) return;
    event.preventDefault();
    const at = rows.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? rows.length - 1
        : event.key === 'ArrowDown' ? Math.min(rows.length - 1, at + 1)
          : Math.max(0, at < 0 ? 0 : at - 1);
    rows[next]?.focus();
  };

  const sectionRow = (section) => (
    <button
      key={section.id}
      type="button"
      className={`contents-row${section.id === current ? ' now' : ''}`}
      data-level={section.level}
      aria-current={section.id === current ? 'true' : undefined}
      onClick={() => onSection(section)}
    >
      <span className="contents-number">{section.number}</span>
      <span className="contents-title">{section.title}</span>
      <span className="contents-page">{section.page}</span>
    </button>
  );

  const anchorRow = (anchor) => (
    <button
      key={anchor.uuid}
      type="button"
      className={`contents-row contents-anchor${anchor.uuid === currentAnchor ? ' now' : ''}`}
      aria-current={anchor.uuid === currentAnchor ? 'true' : undefined}
      onClick={() => onAnchor(anchor)}
    >
      <span className="contents-number" aria-hidden="true">
        <GlyphFor note={anchor.note} />
      </span>
      <span className="contents-title">{anchor.label}</span>
      <span className="contents-page">{anchor.page}</span>
    </button>
  );

  const group = (name, rows) => (rows.length ? (
    <div className="contents-group" role="group" aria-label={name}>
      <p className="contents-kicker" aria-hidden="true">{name}</p>
      {rows}
    </div>
  ) : null);

  return (
    <div className="contents">
      <button
        ref={buttonRef}
        type="button"
        className={`contents-button${open ? ' open' : ''}`}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={name ? `Contents — reading ${name}` : 'Contents'}
        title="Contents"
        onClick={() => (open ? onClose() : onOpen())}
      >
        {/* An outline, not a list: the second and third rules are indented
            under the first, which is the one thing that says "structure"
            at sixteen pixels. */}
        <svg className="contents-glyph" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.5 4h11" />
          <path d="M5.5 8h8" />
          <path d="M5.5 12h5.5" />
        </svg>
        <span className="contents-now">{name || 'Contents'}</span>
        <svg className="contents-chevron" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4.5 6.5 8 10l3.5-3.5" />
        </svg>
      </button>

      {open && (
        <nav
          ref={popRef}
          className={`contents-pop${plain ? ' plain' : ''}`}
          aria-label="Contents"
          // The bar moves the window in Papol macOS; the panel hanging off
          // it does not.
          data-tauri-drag-region="false"
          onKeyDown={walk}
        >
          {sections.length === 0 && (
            <p className="contents-note">
              {loading
                ? 'Reading the paper…'
                : 'Papol found no headings in this paper. Anchors you drop appear here.'}
            </p>
          )}
          {group('Sections', body.map(sectionRow))}
          {group('Appendix', appendix.map(sectionRow))}
          {group('Anchors', anchors.map(anchorRow))}
        </nav>
      )}
    </div>
  );
}
