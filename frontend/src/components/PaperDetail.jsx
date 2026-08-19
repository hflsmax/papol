import React, { useState, useEffect, useRef } from 'react';
import { getPaper, updatePaper, deletePaper, replacePaperPdf, addToNook, pdfHref } from '../api';
import CommentSection from './CommentSection';
import RoomSection from './RoomSection';
import HintPop from './HintPop';
import Avatar from './Avatar';
import { RatingInput, RatingSummary } from './Rating';

export default function PaperDetail({ paperId, currentUser, onBack, onSelectPaper }) {
  const [paper, setPaper] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [editMode, setEditMode] = useState(null); // null | 'metadata' | 'summary'
  const [editData, setEditData] = useState({});
  const [error, setError] = useState(null);
  const [pdfNotice, setPdfNotice] = useState(null);
  const [isReplacingPdf, setIsReplacingPdf] = useState(false);
  const [toggleWarning, setToggleWarning] = useState(null);
  const [editingThought, setEditingThought] = useState(false);
  const [thoughtDraft, setThoughtDraft] = useState('');
  const [editingSummary, setEditingSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState('');
  const pdfInputRef = useRef(null);

  const handlePdfReplace = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setError(null);
    setPdfNotice(null);
    setIsReplacingPdf(true);
    try {
      await replacePaperPdf(paper.id, file);
      setPdfNotice('PDF replaced.');
      loadPaper();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsReplacingPdf(false);
      e.target.value = '';
    }
  };

  useEffect(() => {
    loadPaper();
  }, [paperId]);

  const loadPaper = async () => {
    setError(null);
    try {
      const data = await getPaper(paperId);
      setPaper(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const parseAuthors = (authorsJson) => {
    if (!authorsJson) return [];
    try {
      return JSON.parse(authorsJson);
    } catch {
      return [authorsJson];
    }
  };

  const startMetadataEdit = () => {
    setEditData({
      title: paper.title,
      authors: parseAuthors(paper.authors).join(', '),
      journal: paper.journal || '',
      year: paper.year || '',
      doi: paper.doi || '',
    });
    setEditMode('metadata');
  };


  const handleEditChange = (e) => {
    const { name, value } = e.target;
    setEditData((prev) => ({ ...prev, [name]: value }));
  };

  const handleInlineRating = async (key, value) => {
    setError(null);
    try {
      await updatePaper(paper.id, { [key]: value });
      loadPaper();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleMarketToggle = async () => {
    setError(null);
    setToggleWarning(null);
    try {
      await updatePaper(paper.id, { marketed: !paper.marketed });
      loadPaper();
    } catch (err) {
      setToggleWarning(err.message);
    }
  };

  const handleAddToNook = async () => {
    setError(null);
    try {
      const added = await addToNook(paper.id);
      setPaper(added);
      // Swap the address to the canonical form without pushing a history
      // entry — it is the same page, and Back should leave it, not repeat it.
      window.history.replaceState(null, '', `#/paper/${added.doi || added.id}`);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Remove this paper from your nook? Your ratings and notes will be deleted. This cannot be undone.')) return;
    try {
      await deletePaper(paper.id);
      onBack();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleMetadataSave = async () => {
    setError(null);
    try {
      const authorsList = editData.authors
        .split(',')
        .map((a) => a.trim())
        .filter((a) => a);

      await updatePaper(paper.id, {
        title: editData.title,
        authors: JSON.stringify(authorsList),
        journal: editData.journal || null,
        year: editData.year ? parseInt(editData.year) : null,
        doi: editData.doi || null,
      });

      setEditMode(null);
      loadPaper();
    } catch (err) {
      setError(err.message);
    }
  };

  const saveSummary = async () => {
    setError(null);
    try {
      await updatePaper(paper.id, { summary: summaryDraft.trim() || null });
      setEditingSummary(false);
      loadPaper();
    } catch (err) {
      setError(err.message);
    }
  };

  const saveThought = async () => {
    setError(null);
    try {
      await updatePaper(paper.id, { thought: thoughtDraft.trim() || null });
      setEditingThought(false);
      loadPaper();
    } catch (err) {
      setError(err.message);
    }
  };

  if (isLoading) {
    return <div className="loading">Loading paper...</div>;
  }

  if (error && !paper) {
    return (
      <div className="panel paper-detail">
        <div className="error">{error}</div>
        <button onClick={onBack}>Back</button>
      </div>
    );
  }

  if (!paper) {
    return <div>Paper not found</div>;
  }

  const authors = parseAuthors(paper.authors);
  const hasEntry = currentUser != null && paper.viewer_has_entry;

  return (
    <div className="paper-detail">
      <button className="back-btn" onClick={onBack}>
        &larr; Back
      </button>

      {error && <div className="error">{error}</div>}

      <div className="panel">
      {editMode === 'metadata' ? (
        <div className="paper-form">
          <div className="warning">
            Metadata is shared — your changes apply to this paper for every
            reader, not just you.
          </div>

          <div className="form-group">
            <label>Title</label>
            <input
              type="text"
              name="title"
              value={editData.title}
              onChange={handleEditChange}
            />
          </div>

          <div className="form-group">
            <label>Authors (comma-separated)</label>
            <input
              type="text"
              name="authors"
              value={editData.authors}
              onChange={handleEditChange}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Journal</label>
              <input
                type="text"
                name="journal"
                value={editData.journal}
                onChange={handleEditChange}
              />
            </div>

            <div className="form-group">
              <label>Year</label>
              <input
                type="number"
                name="year"
                value={editData.year}
                onChange={handleEditChange}
              />
            </div>
          </div>

          <div className="form-group">
            <label>DOI</label>
            <input
              type="text"
              name="doi"
              value={editData.doi}
              onChange={handleEditChange}
            />
          </div>

          {hasEntry && (
            <div className="form-group">
              <label>PDF</label>
              {pdfNotice && <div className="success">{pdfNotice}</div>}
              <div className="pdf-row">
                <a
                  className="btn"
                  href={pdfHref(paper)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View current PDF
                </a>
                <button
                  type="button"
                  onClick={() => pdfInputRef.current?.click()}
                  disabled={isReplacingPdf}
                >
                  {isReplacingPdf ? 'Uploading…' : 'Replace PDF…'}
                </button>
                <input
                  type="file"
                  accept=".pdf"
                  ref={pdfInputRef}
                  style={{ display: 'none' }}
                  onChange={handlePdfReplace}
                />
              </div>
            </div>
          )}

          <div className="form-actions">
            <button onClick={() => setEditMode(null)}>Cancel</button>
            <button className="primary" onClick={handleMetadataSave}>
              Save Metadata
            </button>
          </div>
        </div>
      ) : (
        <div className="paper-info">
          {hasEntry && (
            <div className="detail-toggle">
              <span className="hint-anchor">
              <button
                className={
                  paper.marketed !== false ? 'market-toggle on' : 'market-toggle off'
                }
                onClick={handleMarketToggle}
                title={
                  paper.marketed !== false
                    ? 'On display — other readers can see this paper. Click to hide it.'
                    : 'Hidden — only you can see this paper. Click to put it on display.'
                }
                aria-label={
                  paper.marketed !== false
                    ? 'On display; click to hide'
                    : 'Hidden; click to put on display'
                }
              >
                <span className="switch" aria-hidden="true">
                  <span className="switch-knob" />
                  <span className="switch-text">
                    {paper.marketed !== false ? 'Display' : 'Hidden'}
                  </span>
                </span>
              </button>
              {toggleWarning && (
                <HintPop
                  text={toggleWarning}
                  onClose={() => setToggleWarning(null)}
                />
              )}
              </span>
            </div>
          )}
          <h2>{paper.title}</h2>

          {authors.length > 0 && (
            <p className="authors">{authors.join(', ')}</p>
          )}

          <div className="metadata">
            {paper.journal && <span className="journal">{paper.journal}</span>}
            {paper.year && <span className="year">{paper.year}</span>}
            {paper.doi && (
              <a
                href={`https://doi.org/${paper.doi}`}
                target="_blank"
                rel="noopener noreferrer"
                className="doi"
              >
                {paper.doi}
              </a>
            )}
          </div>

          {(paper.also_read_by || []).length > 0 && (
            <div className="nooks-row">
              <span className="nooks-label">
                In {paper.also_read_by.length}{' '}
                {paper.also_read_by.length === 1 ? 'nook' : 'nooks'}:
              </span>
              <div className="title-chips">
                {paper.also_read_by.map((entry) => (
                  <a
                    key={entry.user.id}
                    className="avatar-chip has-pop mini"
                    href={`#/u/${entry.user.id}`}
                  >
                    <Avatar user={entry.user} className="mini-avatar" />
                    <span className="chip-pop">
                      <span className="chip-pop-name">
                        {entry.user.display_name}
                        {currentUser && entry.user.id === currentUser.id
                          ? ' (you)'
                          : ''}
                      </span>
                      {entry.user.affiliation && (
                        <span className="chip-pop-aff">
                          {entry.user.affiliation}
                        </span>
                      )}
                      {entry.thought && (
                        <span className="chip-pop-thought">“{entry.thought}”</span>
                      )}
                      <RatingSummary paper={entry} />
                    </span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {hasEntry && (
            <div className="inline-ratings">
              <h4 className="inline-ratings-title">
                Your ratings
                <span className="visibility-badge public">public</span>
              </h4>
              <RatingInput values={paper} onChange={handleInlineRating} />
            </div>
          )}

          {hasEntry && (
            <div className="inline-thought">
              <h4 className="inline-ratings-title">
                My thought
                <span className="visibility-badge public">public</span>
                {!editingThought && paper.thought && (
                  <button
                    className="link-btn summary-edit"
                    onClick={() => {
                      setThoughtDraft(paper.thought || '');
                      setEditingThought(true);
                    }}
                  >
                    edit
                  </button>
                )}
              </h4>
              {editingThought ? (
                <div className="inline-edit">
                  <textarea
                    className="inline-edit-box"
                    value={thoughtDraft}
                    maxLength={200}
                    rows={2}
                    autoFocus
                    placeholder="Your one-line take on this paper"
                    onChange={(e) => setThoughtDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setEditingThought(false);
                    }}
                  />
                  <div className="inline-edit-actions">
                    <button className="primary" onClick={saveThought}>
                      Save
                    </button>
                    <button onClick={() => setEditingThought(false)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : paper.thought ? (
                <p className="inline-thought-text">{paper.thought}</p>
              ) : (
                <button
                  className="link-btn"
                  onClick={() => {
                    setThoughtDraft('');
                    setEditingThought(true);
                  }}
                >
                  Add a one-sentence thought
                </button>
              )}
            </div>
          )}

          <div className="paper-actions">
            <a
              href={pdfHref(paper)}
              target="_blank"
              rel="noopener noreferrer"
              className="btn"
            >
              View PDF
            </a>
            {currentUser && (
              <button onClick={startMetadataEdit}>Edit Metadata</button>
            )}
            {currentUser && !paper.viewer_has_entry && (
              <button onClick={handleAddToNook}>Add to my nook</button>
            )}
            {hasEntry && (
              <button className="danger-link remove-paper" onClick={handleDelete}>
                Remove from my nook
              </button>
            )}
          </div>
        </div>
      )}

      {/* Everything below the separator is private to the reader:
          summary and notes. Above it, everything is public. */}
      {hasEntry && (
        <div className="paper-notes">
          <div className="summary-block">
            <h4>
              Summary
              <span className="visibility-badge private">private</span>
              {!editingSummary && paper.summary && (
                <button
                  className="link-btn summary-edit"
                  onClick={() => {
                    setSummaryDraft(paper.summary || '');
                    setEditingSummary(true);
                  }}
                >
                  edit
                </button>
              )}
            </h4>
            {editingSummary ? (
              <div className="inline-edit">
                <textarea
                  className="inline-edit-box"
                  value={summaryDraft}
                  rows={4}
                  autoFocus
                  placeholder="A summary of the paper, visible only to you"
                  onChange={(e) => setSummaryDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setEditingSummary(false);
                  }}
                />
                <div className="inline-edit-actions">
                  <button className="primary" onClick={saveSummary}>
                    Save
                  </button>
                  <button onClick={() => setEditingSummary(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : paper.summary ? (
              <div className="summary-text">{paper.summary}</div>
            ) : (
              <button
                className="link-btn"
                onClick={() => {
                  setSummaryDraft('');
                  setEditingSummary(true);
                }}
              >
                Add a summary
              </button>
            )}
          </div>

          <CommentSection
            paperId={paper.id}
            comments={paper.comments}
            currentUser={currentUser}
            onCommentChange={loadPaper}
          />
        </div>
      )}
      </div>

      <div className="discussion-card">
        <RoomSection paper={paper} currentUser={currentUser} onChanged={loadPaper} />
      </div>
    </div>
  );
}
