import { useEffect, useState } from 'react';
import { DESKTOP } from '../desktopShell.js';
import {
  COMPATIBILITY_EVENT, INCOMPATIBLE,
  getClientCompatibility, hydrateClientCompatibility,
} from '../clientCompatibility.js';

const DEFAULT_DOWNLOAD_URL = 'https://github.com/hflsmax/papol/releases';

// Mounted in every window, because compatibility is process-wide: a user
// told this in the library must not find the viewer carrying on as though
// nothing had happened.
//
// A version the service will no longer speak to is the end of the session: the window
// is covered and Papol stops being usable until it is updated. Anything
// short of that is an invitation to keep working in a build whose replica
// the next one will discard — the work would be made, and then lost, and
// nobody would have been warned at the moment it mattered.
//
// So the panel offers the one thing that helps: the version that works.
export default function CompatibilityGate() {
  const [state, setState] = useState(() => (DESKTOP ? hydrateClientCompatibility() : getClientCompatibility()));

  useEffect(() => {
    if (!DESKTOP) return undefined;
    const onChange = (event) => setState(event.detail || getClientCompatibility());
    window.addEventListener(COMPATIBILITY_EVENT, onChange);
    return () => window.removeEventListener(COMPATIBILITY_EVENT, onChange);
  }, []);

  if (!DESKTOP) return null;
  if (state.verdict !== INCOMPATIBLE) return null;
  return (
    <div className="compatibility-stop" role="alertdialog" aria-modal="true" aria-labelledby="compatibility-stop-title">
      <div className="compatibility-stop-panel">
        <h1 id="compatibility-stop-title">Papol needs updating</h1>
        <p>
          This version can no longer work with the backend service, so it has
          stopped. Please download the latest app.
        </p>
        <div className="compatibility-stop-actions">
          <a href={state.downloadUrl || DEFAULT_DOWNLOAD_URL} target="_blank" rel="noreferrer">
            Download Papol
          </a>
        </div>
      </div>
    </div>
  );
}
