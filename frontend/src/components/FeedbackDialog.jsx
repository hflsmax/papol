import React, { useEffect, useState } from 'react';
import { submitFeedback } from '../../../shared/api/feedback.js';
import appLimits from '../../../shared/appLimits.js';
import { recentDiagnosticEvents } from '../../../shared/nativeData.js';
import { diagnosticLogExcerpt, feedbackWithDiagnosticLog } from '../../../shared/diagnosticLog.js';

export default function FeedbackDialog({ currentUser, initialContent = '', reportError = false, onClose }) {
  const [content, setContent] = useState(initialContent);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const [logExcerpt, setLogExcerpt] = useState('');
  const [includeLog, setIncludeLog] = useState(true);

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

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
      await submitFeedback({
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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" role="dialog" aria-modal="true" aria-label="Feedback" onClick={(e) => e.stopPropagation()}>
        <div className="panel">
          <h3>{sent ? (reportError ? 'Report sent' : 'Thank you') : (reportError ? 'Send an error report?' : 'Report a bug or ask for a feature')}</h3>
          {sent ? (
            <>
              {currentUser && (
                <p className="panel-note">
                  If it needs a reply, it comes to your email.
                </p>
              )}
              <div className="form-actions">
                <button className="primary" onClick={onClose}>
                  Close
                </button>
              </div>
            </>
          ) : (
            <>
              {reportError && (
                <p className="panel-note">
                  Papol found a synchronization error it cannot resolve by retrying.
                  Review or edit the diagnostic details below, then choose whether to send them to the developer.
                </p>
              )}
              <div className="form-group">
                <label>
                  {reportError ? 'Diagnostic details' : 'What went wrong, or what would you like Papol to do?'}
                </label>
                <textarea
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

              {error && <div className="error">{error}</div>}

              <div className="form-actions">
                <button type="button" onClick={onClose} disabled={sending}>
                  {reportError ? 'Not now' : 'Cancel'}
                </button>
                <button
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
    </div>
  );
}
