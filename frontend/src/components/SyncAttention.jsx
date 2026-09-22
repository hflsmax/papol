import React, { useEffect, useState } from 'react';
import { SYNC_ATTENTION_EVENT } from '../../../shared/syncFailure.js';
import { syncAllNow } from '../../../shared/nativeData.js';

// A sync that failed for a reason the user should hear about, said where
// they are rather than only on the settings page.
//
// Mounted once, in the desk window, which owns the sync control and
// sign-in. The failures with a place of their own are answered there and
// never reach this prompt: an obsolete build (the update screen covers
// every window), a refused session (the sign-in page), no network (offline
// mode), a defect on this Mac (the error report). What is left is a sync
// the server did not finish; the prompt says so once, and again only when
// the reason changes, and goes when a sync succeeds.
export default function SyncAttention({ onSignedOut, onDetails }) {
  const [failure, setFailure] = useState(null);
  const [dismissed, setDismissed] = useState(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const onAttention = (event) => {
      const next = event.detail || null;
      if (next?.kind === 'signed_out') {
        onSignedOut?.(next);
        return;
      }
      setFailure(next);
      if (!next) setDismissed(null);
    };
    window.addEventListener(SYNC_ATTENTION_EVENT, onAttention);
    return () => window.removeEventListener(SYNC_ATTENTION_EVENT, onAttention);
  }, [onSignedOut]);

  if (!failure || dismissed === failure.signature) return null;

  const retry = async () => {
    setRetrying(true);
    try {
      await syncAllNow();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="sync-attention" role="alert" aria-labelledby="sync-attention-title">
      <strong id="sync-attention-title">Sync didn’t finish</strong>
      <p>{failure.text}</p>
      <div className="sync-attention-actions">
        <button type="button" className="primary" onClick={retry} disabled={retrying}>
          {retrying ? 'Syncing…' : 'Try again'}
        </button>
        <button type="button" onClick={() => { setDismissed(failure.signature); onDetails?.(); }}>
          Details
        </button>
        <button
          type="button"
          className="sync-attention-close"
          aria-label="Dismiss"
          onClick={() => setDismissed(failure.signature)}
        >
          ×
        </button>
      </div>
    </div>
  );
}
