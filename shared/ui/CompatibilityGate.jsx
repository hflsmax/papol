import { useEffect, useState } from 'react';
import { DESKTOP } from '../desktopShell.js';
import {
  COMPATIBILITY_EVENT, DEPRECATED, INCOMPATIBLE,
  getClientCompatibility, hydrateClientCompatibility,
} from '../clientCompatibility.js';
import { exportNativeRecovery } from '../nativeData.js';

const DEFAULT_DOWNLOAD_URL = 'https://github.com/hflsmax/papol/releases';

// Mounted in every window, because compatibility is process-wide: a user
// told this in the library must not find the viewer carrying on as though
// nothing had happened.
//
// A newer version merely existing is a bar above the application. A version
// the service will no longer speak to is the end of the session: the window
// is covered and Papol stops being usable until it is updated. Anything
// short of that is an invitation to keep working in a build whose replica
// the next one will discard — the work would be made, and then lost, and
// nobody would have been warned at the moment it mattered.
//
// So the two actions on the covering panel are the only two that help: get
// the version that works, and take whatever was never sent somewhere safe
// before the update throws this computer's copy away.
export default function CompatibilityGate() {
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
  const download = (
    <a href={state.downloadUrl || DEFAULT_DOWNLOAD_URL} target="_blank" rel="noreferrer">
      Download Papol
    </a>
  );

  if (state.verdict === DEPRECATED) {
    return (
      <div className="compatibility-bar" role="alert">
        <span>A newer version of Papol is available.</span>
        {download}
      </div>
    );
  }

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
    <div className="compatibility-stop" role="alertdialog" aria-modal="true" aria-labelledby="compatibility-stop-title">
      <div className="compatibility-stop-panel">
        <h1 id="compatibility-stop-title">Papol needs updating</h1>
        <p>
          This version can no longer work with the service, so it has stopped
          here rather than letting you make work it cannot save.
        </p>
        <p>
          Updating starts this computer’s copy again from the service.
          Everything that reached it is waiting there — anything that never
          did is only here, so save it first.
        </p>
        <div className="compatibility-stop-actions">
          {download}
          <button type="button" onClick={saveWork} disabled={saving}>
            {saving ? 'Saving…' : saved || 'Save unsynced work'}
          </button>
        </div>
      </div>
    </div>
  );
}
