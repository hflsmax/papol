import React, { useState, useEffect } from 'react';
import { listUsers } from '../api';
import Avatar from './Avatar';

export default function UserDirectory({ currentUser, onVisit }) {
  const [users, setUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    listUsers()
      .then(setUsers)
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading) return <div className="loading">Loading readers…</div>;

  return (
    <div className="panel">
      <h2 className="panel-title">Readers</h2>
      {error && <div className="error">{error}</div>}
      <ul className="user-list">
        {users.map((user) => (
          <li key={user.id} onClick={() => onVisit(user.id)}>
            <span className="user-cell">
              <Avatar user={user} className="entry-avatar" />
              <span className="user-name">
                {user.display_name}
                {currentUser && user.id === currentUser.id && (
                  <span className="you-tag"> (you)</span>
                )}
              </span>
            </span>
            {user.affiliation && (
              <span className="user-meta">{user.affiliation}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
