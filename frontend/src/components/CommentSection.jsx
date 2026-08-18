import React, { useState } from 'react';
import { addComment, deleteComment } from '../api';

export default function CommentSection({ paperId, comments, currentUser, onCommentChange }) {
  const [newComment, setNewComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!newComment.trim()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await addComment(paperId, newComment.trim());
      setNewComment('');
      onCommentChange();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (commentId) => {
    if (!confirm('Delete this comment?')) return;

    try {
      await deleteComment(commentId);
      onCommentChange();
    } catch (err) {
      setError(err.message);
    }
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="comment-section">
      <h4>
        Notes ({comments.length})
        <span className="visibility-badge private">private</span>
      </h4>

      {error && <div className="error">{error}</div>}

      <form onSubmit={handleSubmit} className="comment-form">
        <textarea
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          placeholder="Add a private note..."
          rows="3"
        />
        <button type="submit" disabled={isSubmitting || !newComment.trim()}>
          {isSubmitting ? 'Adding...' : 'Add Note'}
        </button>
      </form>

      <div className="comments-list">
        {comments.length > 0 &&
          comments.map((comment) => (
            <div key={comment.id} className="comment">
              <div className="comment-content">{comment.content}</div>
              <div className="comment-footer">
                <span className="comment-date">{formatDate(comment.created_at)}</span>
                {currentUser && comment.user && comment.user.id === currentUser.id && (
                  <button
                    className="delete-comment-btn"
                    onClick={() => handleDelete(comment.id)}
                    title="Delete comment"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
