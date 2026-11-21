import React, { useEffect, useState } from 'react';
import { acceptFriendLink, previewFriendLink } from '../../../shared/api/friends.js';
import { loadFriends } from '../friendsStore';
import { appPath } from '../base';
import Avatar from './Avatar';

// Where a friend link lands: whose it is, and one button. Handing the
// link over was its owner's half, so pressing it makes the two friends.
// A centred card, like a project's invitation.
export default function FriendLinkPage({ code }) {
  const [found, setFound] = useState(null);
  const [closed, setClosed] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    previewFriendLink(code)
      .then((next) => { if (active) setFound(next); })
      .catch((err) => {
        if (!active) return;
        if (err.status === 404) setClosed(true);
        else setError(err.message);
      });
    return () => { active = false; };
  }, [code]);

  if (!found && !closed && error) return <div className="panel"><div className="error" role="alert">{error}</div></div>;
  if (!found && !closed) return null;

  const befriend = async () => {
    setBusy(true);
    setError(null);
    try {
      setFound(await acceptFriendLink(code));
      loadFriends().catch(() => {});
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const owner = found?.user;
  return (
    <div className="project-invitation friend-link-page">
      <div className="panel project-invitation-card">
        <p className="kicker">Friend link</p>
        {closed ? (
          <h2>This friend link is no longer open</h2>
        ) : (
          <>
            <div className="friend-link-who">
              <Avatar user={owner} className="their-face" />
              <div>
                <h2>{owner.display_name}</h2>
                {owner.affiliation && <p className="project-invitation-keepers">{owner.affiliation}</p>}
              </div>
            </div>
            {found.is_me && <p className="hint project-invitation-note">This is your own friend link. Whoever opens it can become your friend.</p>}
            {!found.is_me && !found.is_friend && (
              <p className="hint project-invitation-note">
                Friends see each other’s reading in the Common room, and read and post in each other’s digs on papers kept on a public shelf.
              </p>
            )}
            {found.is_friend && <p className="hint project-invitation-note">You and {owner.display_name.split(' ')[0]} are friends.</p>}
            {error && <div className="error" role="alert">{error}</div>}
            {found.is_me ? null : found.is_friend ? (
              <a className="button primary full-width" href={appPath(`/u/${owner.uuid}`)}>Open {owner.display_name.split(' ')[0]}’s nook</a>
            ) : (
              <button type="button" className="primary full-width" onClick={befriend} disabled={busy}>
                {busy ? 'Becoming friends…' : 'Be friends'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
