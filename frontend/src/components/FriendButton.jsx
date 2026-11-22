import React, { useState } from 'react';
import { confirmAction } from '../../../shared/confirmAction';
import { friendActs, relationTo, useFriends } from '../friendsStore';

// What stands between the member and someone else, and the one press that
// changes it, as a glyph that says it in its tooltip: ask to be friends,
// requested (pressed again, taken back), Accept or
// Not now for someone who asked, and Friend. Nothing for oneself.
// A person, and beside them what stands between us: a plus to ask, dots
// while they have not answered, a tick once we are friends.
function Glyph({ mark }) {
  return (
    <svg className="friend-glyph" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="8" cy="6.5" r="3" />
      <path d="M2.5 16.5c0-3 2.5-5 5.5-5 1.2 0 2.3.3 3.2.9" />
      {mark === 'ask' && <path d="M15.5 11.5v5M13 14h5" />}
      {mark === 'wait' && <path d="M13 14h.01M15.5 14h.01M18 14h.01" />}
      {mark === 'friend' && <path d="m12.8 14.2 1.8 1.8 3.2-3.6" />}
    </svg>
  );
}

export default function FriendButton({ user, currentUser, className = '' }) {
  const friends = useFriends(Boolean(currentUser));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (!currentUser || !user?.uuid || user.uuid === currentUser.uuid || !friends) return null;
  const relation = relationTo(friends, user.uuid);
  const first = user.display_name?.split(' ')[0] ?? 'them';

  const run = (act) => async (event) => {
    // A button on a row that is itself a link only does its own work.
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    setBusy(true);
    setError(null);
    try { await act(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const end = async () => {
    if (!(await confirmAction(`End your friendship with ${user.display_name}? ${first} is not told.`, { confirmLabel: 'End friendship', destructive: true }))) return;
    await friendActs.end(user.uuid);
  };

  return (
    <span className={`friend-button ${className}`.trim()} data-relation={relation ?? 'none'}>
      {relation === null && (
        <button type="button" className="friend-add" disabled={busy} title={`Ask ${first} to be friends`} aria-label={`Ask ${first} to be friends`} onClick={run(() => friendActs.ask(user.uuid))}><Glyph mark="ask" /></button>
      )}
      {relation === 'requested' && (
        <button type="button" className="friend-requested" disabled={busy} title="Requested. Press to take it back" aria-label="Requested. Press to take it back" onClick={run(() => friendActs.end(user.uuid))}><Glyph mark="wait" /></button>
      )}
      {relation === 'asked' && (
        <>
          <button type="button" className="primary friend-accept" disabled={busy} onClick={run(() => friendActs.accept(user.uuid))}>Accept</button>
          <button type="button" className="friend-not-now" disabled={busy} onClick={run(() => friendActs.decline(user.uuid))}>Not now</button>
        </>
      )}
      {relation === 'friend' && (
        <button type="button" className="friend-is" disabled={busy} title={`Friends. Press to end your friendship with ${first}`} aria-label={`Friends. Press to end your friendship with ${first}`} onClick={run(end)}><Glyph mark="friend" /></button>
      )}
      {error && <span className="friend-error" role="alert">{error}</span>}
    </span>
  );
}
