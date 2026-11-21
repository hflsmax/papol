import React, { useState } from 'react';
import { Working } from '../../../shared/ui/Waiting.js';
import { closeFriendLink, friendLinkPath, openFriendLink, shareReading } from '../../../shared/api/friends.js';
import { copyText } from '../../../shared/nativeData.js';
import { appPath } from '../base';
import { backendPath } from '../../../shared/appUrls.js';
import { friendActs, useFriends } from '../friendsStore';
import Avatar from './Avatar';
import FriendButton from './FriendButton';

const since = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '');

// My friends, on my own page: who asked and waits for an answer, who my
// friends are, the link that makes whoever opens it my friend, and whether
// my friends see what I am reading. Mine alone: nobody else is shown the
// list or how long it is.
export default function FriendsPanel({ user }) {
  const friends = useFriends();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  if (!friends) return <div className="loading"><Working label="Loading friends…" /></div>;

  const run = async (call) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { friendActs.set(await call()); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  // On the service's address, not this window's, which on the Mac is the app's.
  const link = friends.link ? new URL(backendPath(friendLinkPath(friends.link)), window.location.origin).toString() : null;
  const copy = async () => {
    try { await copyText(link); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { /* the link can be selected by hand */ }
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
            No friends yet. Add someone from their nook, or send them your friend link.
            Friends see each other’s reading in the Common room, and read and post in each other’s digs on papers kept on a public shelf.
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

      <section className="friends-block" aria-labelledby="friends-link">
        <h3 className="kicker" id="friends-link">My friend link</h3>
        {link ? (
          <>
            <p className="friends-note">Whoever opens this link signed in can become your friend in one press, with no second step from you.</p>
            <div className="project-invite friends-link">
              <code className="project-invite-link" title={link} tabIndex={0}>{link}</code>
              <button type="button" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
              <button type="button" className="project-quiet" disabled={busy} onClick={() => run(closeFriendLink)}>Turn off</button>
            </div>
          </>
        ) : (
          <>
            <p className="friends-note">A link to hand to someone you know: opening it makes them your friend. You can turn it off whenever you like.</p>
            <button type="button" disabled={busy} onClick={() => run(openFriendLink)}>Make my friend link</button>
          </>
        )}
      </section>

      <section className="friends-block" aria-labelledby="friends-reading">
        <h3 className="kicker" id="friends-reading">What my friends see</h3>
        <label className="checkbox-row">
          <input type="checkbox" checked={friends.shares_reading} disabled={busy} onChange={(e) => run(() => shareReading(e.target.checked))} />
          <span>Friends see what I’m reading</span>
        </label>
        <p className="friends-note">
          On, a friend sees that you read a paper this week, for papers on your public shelves only.
          Never how long, on which days, or your effort: your activity stays yours alone.
        </p>
      </section>
    </div>
  );
}
