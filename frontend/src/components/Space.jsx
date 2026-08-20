import React, { useState, useEffect, useCallback } from 'react';
import { getUserSpace } from '../api';
import PaperUpload from './PaperUpload';
import PaperList from './PaperList';
import Avatar from './Avatar';

export default function Space({ userId, currentUser, onSelectPaper, onBack }) {
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
      {onBack && (
        <button className="back-btn" onClick={onBack}>
          &larr; Back
        </button>
      )}
      <div className="space-header">
        <div className="space-header-row">
          <Avatar user={space.user} className="space-avatar" />
          <div>
            <h2>{isOwn ? 'My nook' : `${space.user.display_name}'s nook`}</h2>
            {space.user.affiliation && (
              <p className="space-subtitle">{space.user.affiliation}</p>
            )}
            {/* Only present when the reader chose to show it. */}
            {space.user.email && (
              <p className="space-email">
                <a href={`mailto:${space.user.email}`}>{space.user.email}</a>
              </p>
            )}
            {space.stats && (
              <p className="nook-stats">
                {[
                  `${space.stats.papers} ${space.stats.papers === 1 ? 'paper' : 'papers'}`,
                  `${space.stats.displayed} on display`,
                  `${space.stats.notes} ${space.stats.notes === 1 ? 'note' : 'notes'}`,
                  `${space.stats.seminars} seminar ${space.stats.seminars === 1 ? 'cohort' : 'cohorts'}`,
                ].map((stat, i, all) => (
                  <React.Fragment key={stat}>
                    {i > 0 && ' '}
                    {/* each metric is an unbreakable unit; the separator
                        stays glued to the metric before it */}
                    <span className="stat">
                      {stat}
                      {i < all.length - 1 && ' ·'}
                    </span>
                  </React.Fragment>
                ))}
              </p>
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
