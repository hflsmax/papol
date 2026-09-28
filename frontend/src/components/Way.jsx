import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { appPath } from '../base';
import Avatar from './Avatar';

// Papol's three places. A member is always in one of them or somewhere
// reached from one, and the bar says which in words.
const PLACES = [
  { path: '/', label: 'My nook', pages: ['home'] },
  { path: '/projects', label: 'Projects', pages: ['projects'] },
  { path: '/library', label: 'Library', pages: ['papers'] },
];

// The pages that are a place, or stand beside the places (the inbox, the
// member's own profile): the bar shows the places as siblings to switch
// between. Anywhere else it is a trail back to where the page was opened.
const PLACE_PAGES = new Set(['home', 'projects', 'papers', 'inbox', 'profile', 'admin', 'about', 'learn']);

export function isPlacePage(route, user) {
  return PLACE_PAGES.has(route.page) || (route.page === 'nook' && route.uuid === user?.uuid);
}

// The one bar over a signed-in member's pages on the web: the way round
// Papol on the left, and on the right what is waiting for the member and
// who they are. A page deeper than a place names its own trail through
// InWay; `trail` is the one said for it when it names none.
export function WayBar({ user, route, trail = [], unreadCount = 0, projectNewCount = 0 }) {
  const place = isPlacePage(route, user);
  return (
    <header className="way-bar">
      <nav className="way" aria-label="Where this is">
        <a className="way-mark" href={appPath('/')}>Papol</a>
        {place ? (
          <span className="way-places">
            {PLACES.map(({ path, label, pages }) => {
              const here = pages.includes(route.page) || (path === '/' && route.page === 'nook');
              return (
                <a key={path} href={appPath(path)} aria-current={here ? 'page' : undefined}>
                  {label}
                  {path === '/projects' && projectNewCount > 0 && (
                    <span className="way-count" title={`${projectNewCount} new`}>{projectNewCount}</span>
                  )}
                </a>
              );
            })}
          </span>
        ) : (
          <>
            <span className="way-trail" id="way-slot" />
            <span className="way-trail way-default">
              {trail.map(({ path, label }) => <a key={path} href={appPath(path)}>{label}</a>)}
            </span>
          </>
        )}
      </nav>
      <a
        className="way-inbox"
        href={appPath('/inbox')}
        aria-current={route.page === 'inbox' ? 'page' : undefined}
        aria-label={unreadCount > 0 ? `Inbox, ${unreadCount} unread` : 'Inbox'}
      >
        Inbox
        {unreadCount > 0 && <span className="way-count">{unreadCount}</span>}
      </a>
      <a
        className="way-self"
        href={appPath('/profile')}
        aria-current={route.page === 'profile' ? 'page' : undefined}
        title={user.display_name}
      >
        <Avatar user={user} className="nav-avatar" />
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
