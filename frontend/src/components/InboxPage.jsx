import React, { useEffect, useState } from 'react';
import {
  getNotifications,
  markNotificationRead,
  markNotificationsRead,
} from '../api';

export default function InboxPage({ onOpenRoom, onUnread }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState({}); // id -> bool

  useEffect(() => {
    getNotifications()
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!data) return <div className="loading">Loading inbox…</div>;

  const formatWhen = (dateString) =>
    new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const applyRead = (ids) => {
    const notifications = data.notifications.map((x) =>
      ids.includes(x.id) ? { ...x, read: true } : x
    );
    const unread_count = notifications.filter((x) => !x.read).length;
    setData({ unread_count, notifications });
    if (onUnread) onUnread(unread_count);
  };

  const handleClick = (n) => {
    if (!n.read) {
      markNotificationRead(n.id).catch(() => {});
      applyRead([n.id]);
    }
    setExpanded((e) => ({ ...e, [n.id]: !e[n.id] }));
  };

  const handleMarkAll = async () => {
    markNotificationsRead().catch(() => {});
    applyRead(data.notifications.map((x) => x.id));
  };

  return (
    <div className="panel">
      <div className="panel-head-row">
        <h2 className="panel-title">Inbox</h2>
        {data.unread_count > 0 && (
          <button className="link-btn" onClick={handleMarkAll}>
            Mark all as read
          </button>
        )}
      </div>
      {data.notifications.length === 0 ? (
        <p className="no-comments">No notifications yet.</p>
      ) : (
        <ul className="notif-list">
          {data.notifications.map((n) => (
            <li
              key={n.id}
              className={n.read ? 'notif-item' : 'notif-item unread'}
            >
              {/* A real button, so a notification can be reached and opened
                  from the keyboard, not only clicked. */}
              <button
                type="button"
                className="notif-toggle"
                aria-expanded={Boolean(expanded[n.id])}
                onClick={() => handleClick(n)}
              >
                <span
                  className={
                    expanded[n.id] ? 'notif-content' : 'notif-content collapsed'
                  }
                >
                  {!n.read && <span className="notif-new">new</span>}
                  {n.content}
                </span>
                <span className="notif-date">{formatWhen(n.created_at)}</span>
              </button>
              {expanded[n.id] && n.room_id && (
                <p className="notif-room-link">
                  <button
                    className="link-btn"
                    onClick={() => onOpenRoom(n.room_id)}
                  >
                    Open the seminar cohort →
                  </button>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
