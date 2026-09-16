import React, { useEffect, useState } from 'react';
import {
  getNotifications,
  markNotificationRead,
  markNotificationsRead,
} from '../../../shared/api/notifications.js';
import { contextMenuHandler } from '../../../shared/contextMenu';

export default function InboxPage({ onOpenRoom, onUnread }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState({}); // uuid -> bool

  useEffect(() => {
    getNotifications()
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="error" role="alert">{error}</div>;
  if (!data) return <div className="loading" role="status" aria-live="polite">Loading inbox…</div>;

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
    const unread_count = notifications.filter((x) => !x.read).length;
    setData({ unread_count, notifications });
    if (onUnread) onUnread(unread_count);
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
    <div className="panel">
      <div className="panel-head-row">
        <h2 className="panel-title">Inbox</h2>
        {data.unread_count > 0 && (
          <button className="link-btn" onClick={handleMarkAll}>
            Annotation all as read
          </button>
        )}
      </div>
      {data.notifications.length === 0 ? (
        <p className="no-comments">No notifications yet.</p>
      ) : (
        <ul className="notif-list">
          {data.notifications.map((n) => (
            <li
              key={n.uuid}
              className={n.read ? 'notif-item' : 'notif-item unread'}
              onContextMenu={contextMenuHandler(() => [
                { label: expanded[n.uuid] ? 'Collapse' : 'Expand', onSelect: () => handleClick(n) },
                !n.read && { label: 'Mark as Read', onSelect: () => {
                  markNotificationRead(n.uuid).catch(() => {});
                  applyRead([n.uuid]);
                } },
                n.room_uuid && { separator: true },
                n.room_uuid && { label: 'Open Seminar', onSelect: () => onOpenRoom(n.room_uuid) },
              ])}
            >
              {/* A real button, so a notification can be reached and opened
                  from the keyboard, not only clicked. */}
              <button
                type="button"
                className="notif-toggle"
                aria-expanded={Boolean(expanded[n.uuid])}
                onClick={() => handleClick(n)}
              >
                <span
                  className={
                    expanded[n.uuid] ? 'notif-content' : 'notif-content collapsed'
                  }
                >
                  {!n.read && <span className="notif-new">new</span>}
                  {n.content}
                </span>
                <span className="notif-date">{formatWhen(n.created_at)}</span>
              </button>
              {expanded[n.uuid] && n.room_uuid && (
                <p className="notif-room-link">
                  <button
                    className="link-btn"
                    onClick={() => onOpenRoom(n.room_uuid)}
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
