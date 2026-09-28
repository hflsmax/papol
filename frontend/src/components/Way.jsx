import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { appPath } from '../base';
import Avatar from './Avatar';

// A member's nook is the centre of Papol: Papol itself leads there, and
// every page is a trail back to it. Beside it sits, quietly, the one place
// where everyone else's work is: their papers, boards and projects.
export const BAZAAR = 'Bazaar';

// The one bar over a signed-in member's pages on the web: the trail home
// on the left, and on the right the Bazaar beside it and the member, who
// wears the count of what has come for them. A page names its own trail through InWay;
// `trail` is the one said for it when it names none.
export function WayBar({ user, route, trail = [], unreadCount = 0 }) {
  return (
    <header className="way-bar">
      <nav className="way" aria-label="Where this is">
        <a className="way-mark" href={appPath('/')}>Papol</a>
        <span className="way-trail" id="way-slot" />
        <span className="way-trail way-default">
          {trail.map(({ path, label }) => <a key={path} href={appPath(path)}>{label}</a>)}
        </span>
      </nav>
      <nav className="way-aside" aria-label="Elsewhere">
        <a href={appPath('/bazaar')} aria-current={route.page === 'papers' || route.page === 'projects' ? 'page' : undefined}>
          {BAZAAR}
        </a>
      </nav>
      <a
        className="way-self"
        href={appPath('/profile')}
        aria-current={route.page === 'profile' || route.page === 'inbox' ? 'page' : undefined}
        aria-label={unreadCount > 0 ? `${user.display_name}, ${unreadCount} unread` : user.display_name}
        title={user.display_name}
      >
        <Avatar user={user} className="nav-avatar" />
        {unreadCount > 0 && <span className="way-count way-self-count" aria-hidden="true">{unreadCount}</span>}
      </a>
    </header>
  );
}

// What a page adds to the bar's trail: the steps between Papol and the
// page itself, each a link. It takes the place of the bar's own guess.
export function InWay({ children }) {
  const [slot, setSlot] = useState(null);
  useEffect(() => { setSlot(document.getElementById('way-slot')); }, []);
  return slot ? createPortal(children, slot) : null;
}

// Where Papol's pages for visitors live once a member is signed in: at
// the foot of the page, out of the way of the work.
export function WayFoot({ user, macDownloadUrl }) {
  return (
    <footer className="way-foot">
      <a href={appPath('/about')}>About</a>
      <a href={appPath('/learn')}>Learn</a>
      <a href={macDownloadUrl} target="_blank" rel="noreferrer">Mac app</a>
      {user.is_admin && <a href={appPath('/admin')}>Admin</a>}
    </footer>
  );
}
