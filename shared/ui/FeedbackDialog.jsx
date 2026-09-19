import React, { useEffect, useState } from 'react';
import appLimits from '../appLimits.js';
import { recentDiagnosticEvents } from '../nativeData.js';
import { diagnosticLogExcerpt, feedbackWithDiagnosticLog } from '../diagnosticLog.js';
import { useModalDialog } from '../useModalDialog.js';

/** The one feedback dialog, over whichever surface raised it. Each surface
    hands in its own transport and its own words for the two prompts; the
    form, the diagnostic log offer, and the sending are the same everywhere. */
export default function FeedbackDialog({
  submit,
  prompt = 'What went wrong, or what would you like Papol to do?',
  errorNote = 'Papol encountered an unexpected error. Review or edit the diagnostic details below, then choose whether to send them to the developer.',
  initialContent = '',
  reportError = false,
  onClose,
}) {
  const [content, setContent] = useState(initialContent);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const [logExcerpt, setLogExcerpt] = useState('');
  const [includeLog, setIncludeLog] = useState(true);
  const dialogRef = useModalDialog(true, onClose);

  useEffect(() => {
    recentDiagnosticEvents(40)
      .then((events) => setLogExcerpt(diagnosticLogExcerpt(events)))
      .catch(() => {});
  }, []);

  const handleSend = async () => {
    if (!content.trim()) return;
    setSending(true);
    setError(null);
    try {
      await submit({
        content: feedbackWithDiagnosticLog(
          content,
          includeLog ? logExcerpt : '',
          appLimits.text.feedback,
        ),
        // Where the reporter was standing, so an admin can retrace it.
        page: window.location.pathname || '/',
        contact: null,
      });
      setSent(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      ref={dialogRef}
      className="sheet-back"
      role="dialog"
      aria-modal="true"
      aria-label={reportError ? 'Send an error report' : 'Report a bug or ask for a feature'}
      tabIndex="-1"
      onClick={onClose}
    >
      <div className="sheet feedback-sheet" onClick={(e) => e.stopPropagation()}>
        <h3>{sent
          ? (reportError ? 'Report sent' : 'Thank you')
          : (reportError ? 'Send an error report?' : 'Report a bug or ask for a feature')}</h3>
        {sent ? (
          <div className="feedback-actions">
            <button type="button" className="primary" onClick={onClose}>
              Close
            </button>
          </div>
        ) : (
          <>
            {reportError && <p className="feedback-note">{errorNote}</p>}
            <div className="feedback-field">
              <label htmlFor="feedback-content">
                {reportError ? 'Diagnostic details' : prompt}
              </label>
              <textarea
                id="feedback-content"
                rows="5"
                maxLength={appLimits.text.feedback}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={reportError ? undefined : 'I clicked … and the page …, or: it would help if …'}
                autoFocus
              />
            </div>

            {logExcerpt && (
              <div className="feedback-diagnostics">
                <label>
                  <input
                    type="checkbox"
                    checked={includeLog}
                    onChange={(event) => setIncludeLog(event.target.checked)}
                  />
                  Include recent diagnostic events
                </label>
                <details>
                  <summary>Review diagnostic log</summary>
                  <pre>{logExcerpt}</pre>
                </details>
              </div>
            )}

            {error && <p className="feedback-error" role="alert">{error}</p>}

            <div className="feedback-actions">
              <button type="button" onClick={onClose} disabled={sending}>
                {reportError ? 'Not now' : 'Cancel'}
              </button>
              <button
                type="button"
                className="primary"
                onClick={handleSend}
                disabled={sending || !content.trim()}
              >
                {sending ? 'Sending…' : (reportError ? 'Send report' : 'Submit')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
