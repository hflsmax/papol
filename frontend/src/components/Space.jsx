import React, { useState, useEffect, useCallback } from 'react';
import { getUserSpace } from '../api';
import PaperUpload from './PaperUpload';
import PaperList from './PaperList';
import Avatar from './Avatar';

export default function Space({ userId, currentUser, onSelectPaper }) {
  const [space, setSpace] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const isOwn = currentUser != null && currentUser.id === userId;

  const loadSpace = useCallback(() => {
    setError(null);
    getUserSpace(userId)
      .then(setSpace)
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [userId]);

  useEffect(() => {
    setIsLoading(true);
    loadSpace();
  }, [loadSpace]);

  if (isLoading) return <div className="loading">Loading nook…</div>;
  if (error) return <div className="error">{error}</div>;
  if (!space) return null;

  return (
    <div className="space">
      <div className="space-header">
        <div className="space-header-row">
          <Avatar user={space.user} className="space-avatar" />
          <div>
            <h2>{isOwn ? 'My nook' : `${space.user.display_name}'s nook`}</h2>
            {space.user.affiliation && (
              <p className="space-subtitle">{space.user.affiliation}</p>
            )}
          </div>
        </div>
      </div>

      {isOwn && <PaperUpload onPaperCreated={loadSpace} />}

      <PaperList
        papers={space.papers}
        isOwn={isOwn}
        onSelectPaper={onSelectPaper}
        onChanged={loadSpace}
      />
    </div>
  );
}
