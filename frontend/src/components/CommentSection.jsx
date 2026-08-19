import React, { useState } from 'react';
import { addComment, updateComment, deleteComment } from '../api';

export default function CommentSection({ paperId, comments, currentUser, onCommentChange }) {
  const [newComment, setNewComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState('');

  const saveEdit = async () => {
    if (!draft.trim()) return;
    setError(null);
    try {
      await updateComment(editingId, draft.trim());
      setEditingId(null);
      onCommentChange();
    } catch (err) {
      setError(err.message);
    }
  };

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
              {editingId === comment.id ? (
                <div className="inline-edit">
                  <textarea
                    className="inline-edit-box"
                    value={draft}
                    rows={3}
                    autoFocus
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                  />
                  <div className="inline-edit-actions">
                    <button className="primary" onClick={saveEdit}>
                      Save
                    </button>
                    <button onClick={() => setEditingId(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="comment-content">{comment.content}</div>
                  <div className="comment-footer">
                    <span className="comment-date">{formatDate(comment.created_at)}</span>
                    {currentUser && comment.user && comment.user.id === currentUser.id && (
                      <span className="comment-actions">
                        <button
                          className="delete-comment-btn"
                          onClick={() => {
                            setDraft(comment.content);
                            setEditingId(comment.id);
                          }}
                          title="Edit note"
                        >
                          Edit
                        </button>
                        <button
                          className="delete-comment-btn"
                          onClick={() => handleDelete(comment.id)}
                          title="Delete note"
                        >
                          Delete
                        </button>
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}
