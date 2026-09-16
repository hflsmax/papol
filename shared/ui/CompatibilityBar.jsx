import { useEffect, useState } from 'react';
import { DESKTOP } from '../desktopShell.js';
import {
  COMPATIBILITY_EVENT, DEPRECATED, INCOMPATIBLE,
  getClientCompatibility, hydrateClientCompatibility,
} from '../clientCompatibility.js';
import { exportNativeRecovery } from '../nativeData.js';

const DEFAULT_DOWNLOAD_URL = 'https://github.com/hflsmax/papol/releases';

// Shown in every window, because synchronization is process-wide and a
// reader who is told this in the library must not find the viewer carrying
// on as though nothing had happened.
//
// An incompatible build keeps working on everything already on this
// computer. The two actions are the only two that help: get the version
// that works, and take anything not yet synchronized somewhere safe first.
export default function CompatibilityBar() {
  const [state, setState] = useState(() => (DESKTOP ? hydrateClientCompatibility() : getClientCompatibility()));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null);

  useEffect(() => {
    if (!DESKTOP) return undefined;
    const onChange = (event) => setState(event.detail || getClientCompatibility());
    window.addEventListener(COMPATIBILITY_EVENT, onChange);
    return () => window.removeEventListener(COMPATIBILITY_EVENT, onChange);
  }, []);

  if (!DESKTOP) return null;
  if (state.verdict !== INCOMPATIBLE && state.verdict !== DEPRECATED) return null;
  const stopped = state.verdict === INCOMPATIBLE;

  const saveWork = async () => {
    setSaving(true);
    try {
      const receipt = await exportNativeRecovery();
      setSaved(receipt?.path ? 'Saved to Downloads' : 'Saved');
    } catch {
      setSaved('Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`compatibility-bar${stopped ? ' stopped' : ''}`} role="alert">
      <span>
        {stopped
          ? 'This version of Papol can’t sync any more. Download the latest to continue.'
          : 'A newer version of Papol is available.'}
      </span>
      <a href={state.downloadUrl || DEFAULT_DOWNLOAD_URL} target="_blank" rel="noreferrer">
        Download Papol
      </a>
      {stopped && (
        <button type="button" onClick={saveWork} disabled={saving}>
          {saving ? 'Saving…' : saved || 'Save unsynced work'}
        </button>
      )}
    </div>
  );
}
