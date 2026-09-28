import React, { useEffect, useState } from 'react';
import { Working } from '../../../shared/ui/Waiting.js';
import {
  getNotifications,
  markNotificationRead,
  markNotificationsRead,
} from '../../../shared/api/notifications.js';
import { keep, kept } from '../lastMember';

const unreadIn = (notifications) => notifications.filter((x) => !x.read).length;

// Bare, it is a tab of the member's own page, which already says Inbox.
export default function InboxPage({ onUnread, bare = false }) {
  const [data, setData] = useState(() => kept('inbox'));
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState({}); // uuid -> bool

  useEffect(() => {
    if (data) keep('inbox', data);
  }, [data]);

  useEffect(() => {
    getNotifications()
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="error" role="alert">{error}</div>;
  if (!data) return <div className="loading"><Working label="Loading inbox…" /></div>;

  const formatWhen = (dateString) =>
    new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const applyRead = (ids) => {
    const notifications = data.notifications.map((x) =>
      ids.includes(x.uuid) ? { ...x, read: true } : x
    );
    setData({ notifications });
    onUnread(unreadIn(notifications));
  };

  const handleClick = (n) => {
    if (!n.read) {
      markNotificationRead(n.uuid).catch(() => {});
      applyRead([n.uuid]);
    }
    setExpanded((e) => ({ ...e, [n.uuid]: !e[n.uuid] }));
  };

  const handleMarkAll = async () => {
    markNotificationsRead().catch(() => {});
    applyRead(data.notifications.map((x) => x.uuid));
  };

  return (
    <div className={bare ? 'panel inbox-panel is-bare' : 'panel inbox-panel'}>
      <div className="panel-head-row">
        {!bare && <h2 className="panel-title">Inbox</h2>}
        {unreadIn(data.notifications) > 0 && (
          <button className="link-button" onClick={handleMarkAll}>
            Mark all as read
          </button>
        )}
      </div>
      {data.notifications.length === 0 ? (
        <p className="no-comments">No notifications yet.</p>
      ) : (
        <ul className="notification-list">
          {data.notifications.map((n) => (
            <li
              key={n.uuid}
              className={n.read ? 'notification-item' : 'notification-item unread'}>
              {/* A real button, so a notification can be reached and opened
                  from the keyboard, not only clicked. */}
              <button
                type="button"
                className="notification-toggle"
                aria-expanded={Boolean(expanded[n.uuid])}
                onClick={() => handleClick(n)}
              >
                <span
                  className={
                    expanded[n.uuid] ? 'notification-content' : 'notification-content collapsed'
                  }
                >
                  {!n.read && <span className="notification-new">new</span>}
                  {n.content}
                </span>
                <span className="notification-date">{formatWhen(n.created_at)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
