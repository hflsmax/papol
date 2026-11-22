import React, { useState } from 'react';
import { confirmAction } from '../../../shared/confirmAction';
import { friendActs, relationTo, useFriends } from '../friendsStore';

// What stands between the member and someone else, and the one press that
// changes it: Ask to be friends, Requested (pressed again, taken back), Accept or
// Not now for someone who asked, and Friend. Nothing for oneself.
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
        <button type="button" className="friend-add" disabled={busy} onClick={run(() => friendActs.ask(user.uuid))}>Ask to be friends</button>
      )}
      {relation === 'requested' && (
        <button type="button" className="friend-requested" disabled={busy} title="Take the request back" onClick={run(() => friendActs.end(user.uuid))}>Requested</button>
      )}
      {relation === 'asked' && (
        <>
          <button type="button" className="primary friend-accept" disabled={busy} onClick={run(() => friendActs.accept(user.uuid))}>Accept</button>
          <button type="button" className="friend-not-now" disabled={busy} onClick={run(() => friendActs.decline(user.uuid))}>Not now</button>
        </>
      )}
      {relation === 'friend' && (
        <button type="button" className="friend-is" disabled={busy} title={`End your friendship with ${first}`} onClick={run(end)}>Friend</button>
      )}
      {error && <span className="friend-error" role="alert">{error}</span>}
    </span>
  );
}
