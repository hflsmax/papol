import React, { useState } from 'react';
import { addComment, updateComment, deleteComment } from '../../../shared/api/papers.js';
import Markdown, { MarkdownHint } from './Markdown';
import AutoTextarea from './AutoTextarea';
import { confirmAction } from '../../../shared/confirmAction';

export default function CommentSection({
  noteHref, onOpenNote, paperSha256, comments, currentUser, onCommentChange,
  shared = false }) {
  const [newComment, setNewComment] = useState('');
  const [composing, setComposing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [editingUuid, setEditingUuid] = useState(null);
  const [draft, setDraft] = useState('');

  const saveEdit = async () => {
    if (!draft.trim()) return;
    setError(null);
    try {
      await updateComment(editingUuid, draft.trim());
      setEditingUuid(null);
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
      await addComment(paperSha256, newComment.trim());
      setNewComment('');
      setComposing(false);
      onCommentChange();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (commentUuid) => {
    if (!(await confirmAction('Delete this comment?', { confirmLabel: 'Delete', destructive: true }))) return;

    try {
      await deleteComment(commentUuid);
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
        {/* Once a reading is shared these notes travel with it, so the
            badge that would say "private" has to say what is true. */}
        {shared
          ? <span className="visibility-badge shared">shared by link</span>
          : <span className="visibility-badge private">private</span>}
        {!composing && (
          <button
            className="link-button summary-edit"
            onClick={() => setComposing(true)}
          >
            Add a note
          </button>
        )}
      </h4>

      {error && <div className="error" role="alert">{error}</div>}

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
            <div key={comment.uuid} className="comment">
              {editingUuid === comment.uuid ? (
                <div className="inline-edit">
                  <AutoTextarea
                    className="inline-edit-box"
                    value={draft}
                    rows={3}
                    autoFocus
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setEditingUuid(null);
                    }}
                  />
                  <MarkdownHint />
                  <div className="inline-edit-actions">
                    <button className="primary" onClick={saveEdit}>
                      Save
                    </button>
                    <button onClick={() => setEditingUuid(null)}>Cancel</button>
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
                        data-document
                        title="Open this note in the PDF"
                        onClick={(event) => {
                          if (!onOpenNote || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                          event.preventDefault();
                          onOpenNote(noteHref(comment));
                        }}
                      >
                        page {comment.page}
                      </a>
                    )}
                    <span className="comment-date">{formatDate(comment.created_at)}</span>
                    {currentUser && comment.user && comment.user.uuid === currentUser.uuid && (
                      <span className="comment-actions">
                        <button
                          className="delete-comment-button"
                          onClick={() => {
                            setDraft(comment.content);
                            setEditingUuid(comment.uuid);
                          }}
                          title="Edit note"
                        >
                          Edit
                        </button>
                        <button
                          className="delete-comment-button"
                          onClick={() => handleDelete(comment.uuid)}
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
