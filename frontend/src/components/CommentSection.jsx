import React, { useState } from 'react';
import { addComment, updateComment, deleteComment } from '../api';
import Markdown, { MarkdownHint } from './Markdown';
import AutoTextarea from './AutoTextarea';

export default function CommentSection({
  noteHref, paperId, comments, currentUser, onCommentChange }) {
  const [newComment, setNewComment] = useState('');
  const [composing, setComposing] = useState(false);
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
      setComposing(false);
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
        {!composing && (
          <button
            className="link-btn summary-edit"
            onClick={() => setComposing(true)}
          >
            Add a note
          </button>
        )}
      </h4>

      {error && <div className="error">{error}</div>}

      {composing && (
        <form onSubmit={handleSubmit} className="inline-edit comment-compose">
          <AutoTextarea
            className="inline-edit-box"
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Add a private note..."
            rows={4}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Escape') setComposing(false);
            }}
          />
          <MarkdownHint />
          <div className="inline-edit-actions">
            <button
              type="submit"
              className="primary"
              disabled={isSubmitting || !newComment.trim()}
            >
              {isSubmitting ? 'Adding...' : 'Add'}
            </button>
            <button type="button" onClick={() => setComposing(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="comments-list">
        {comments.length > 0 &&
          comments.map((comment) => (
            <div key={comment.id} className="comment">
              {editingId === comment.id ? (
                <div className="inline-edit">
                  <AutoTextarea
                    className="inline-edit-box"
                    value={draft}
                    rows={3}
                    autoFocus
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                  />
                  <MarkdownHint />
                  <div className="inline-edit-actions">
                    <button className="primary" onClick={saveEdit}>
                      Save
                    </button>
                    <button onClick={() => setEditingId(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="comment-content">
                    <Markdown text={comment.content} />
                  </div>
                  <div className="comment-footer">
                    {/* A note taken in the viewer knows where it sits; the
                        link opens the paper there. */}
                    {comment.page != null && (
                      <a
                        className="note-page"
                        href={noteHref(comment)}
                        title="Open this note in the PDF"
                      >
                        page {comment.page}
                      </a>
                    )}
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
