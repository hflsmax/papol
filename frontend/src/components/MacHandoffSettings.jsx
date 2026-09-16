import { useState } from 'react';
import { DESKTOP, MAC } from '../../../shared/desktopShell';
import { ALWAYS_KEY, RETIRED_KEY, writeFlag } from '../../../shared/macHandoff.js';

function flag(key) {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

// Where a standing answer about the Mac app can be taken back (US-7.27).
// Nothing is shown until there is something to undo: a reader who has never
// dismissed the offer has no setting here to be puzzled by.
export default function MacHandoffSettings() {
  const [retired, setRetired] = useState(() => flag(RETIRED_KEY));
  const [always, setAlways] = useState(() => flag(ALWAYS_KEY));

  if (DESKTOP || !MAC) return null;
  if (!retired && !always) return null;

  return (
    <div className="panel">
      <h2 className="panel-title">Papol for Mac</h2>
      <p className="panel-note">
        These apply to this browser on this computer, not to your account.
      </p>
      {always && (
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked
            onChange={() => {
              writeFlag(window.localStorage, ALWAYS_KEY, false);
              setAlways(false);
            }}
          />
          Always open papers and boards in Papol for Mac
        </label>
      )}
      {retired && (
        <div className="form-actions">
          <button
            type="button"
            onClick={() => {
              writeFlag(window.localStorage, RETIRED_KEY, false);
              setRetired(false);
            }}
          >
            Offer the Mac app again
          </button>
        </div>
      )}
    </div>
  );
}
