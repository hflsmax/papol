import React, { useEffect, useRef, useState } from 'react';
import { DESKTOP } from '../../../shared/desktopShell.js';
import { getSyncStatus, OFFLINE_MODE_MESSAGE } from '../../../shared/offlineStore.js';
import {
  nativeDataActive, nativeSyncInProgress, subscribeNativeData, syncAllNow,
} from '../nativeData.js';

const STYLE_ID = 'papol-desktop-syncing-status-style';
const STYLE = `
.desktop-syncing-status {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 6px;
  color: var(--ink-faint, #747c88);
  font: var(--fs-xs, 12px) var(--font-ui, system-ui, sans-serif);
  white-space: nowrap;
}
.desktop-syncing-status-mark {
  display: inline-block;
  width: 14px;
  color: var(--accent, #2b4a6f);
  font-size: 16px;
  line-height: 1;
  text-align: center;
  animation: desktop-syncing-status-spin .8s linear infinite;
}
.desktop-syncing-status.offline {
  color: var(--red, #9b342d);
}
.desktop-syncing-status button {
  border: 0;
  padding: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}
@keyframes desktop-syncing-status-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .desktop-syncing-status-mark { animation-duration: 1.6s; }
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
export default function DesktopSyncingStatus() {
  const initial = getSyncStatus();
  const [status, setStatus] = useState({
    syncing: DESKTOP && nativeDataActive() && nativeSyncInProgress(),
    offline: initial.offline,
  });
  const processSyncing = useRef(false);

  useEffect(() => {
    if (!DESKTOP) return undefined;
    const refreshLocalState = () => {
      const local = getSyncStatus();
      setStatus({
        syncing: nativeDataActive() && (processSyncing.current || nativeSyncInProgress()),
        offline: local.offline,
      });
    };
    const unsubscribeNative = subscribeNativeData((status) => {
      if (typeof status?.syncing === 'boolean') {
        processSyncing.current = status.syncing;
        refreshLocalState();
      }
    });
    window.addEventListener('papol-offline-status', refreshLocalState);
    refreshLocalState();
    return () => {
      unsubscribeNative();
      window.removeEventListener('papol-offline-status', refreshLocalState);
    };
  }, []);

  const reconnect = async () => {
    setStatus((current) => ({ ...current, syncing: true }));
    await syncAllNow();
    const current = getSyncStatus();
    setStatus({ syncing: false, offline: current.offline });
  };

  if (!status.syncing && !status.offline) return null;
  if (status.offline && !status.syncing) {
    return (
      <span className="desktop-syncing-status offline" role="status" title={OFFLINE_MODE_MESSAGE}>
        <span>Offline</span>
        <span aria-hidden="true">·</span>
        <button type="button" onClick={reconnect}>Sync</button>
      </span>
    );
  }
  return (
    <span className="desktop-syncing-status" role="status" aria-live="polite">
      <span className="desktop-syncing-status-mark" aria-hidden="true">↻</span>
      <span>Syncing…</span>
    </span>
  );
}
