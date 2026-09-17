import React, { useEffect, useRef, useState } from 'react';
import { DESKTOP } from '../desktopShell.js';
import { getSyncStatus, OFFLINE_MODE_MESSAGE } from '../connectivity.js';
import {
  nativeDataActive, nativeSyncInProgress, subscribeNativeData, syncAllNow,
} from '../nativeData.js';

const STYLE_ID = 'papol-desktop-syncing-status-style';
const STYLE = `
.desktop-syncing-status {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  min-height: 28px;
  color: var(--ink-faint, #7e8794);
  font-family: var(--font-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
  font-size: var(--fs-xs, 0.78rem);
  line-height: 1.5;
  white-space: nowrap;
}
.desktop-syncing-status-label {
  padding-inline: 4px;
}
.desktop-syncing-status.offline {
  color: var(--ink-faint, #7e8794);
}
.desktop-syncing-status button {
  height: 28px;
  border: 0;
  border-radius: var(--chrome-radius, 6px);
  padding: 4px 8px;
  background: transparent;
  box-shadow: none;
  color: var(--ink-soft, #4d5561);
  font: inherit;
  line-height: inherit;
  text-decoration: none;
  cursor: default;
}
.desktop-syncing-status button:hover:not(:disabled) {
  border: 0;
  background: var(--chrome-hover, rgba(29, 33, 41, 0.06));
  color: var(--ink, #1d2129);
}
.desktop-syncing-status button:active:not(:disabled) {
  background: var(--chrome-selected, rgba(29, 33, 41, 0.1));
}
.desktop-syncing-status button:focus-visible {
  border: 0;
  outline: 2px solid var(--accent, #2b4a6f);
  outline-offset: -2px;
}
`;

if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.appendChild(style);
}

// Native synchronization is process-wide, while the Library, Viewer and
// Board each run in their own WebView. Listen to the native event as well as
// this window's lifecycle event so every toolbar reflects the same work.
export default function DesktopSyncingStatus({ retry = true }) {
  const initial = getSyncStatus();
  const [status, setStatus] = useState({
    syncing: DESKTOP && nativeDataActive() && nativeSyncInProgress(),
    offline: initial.offline,
    error: initial.error,
  });
  const processSyncing = useRef(false);

  useEffect(() => {
    if (!DESKTOP) return undefined;
    const refreshLocalState = () => {
      const local = getSyncStatus();
      setStatus((current) => ({
        syncing: nativeDataActive() && (processSyncing.current || nativeSyncInProgress()),
        offline: local.offline,
        error: local.error || current.error,
      }));
    };
    const unsubscribeNative = subscribeNativeData((status) => {
      if (typeof status?.syncing === 'boolean') {
        processSyncing.current = status.syncing;
      }
      if (typeof status?.error === 'string') {
        setStatus((current) => ({ ...current, error: status.error }));
      } else if (Number.isFinite(status?.cursor)) {
        setStatus((current) => ({ ...current, error: null }));
      }
      refreshLocalState();
    });
    window.addEventListener('papol-offline-status', refreshLocalState);
    refreshLocalState();
    return () => {
      unsubscribeNative();
      window.removeEventListener('papol-offline-status', refreshLocalState);
    };
  }, []);

  const reconnect = async () => {
    setStatus((current) => ({ ...current, syncing: true, error: null }));
    const failure = await syncAllNow();
    const current = getSyncStatus();
    setStatus({ syncing: false, offline: current.offline, error: failure || current.error });
  };

  if (!status.syncing && !status.offline && !status.error) return null;
  if (!status.syncing && (status.offline || status.error)) {
    return (
      <span
        className="desktop-syncing-status offline"
        role="status"
        title={status.error || OFFLINE_MODE_MESSAGE}
      >
        <span className="desktop-syncing-status-label">{status.error ? 'Sync failed' : 'Offline'}</span>
        {(retry || !status.error) && (
          <>
            <span aria-hidden="true">·</span>
            <button type="button" onClick={reconnect}>{status.error ? 'Retry' : 'Sync'}</button>
          </>
        )}
      </span>
    );
  }
  return (
    <span className="desktop-syncing-status" role="status" aria-live="polite">
      <span className="desktop-syncing-status-label">Syncing…</span>
    </span>
  );
}
