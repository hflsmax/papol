import React, { useEffect, useRef, useState } from 'react';
import { Working } from '../../../shared/ui/Waiting.js';
import {
  getNotifications,
  markNotificationRead,
  markNotificationsRead,
} from '../../../shared/api/notifications.js';
import { keep, kept } from '../lastMember';
import { inboxWhen, inboxWhenFull } from '../inboxWhen';

const unreadIn = (notifications) => notifications.filter((x) => !x.read).length;

// What has come for a member, newest first, as a mail list: one line
// each, the gold dot on those not yet read, the day at the end. It never
// titles itself: on the web it is a tab of the member's own page, and on
// the Mac the window's toolbar says Inbox.
export default function InboxPage({ onUnread }) {
  const [data, setData] = useState(() => kept('inbox'));
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState({}); // uuid -> bool
  // Read here while the list was being asked for again: an answer that
  // left before the click must not bring the dot back.
  const readHere = useRef(new Set());

  useEffect(() => {
    if (data) keep('inbox', data);
  }, [data]);

  useEffect(() => {
    getNotifications()
      .then((fresh) => setData({
        notifications: fresh.notifications.map((x) => (readHere.current.has(x.uuid) ? { ...x, read: true } : x)),
      }))
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="error" role="alert">{error}</div>;
  if (!data) return <div className="loading"><Working label="Loading inbox…" /></div>;

  const applyRead = (ids) => {
    ids.forEach((id) => readHere.current.add(id));
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

  if (data.notifications.length === 0) return <p className="inbox-empty">No notifications yet.</p>;

  return (
    <div className="inbox">
      {unreadIn(data.notifications) > 0 && (
        <div className="inbox-head">
          <button type="button" className="inbox-read-all" onClick={handleMarkAll}>
            Mark all as read
          </button>
        </div>
      )}
      <ul className="notification-list">
        {data.notifications.map((n) => (
          <li
            key={n.uuid}
            className={`notification-item${n.read ? '' : ' unread'}${expanded[n.uuid] ? ' is-open' : ''}`}>
            {/* A real button, so a notification can be reached and opened
                from the keyboard, not only clicked. */}
            <button
              type="button"
              className="notification-toggle"
              aria-expanded={Boolean(expanded[n.uuid])}
              onClick={() => handleClick(n)}
            >
              <span className="notification-mark">
                {!n.read && <><span className="news-dot" aria-hidden="true" /><span className="visually-hidden">New: </span></>}
              </span>
              <span className="notification-content">{n.content}</span>
              <time className="notification-date" dateTime={n.created_at} title={inboxWhenFull(n.created_at)}>
                {inboxWhen(n.created_at)}
              </time>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
