import React, { useState } from 'react';
import { submitFeedback } from '../api';

export default function FeedbackDialog({ currentUser, onClose }) {
  const [content, setContent] = useState('');
  const [contact, setContact] = useState('');
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
        page: window.location.hash || '#/',
        contact: currentUser ? null : contact.trim() || null,
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
              <p className="panel-note">
                Your note is with the admins. If it needs a reply, it comes
                to {currentUser ? 'your email' : 'the address you left'}.
              </p>
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

              {!currentUser && (
                <div className="form-group">
                  <label>Your email (optional, so we can reply)</label>
                  <input
                    type="email"
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                    placeholder="you@example.com"
                  />
                </div>
              )}

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
                  {sending ? 'Sending…' : 'Send to the admins'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
