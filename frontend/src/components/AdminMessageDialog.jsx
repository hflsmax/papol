import React, { useCallback, useState } from 'react';
import { dismissAdminMessage } from '../../../shared/api/notifications.js';
import { useModalDialog } from '../../../shared/useModalDialog.js';

export default function AdminMessageDialog({ message, onDismissed }) {
  const [dismissing, setDismissing] = useState(false);
  const [error, setError] = useState(null);

  const dismiss = useCallback(async () => {
    if (dismissing) return;
    setDismissing(true);
    setError(null);
    try {
      await dismissAdminMessage(message.uuid);
      onDismissed(message.uuid);
    } catch (failure) {
      setError(failure.message);
      setDismissing(false);
    }
  }, [dismissing, message.uuid, onDismissed]);

  const dialogRef = useModalDialog(true, dismiss);

  return (
    <div className="modal-overlay" onClick={dismiss}>
      <div
        ref={dialogRef}
        className="modal-box admin-message-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-message-title"
        tabIndex="-1"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="panel">
          <p className="admin-message-kicker">From Papol</p>
          <h3 id="admin-message-title">A message for our readers</h3>
          <p className="admin-message-content">{message.content}</p>
          {error && <div className="error" role="alert">{error}</div>}
          <div className="form-actions">
            <button className="primary" disabled={dismissing} onClick={dismiss}>
              {dismissing ? 'Dismissing…' : 'Dismiss'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
