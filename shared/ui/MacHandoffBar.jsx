import { useEffect, useRef, useState } from 'react';
import { DESKTOP } from '../desktopShell.js';
import {
  ALWAYS_KEY, DOWNLOAD_URL, RETIRED_KEY,
  attemptHandoff, deferDocument, handoffCapableMac, handoffOffer, writeFlag,
} from '../macHandoff.js';

// Shown at the top of a document the Mac app could open better, in the
// browser only (USER_STORIES.md §7d). It is a bar and not a dialog because
// the reader came here to read, and it never navigates the tab: whatever
// the system does with the address, the reading behind this bar is still
// where it was.
export default function MacHandoffBar() {
  const [offer, setOffer] = useState(null);
  const [state, setState] = useState('offer');
  const [always, setAlways] = useState(false);
  const tried = useRef(false);

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
    setAlways(made.always);
  }, []);

  const hand = () => {
    tried.current = true;
    setState('trying');
    attemptHandoff(offer.address).then((verdict) => {
      setState(verdict === 'opened' ? 'opened' : 'missing');
    });
  };

  // "Always open in Papol" is the reader's standing answer, so the offer is
  // not put to them again — it is simply carried out. A failed attempt still
  // lands on the download rather than repeating silently.
  useEffect(() => {
    if (!offer || !offer.always || tried.current) return;
    hand();
  }, [offer]);

  if (!offer) return null;

  const notNow = () => {
    deferDocument(window.sessionStorage, offer.identity);
    setOffer(null);
  };

  const retire = () => {
    writeFlag(window.localStorage, RETIRED_KEY, true);
    setOffer(null);
  };

  const stopAlways = () => {
    writeFlag(window.localStorage, ALWAYS_KEY, false);
    setAlways(false);
    setOffer(null);
  };

  if (state === 'opened') {
    // A reader who asked for this once can see their Papol and does not need
    // telling (US-7.34). A standing answer is different: it acted without
    // asking, so the tab it acted from says where the paper went and how to
    // stop it doing so again (US-7.27).
    if (!offer.always) return null;
    return (
      <div className="mac-handoff-bar" role="status">
        <span>Opened in Papol for Mac.</span>
        <button type="button" className="mac-handoff-dismiss" onClick={stopAlways}>
          Stop opening in Papol
        </button>
      </div>
    );
  }

  if (state === 'missing') {
    return (
      <div className="mac-handoff-bar" role="status">
        {/* What this tab saw, not a verdict about the reader's computer
            (US-7.34): Papol may well be installed and simply slow. */}
        <span>Papol didn’t open.</span>
        <a href={DOWNLOAD_URL} target="_blank" rel="noreferrer">Download Papol for Mac</a>
        <button type="button" className="mac-handoff-dismiss" onClick={notNow}>
          Not now
        </button>
      </div>
    );
  }

  return (
    <div className="mac-handoff-bar" role="status">
      <span>{offer.label}.</span>
      <button type="button" className="mac-handoff-open" onClick={hand} disabled={state === 'trying'}>
        {state === 'trying' ? 'Opening…' : 'Open in Papol'}
      </button>
      <label className="mac-handoff-always">
        <input
          type="checkbox"
          checked={always}
          onChange={(event) => {
            setAlways(event.target.checked);
            writeFlag(window.localStorage, ALWAYS_KEY, event.target.checked);
          }}
        />
        Always
      </label>
      <button type="button" className="mac-handoff-dismiss" onClick={notNow}>
        Not now
      </button>
      <button type="button" className="mac-handoff-dismiss" onClick={retire}>
        Don’t ask again
      </button>
    </div>
  );
}
