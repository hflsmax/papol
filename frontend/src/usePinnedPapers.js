import { useEffect, useState } from 'react';
import { PINS_CHANGED, pinnedPapers, takePinsFromPapol } from '../../shared/pins.js';

// The papers the signed-in user pinned (a Set of sha256), kept current: a
// pin made in this window, in another window, or on another device, which
// Papol is asked about when the list opens and when its window comes back
// to the front.
export default function usePinnedPapers() {
  const [pinned, setPinned] = useState(pinnedPapers);
  useEffect(() => {
    const read = () => setPinned(pinnedPapers());
    const take = () => { void takePinsFromPapol().catch(() => {}); };
    const onStorage = (event) => { if (event.key == null || event.key === 'papol.pins') read(); };
    read();
    take();
    window.addEventListener(PINS_CHANGED, read);
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', take);
    return () => {
      window.removeEventListener(PINS_CHANGED, read);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', take);
    };
  }, []);
  return pinned;
}
