import { useEffect, useState } from 'react';
import { DESKTOP } from '../desktopShell.js';
import {
  DOWNLOAD_URL, RETIRED_KEY,
  attemptHandoff, deferDocument, handoffCapableMac, handoffOffer, writeFlag,
} from '../macHandoff.js';

// Shown at the top of a document the Mac app could open better, in the
// browser only (USER_STORIES.md §7d). It is a bar and not a dialog because
// the user came here to read, and it never navigates the tab: whatever
// the system does with the address, the reading behind this bar is still
// where it was.
export default function MacHandoffBar() {
  const [offer, setOffer] = useState(null);
  const [state, setState] = useState('offer');

  useEffect(() => {
    const made = handoffOffer({
      href: window.location.href,
      desktop: DESKTOP,
      mac: handoffCapableMac(window.navigator),
      session: window.sessionStorage,
      local: window.localStorage,
    });
    if (!made) return;
    setOffer(made);
  }, []);

  if (!offer) return null;

  const hand = () => {
    setState('trying');
    attemptHandoff(offer.address).then((verdict) => {
      setState(verdict === 'opened' ? 'opened' : 'missing');
    });
  };

  const notNow = () => {
    deferDocument(window.sessionStorage, offer.identity);
    setOffer(null);
  };

  const retire = () => {
    writeFlag(window.localStorage, RETIRED_KEY, true);
    setOffer(null);
  };

  // A user who asked for this can see their Papol and does not need telling
  // (US-7.34). The bar simply goes.
  if (state === 'opened') return null;

  if (state === 'missing') {
    return (
      <div className="mac-handoff-bar" role="status">
        {/* A question, not a verdict (US-7.34): this tab saw nothing, which
            is not the same as nothing having happened. Papol may well have
            opened behind a window, or be installed and simply slow. */}
        <span className="mac-handoff-message">Didn’t see Papol open?</span>
        <a href={DOWNLOAD_URL} target="_blank" rel="noreferrer">Download Papol for Mac</a>
        <button type="button" className="mac-handoff-dismiss" onClick={notNow}>
          Not now
        </button>
      </div>
    );
  }

  return (
    <div className="mac-handoff-bar" role="status">
      <span className="mac-handoff-message">{offer.label}.</span>
      <button type="button" className="mac-handoff-open" onClick={hand} disabled={state === 'trying'}>
        {state === 'trying' ? 'Opening…' : 'Open in Papol'}
      </button>
      <button type="button" className="mac-handoff-dismiss" onClick={notNow}>
        Not now
      </button>
      <button type="button" className="mac-handoff-dismiss" onClick={retire}>
        Don’t ask again
      </button>
    </div>
  );
}
