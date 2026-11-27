import React, { useEffect, useState } from 'react';
import { FEATURE_STATES_TAKEN, NOOK_TIP, isFeatureStateSet, setFeatureState } from '../../../shared/featureStates.js';

// That the button over the Lounge is the way back to the member's own
// nook, said under it while they are in the Lounge until they have been
// told: by dismissing the card, or by pressing the button (Way.jsx).
export default function NookTip() {
  const [told, setTold] = useState(() => isFeatureStateSet(NOOK_TIP));
  useEffect(() => {
    const look = () => { if (isFeatureStateSet(NOOK_TIP)) setTold(true); };
    window.addEventListener(FEATURE_STATES_TAKEN, look);
    return () => window.removeEventListener(FEATURE_STATES_TAKEN, look);
  }, []);
  if (told) return null;
  return (
    <span className="learn-papol lounge-tip" role="dialog" aria-labelledby="nook-tip-title">
      <span className="learn-papol-kicker">Learn Papol</span>
      <strong id="nook-tip-title">Go back to your nook here</strong>
      <button type="button" className="learn-papol-close" onClick={() => { setFeatureState(NOOK_TIP, true); setTold(true); }} aria-label="Dismiss this tip">
        Got it
      </button>
    </span>
  );
}
