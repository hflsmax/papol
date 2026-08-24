import React, { useState } from 'react';
import { submitFeedback } from '../api';

export default function FeedbackDialog({ currentUser, onClose }) {
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  const handleSend = async () => {
    if (!content.trim()) return;
    setSending(true);
    setError(null);
    try {
      await submitFeedback({
        content: content.trim(),
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
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="panel">
          <h3>{sent ? 'Thank you' : 'Report a bug or ask for a feature'}</h3>
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
              <div className="form-group">
                <label>
                  What went wrong, or what would you like Papol to do?
                </label>
                <textarea
                  rows="5"
                  maxLength={4000}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="I clicked … and the page …, or: it would help if …"
                  autoFocus
                />
              </div>

              {error && <div className="error">{error}</div>}

              <div className="form-actions">
                <button type="button" onClick={onClose} disabled={sending}>
                  Cancel
                </button>
                <button
                  className="primary"
                  onClick={handleSend}
                  disabled={sending || !content.trim()}
                >
                  {sending ? 'Sending…' : 'Submit'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
