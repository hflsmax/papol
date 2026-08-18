import React, { useEffect, useState } from 'react';
import { getNotifications, markNotificationsRead } from '../api';

export default function InboxPage({ onOpenRoom, onRead }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getNotifications()
      .then((d) => {
        setData(d);
        if (d.unread_count > 0) {
          markNotificationsRead()
            .then(() => onRead && onRead())
            .catch(() => {});
        }
      })
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

  return (
    <div className="panel">
      <h2 className="panel-title">Inbox</h2>
      {data.notifications.length === 0 ? (
        <p className="no-comments">No notifications yet.</p>
      ) : (
        <ul className="notif-list">
          {data.notifications.map((n) => (
            <li
              key={n.id}
              className={n.read ? 'notif-item' : 'notif-item unread'}
              onClick={() => n.room_id && onOpenRoom(n.room_id)}
              title={n.room_id ? 'Open the seminar cohort' : undefined}
            >
              <p className="notif-content">
                {!n.read && <span className="notif-new">new</span>}
                {n.content}
              </p>
              <p className="notif-date">{formatWhen(n.created_at)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
