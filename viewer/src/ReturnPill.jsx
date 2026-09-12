import React from 'react';

const pageName = (view) => (view.page ? `Page ${view.page}` : 'Previous place');

/**
 * Where a followed link ("see Section 3") left the reader: a pill over the
 * pages naming the page to go back to, like a reader app's "Back to page 4".
 * It is the document's own history, kept apart from the bar's navigation,
 * and exists only while there is somewhere to return to. The reader can hide
 * it for good; a Learn Papol card then says [ and ] still do its job.
 *
 * returnView / onwardView: the views Back and Forward lead to, or null.
 * notice: whether that card is up; onDismiss closes it, onUndo shows the pill again.
 * children: the learning tip, shown above the pill.
 */
export default function ReturnPill({
  returnView, onwardView, hidden, notice, onBack, onForward, onHide, onUndo, onDismiss, children,
}) {
  return (
    <>
      {(returnView || onwardView) && !hidden && (
        <div className="link-return" role="group" aria-label="Places followed links left">
          {returnView && (
            <button
              type="button"
              className="link-return-button"
              onClick={onBack}
              title="Return to where the link was followed ([)"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.25 5.25 8 10 12.75" /></svg>
              <span>{onwardView ? pageName(returnView) : `Back to ${pageName(returnView).toLowerCase()}`}</span>
              <kbd aria-hidden="true">[</kbd>
            </button>
          )}
          {returnView && onwardView && <span className="link-return-divider" aria-hidden="true" />}
          {onwardView && (
            <button
              type="button"
              className="link-return-button"
              onClick={onForward}
              title="Go forward to the link's destination again (])"
            >
              <kbd aria-hidden="true">]</kbd>
              <span>{returnView ? pageName(onwardView) : `Forward to ${pageName(onwardView).toLowerCase()}`}</span>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.25 10.75 8 6 12.75" /></svg>
            </button>
          )}
          <span className="link-return-divider" aria-hidden="true" />
          <button
            type="button"
            className="link-return-hide"
            onClick={onHide}
            aria-label="Hide this pill"
            title="Hide this pill — [ and ] still work"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.75 4.75l6.5 6.5M11.25 4.75l-6.5 6.5" /></svg>
          </button>
          {children}
        </div>
      )}
      {/* Hiding is explained the way the pill was introduced: a Learn Papol
          card where the pill stood, kept until the reader has read it. */}
      {notice && (
        <div className="link-return-notice">
          <span className="learn-papol" role="dialog" aria-labelledby="return-pill-hidden-title">
            <span className="learn-papol-kicker">Learn Papol</span>
            <strong id="return-pill-hidden-title">The return pill is hidden</strong>
            <span>
              You can still press <kbd>[</kbd> and <kbd>]</kbd> to jump back and forward after
              following a link.
            </span>
            <span className="learn-papol-actions">
              <button type="button" className="learn-papol-undo" onClick={onUndo}>
                Undo
              </button>
              <button type="button" className="learn-papol-close" onClick={onDismiss}>
                Got it
              </button>
            </span>
          </span>
        </div>
      )}
    </>
  );
}
