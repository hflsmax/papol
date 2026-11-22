import React, { useState } from 'react';
import { Working } from '../../../shared/ui/Waiting.js';
import { appPath } from '../base';
import { friendActs, useFriends } from '../friendsStore';
import Avatar from './Avatar';
import FriendButton from './FriendButton';

const since = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '');

// My friends, on my own page: who asked and waits for an answer, who my
// friends are, and who my friends are. Mine alone: nobody else is shown the
// list or how long it is.
export default function FriendsPanel({ user }) {
  const friends = useFriends();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (!friends) return <div className="loading"><Working label="Loading friends…" /></div>;

  const run = async (call) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { friendActs.set(await call()); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="friends-panel">
      {error && <div className="error" role="alert">{error}</div>}
      {friends.requests.length > 0 && (
        <section className="friends-block" aria-labelledby="friends-requests">
          <h3 className="kicker" id="friends-requests">Asking to be friends</h3>
          <ul className="friends-list">
            {friends.requests.map((r) => (
              <li key={r.user.uuid} className="friends-row">
                <a className="friends-who" href={appPath(`/u/${r.user.uuid}`)}>
                  <Avatar user={r.user} className="friends-face" />
                  <span className="friends-name">{r.user.display_name}</span>
                  {r.user.affiliation && <span className="friends-aff">{r.user.affiliation}</span>}
                </a>
                <FriendButton user={r.user} currentUser={user} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="friends-block" aria-labelledby="friends-mine">
        <h3 className="kicker" id="friends-mine">My friends</h3>
        {friends.friends.length === 0 ? (
          <p className="friends-empty">
            No friends yet. Add someone from their nook.
            Friends see what each other adds, thinks and digs in the Lounge, and read and post in each other’s digs on papers kept on a public shelf.
          </p>
        ) : (
          <ul className="friends-list">
            {friends.friends.map((f) => (
              <li key={f.user.uuid} className="friends-row">
                <a className="friends-who" href={appPath(`/u/${f.user.uuid}`)}>
                  <Avatar user={f.user} className="friends-face" />
                  <span className="friends-name">{f.user.display_name}</span>
                  {f.user.affiliation && <span className="friends-aff">{f.user.affiliation}</span>}
                </a>
                <span className="friends-since">since {since(f.since)}</span>
                <FriendButton user={f.user} currentUser={user} />
              </li>
            ))}
          </ul>
        )}
        <p className="friends-note">Only you see this list.</p>
      </section>

    </div>
  );
}
