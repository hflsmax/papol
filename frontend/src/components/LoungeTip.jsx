import React, { useEffect, useState } from 'react';
import { FEATURE_STATES_TAKEN, LOUNGE_TIP, isFeatureStateSet, setFeatureState } from '../../../shared/featureStates.js';

// That the Lounge is where friends' news is, said under the way into it
// until the member has been told: by dismissing the card, or by going to
// the Lounge. `here` is whether they are in the Lounge now.
export default function LoungeTip({ here = false }) {
  const [told, setTold] = useState(() => isFeatureStateSet(LOUNGE_TIP));
  const tell = () => {
    if (told) return;
    setFeatureState(LOUNGE_TIP, true);
    setTold(true);
  };
  useEffect(() => {
    const look = () => { if (isFeatureStateSet(LOUNGE_TIP)) setTold(true); };
    window.addEventListener(FEATURE_STATES_TAKEN, look);
    return () => window.removeEventListener(FEATURE_STATES_TAKEN, look);
  }, []);
  useEffect(() => { if (here) tell(); });
  if (told || here) return null;
  return (
    <span className="learn-papol lounge-tip" role="dialog" aria-labelledby="lounge-tip-title">
      <span className="learn-papol-kicker">Learn Papol</span>
      <strong id="lounge-tip-title">See what your friends are doing here</strong>
      <button type="button" className="learn-papol-close" onClick={tell} aria-label="Dismiss this tip">
        Got it
      </button>
    </span>
  );
}
