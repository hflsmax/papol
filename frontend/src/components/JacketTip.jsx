import React, { useEffect, useState } from 'react';
import { FEATURE_STATES_TAKEN, JACKET_TIP, isFeatureStateSet, setFeatureState } from '../../../shared/featureStates.js';

// That Papol's mark is the way back from a jacket to where the work was
// opened, said under the mark while the member is on a jacket until they
// have been told: by dismissing the card, or by pressing the mark
// (Way.jsx). `lounge` is whether that place is the Lounge, not their nook.
export default function JacketTip({ lounge = false }) {
  const [told, setTold] = useState(() => isFeatureStateSet(JACKET_TIP));
  useEffect(() => {
    const look = () => { if (isFeatureStateSet(JACKET_TIP)) setTold(true); };
    window.addEventListener(FEATURE_STATES_TAKEN, look);
    return () => window.removeEventListener(FEATURE_STATES_TAKEN, look);
  }, []);
  if (told) return null;
  return (
    <span className="learn-papol way-tip" role="dialog" aria-labelledby="jacket-tip-title">
      <span className="learn-papol-kicker">Tip</span>
      <strong id="jacket-tip-title">{lounge ? 'Go back to the Lounge here' : 'Go back to your nook here'}</strong>
      <button type="button" className="learn-papol-close" onClick={() => { setFeatureState(JACKET_TIP, true); setTold(true); }} aria-label="Dismiss this tip">
        Got it
      </button>
    </span>
  );
}
