import { useState } from 'react';
import { DESKTOP } from '../../../shared/desktopShell';
import { RETIRED_KEY, handoffCapableMac, writeFlag } from '../../../shared/macHandoff.js';

function flag(key) {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

// Where a standing answer about the Mac app can be taken back (US-7.27).
// Nothing is shown until there is something to undo: a user who has never
// dismissed the offer has no setting here to be puzzled by.
export default function MacHandoffSettings() {
  const [retired, setRetired] = useState(() => flag(RETIRED_KEY));

  if (DESKTOP || !handoffCapableMac(window.navigator)) return null;
  if (!retired) return null;

  return (
    <div className="panel">
      <h2 className="panel-title">Papol for Mac</h2>
      <p className="panel-note">
        This applies to this browser on this computer, not to your account.
      </p>
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
    </div>
  );
}
