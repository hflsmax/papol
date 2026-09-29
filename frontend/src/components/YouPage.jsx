import React, { useState } from 'react';
import Avatar from './Avatar';
import InboxPage from './InboxPage';
import ActivityPanel from './ActivityPanel.jsx';
import ProfilePage from './ProfilePage';

const VIEWS = [['activity', 'Activity'], ['inbox', 'Inbox'], ['account', 'Account']];

// A member's own page on the web, reached by their avatar: who they are,
// then one of what they have read, what has come for them, and their
// account. What they have read is first and opens by default; /inbox opens
// on what has come for them.
export default function YouPage({ user, unreadCount, onUnread, onUserUpdated, onLogout, onSync, initialView = 'activity' }) {
  const [view, setView] = useState(initialView);
  const move = (e) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    const at = VIEWS.findIndex(([v]) => v === view);
    const next = VIEWS[(at + step + VIEWS.length) % VIEWS.length][0];
    setView(next);
    e.currentTarget.parentElement.querySelector(`#you-tab-${next}`)?.focus();
  };
  return (
    <div className="you-page">
      <header className="you-head">
        <Avatar user={user} className="you-avatar" />
        <div className="you-who">
          <h2 className="you-name">{user.display_name}</h2>
          {user.affiliation && <p className="you-affiliation">{user.affiliation}</p>}
        </div>
        <button type="button" className="you-sign-out" onClick={onLogout}>Sign out</button>
      </header>
      <nav className="project-tabs you-tabs" role="tablist" aria-label="You">
        {VIEWS.map(([v, label]) => (
          <button
            key={v} type="button" role="tab" id={`you-tab-${v}`} aria-controls="you-view"
            aria-selected={view === v} tabIndex={view === v ? 0 : -1}
            className={`project-tab${view === v ? ' is-on' : ''}`}
            onClick={() => setView(v)} onKeyDown={move}
          >
            {label}
            {v === 'inbox' && unreadCount > 0 && (
              <span className="project-tab-new" aria-label={`${unreadCount} unread`}>{unreadCount}</span>
            )}
          </button>
        ))}
      </nav>
      <div className="you-view" id="you-view" role="tabpanel" aria-labelledby={`you-tab-${view}`}>
        {view === 'inbox' && <InboxPage onUnread={onUnread} />}
        {view === 'activity' && <ActivityPanel />}
        {view === 'account' && (
          <ProfilePage user={user} withActivity={false} inTab onUserUpdated={onUserUpdated} onLogout={onLogout} onSync={onSync} />
        )}
      </div>
    </div>
  );
}
