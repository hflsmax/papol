import React, { useState, useEffect, useRef } from 'react';
import {
  getPaper, updatePaper, deletePaper, addPaperEdition, adoptEdition, ignoreEdition,
  addToNook, pdfHref,
} from '../api';
import CommentSection from './CommentSection';
import RoomSection from './RoomSection';
import HintPop from './HintPop';
import Avatar from './Avatar';
import { RatingInput, RatingSummary } from './Rating';
import Markdown, { MarkdownHint } from './Markdown';
import AutoTextarea from './AutoTextarea';

export default function PaperDetail({ paperId, currentUser, onBack, onSelectPaper }) {
  const [paper, setPaper] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [editMode, setEditMode] = useState(null); // null | 'metadata' | 'summary'
  const [editData, setEditData] = useState({});
  const [error, setError] = useState(null);
  const [isAddingEdition, setIsAddingEdition] = useState(false);
  const [pendingPdf, setPendingPdf] = useState(null);
  const [toggleWarning, setToggleWarning] = useState(null);
  const [editingThought, setEditingThought] = useState(false);
  const [thoughtDraft, setThoughtDraft] = useState('');
  const [editingSummary, setEditingSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState('');
  const pdfInputRef = useRef(null);

  const handlePdfPick = (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setPendingPdf(file);
  };

  // Adopting is the reader's own call: their located notes were placed on
  // the PDF they have, and on a different file they may not line up.
  const handleAdoptEdition = async () => {
    setError(null);
    try {
      await adoptEdition(paper.id, paper.latest_edition.id);
      loadPaper();
    } catch (err) {
      setError(err.message);
    }
  };

  // Waving the offer away is not a decision about the PDF: the reader keeps
  // what they have, and a later edition asks again.
  const handleIgnoreEdition = async () => {
    setError(null);
    try {
      await ignoreEdition(paper.id, paper.latest_edition.id);
      loadPaper();
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    loadPaper();
  }, [paperId]);

  // Coming back from the viewer is a history step, so the browser restores
  // this page from its cache with whatever notes it had when the reader
  // left. Refetch when the page is shown again, unless a form is open and
  // would lose what is in it.
  useEffect(() => {
    const refresh = () => {
      if (editMode || editingSummary || editingThought) return;
      loadPaper();
    };
    const onShow = (e) => {
      if (e.persisted) refresh();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('pageshow', onShow);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('pageshow', onShow);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [paperId, editMode, editingSummary, editingThought]);

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

  const noteHref = (comment) =>
    `viewer/?paper=${comment.paper_id}&note=${comment.id}`;

  // A newer edition exists and this reader's copy is not on it. Only ever
  // an offer: nothing moves a reader's copy but the reader.
  const newEdition =
    paper &&
    paper.viewer_has_entry &&
    paper.latest_edition &&
    paper.latest_edition.id !== paper.edition_id &&
    paper.latest_edition.id !== paper.ignored_edition_id
      ? paper.latest_edition
      : null;

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

      // The picked PDF rides along with the save, so nothing about the
      // paper changes until the reader commits the form.
      if (pendingPdf) {
        setIsAddingEdition(true);
        await addPaperEdition(paper.id, pendingPdf);
        setPendingPdf(null);
      }

      setEditMode(null);
      loadPaper();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsAddingEdition(false);
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
            Metadata is shared. Your changes apply to this paper for every
            reader.
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
              <div className="pdf-row">
                <a
                  className="btn"
                  href={pdfHref(paper)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View PDF
                </a>
                <button
                  type="button"
                  className="danger"
                  onClick={() => pdfInputRef.current?.click()}
                  disabled={isAddingEdition}
                  title="Picks the PDF your copy will read, applied when you save. Other readers keep theirs until they choose to update."
                >
                  {isAddingEdition ? 'Uploading…' : 'Replace PDF'}
                </button>
                {pendingPdf && (
                  <span className="pdf-pending">{pendingPdf.name}</span>
                )}
                <input
                  type="file"
                  accept=".pdf"
                  ref={pdfInputRef}
                  style={{ display: 'none' }}
                  onChange={handlePdfPick}
                />
              </div>
            </div>
          )}

          <div className="form-actions">
            <button
              onClick={() => {
                setPendingPdf(null);
                setEditMode(null);
              }}
            >
              Cancel
            </button>
            <button className="primary" onClick={handleMetadataSave}>
              Save Metadata
            </button>
          </div>
        </div>
      ) : (
        <div className="paper-info">
          {newEdition && (
            <div className="edition-notice">
              <span className="edition-notice-icon" aria-hidden="true">i</span>
              <div>
                <p className="edition-notice-head">
                  A newer PDF is uploaded by another user.
                </p>
                <p className="edition-notice-warn">
                  Your notes sit on your current PDF and may not line up on the new one.
                </p>
                <div className="edition-notice-actions">
                  <button className="link-btn" onClick={handleAdoptEdition}>
                    Update my nook
                  </button>
                  <button className="link-btn" onClick={handleIgnoreEdition}>
                    Ignore
                  </button>
                </div>
              </div>
            </div>
          )}
          <div className="detail-title-row">
            <h2>{paper.title}</h2>
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
                      ? 'On display — other readers can see that you have this paper.'
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
                <button
                  className="icon-btn danger-icon"
                  onClick={handleDelete}
                  title="Remove this paper from my nook — my ratings and notes go with it"
                  aria-label="Remove from my nook"
                >
                  <svg
                    width="19"
                    height="19"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M2.6 4h10.8" />
                    <path d="M6.2 4V2.7h3.6V4" />
                    <path d="M4.1 4l.5 9.1a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9L11.9 4" />
                    <path d="M6.7 6.6v5.2M9.3 6.6v5.2" />
                  </svg>
                </button>
              </div>
            )}
          </div>

          {authors.length > 0 && (
            <div className="detail-authors-row">
              <p className="authors">{authors.join(', ')}</p>
              {/* Sits level with the names it refers to, however many lines
                  they run to — as the display controls do with the title. */}
              {hasEntry && (
                <label
                  className="checkbox-row inline"
                  title="Marks your chip on this paper as an author"
                >
                  <input
                    type="checkbox"
                    checked={paper.is_author === true}
                    onChange={(e) =>
                      handleInlineRating('is_author', e.target.checked)
                    }
                  />
                  <span>I am an author</span>
                </label>
              )}
            </div>
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

          <div className="paper-actions">
            {hasEntry && (
              <a className="btn primary" href={`viewer/?paper=${paper.id}`}>
                Read
              </a>
            )}
            {hasEntry && (
              <button onClick={startMetadataEdit}>Edit</button>
            )}
            {currentUser && !paper.viewer_has_entry && (
              <button onClick={handleAddToNook}>Add to my nook</button>
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
                    className={
                      entry.is_author
                        ? 'avatar-chip has-pop mini author'
                        : 'avatar-chip has-pop mini'
                    }
                    href={`#/u/${entry.user.id}`}
                  >
                    <Avatar user={entry.user} className="mini-avatar" />
                    <span className="chip-pop">
                      <span className="chip-pop-name">
                        {entry.user.display_name}
                        {currentUser && entry.user.id === currentUser.id
                          ? ' (you)'
                          : ''}
                        {entry.is_author && (
                          <span className="author-tag">author</span>
                        )}
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
                My ratings
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
                  <AutoTextarea
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

        </div>
      )}

      {/* Everything below the separator is private to the reader:
          summary and notes. Above it, everything is public. */}
      {hasEntry && editMode !== 'metadata' && (
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
                <AutoTextarea
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
                <MarkdownHint />
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
              <div className="summary-text">
                <Markdown text={paper.summary} />
              </div>
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
            comments={(paper.comments || []).filter((c) => c.content)}
            noteHref={noteHref}
            currentUser={currentUser}
            onCommentChange={loadPaper}
          />

        </div>
      )}
      </div>

      {editMode !== 'metadata' && (
        <div className="discussion-card">
          <RoomSection paper={paper} currentUser={currentUser} onChanged={loadPaper} />
        </div>
      )}
    </div>
  );
}
