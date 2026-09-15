import React, { useState, useEffect, useRef } from 'react';
import {
  getPaper, updatePaper, deletePaper, addPaperEdition, adoptEdition, ignoreEdition, createTag, listTags, listShelves,
  addToNook, pdfFileName, pdfHref, reextractPaperMetadata,
} from '../../../shared/api/papers.js';
import {
  createSharable, revokeSharable, sharableHref,
} from '../../../shared/api/sharables.js';
import { nativeBlobUrl, nativeDataActive } from '../../../shared/nativeData.js';
import CommentSection from './CommentSection';
import RoomSection from './RoomSection';
import HintPop from './HintPop';
import Avatar from './Avatar';
import { RatingInput, RatingSummary } from './Rating';
import Markdown, { MarkdownHint } from './Markdown';
import appLimits from '../../../shared/appLimits.js';
import AutoTextarea from './AutoTextarea';
import { demoActive } from '../../../shared/demo.js';
import { appPath } from '../base';
import BackLink from '../../../shared/ui/BackLink.jsx';
import { confirmAction } from '../../../shared/confirmAction';
import { contextMenuHandler } from '../../../shared/contextMenu';

export default function PaperDetail({
  paperUuid, currentUser, onBack, backHref, onSelectPaper, onChanged, onRead,
  hideBack = false, onReportableError,
}) {
  const [paper, setPaper] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [editMode, setEditMode] = useState(null); // null | 'metadata' | 'summary'
  const [tagDraft, setTagDraft] = useState('');
  const [availableTags, setAvailableTags] = useState([]);
  const [shelves, setShelves] = useState([]);
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const [editData, setEditData] = useState({});
  const [error, setError] = useState(null);
  const [isAddingEdition, setIsAddingEdition] = useState(false);
  const [isAddingToNook, setIsAddingToNook] = useState(false);
  const [isExtractingMetadata, setIsExtractingMetadata] = useState(false);
  const [pendingPdf, setPendingPdf] = useState(null);
  const [toggleWarning, setToggleWarning] = useState(null);
  // Set when Read is pressed on a paper the reader has not taken yet. Up
  // here with the rest: there are early returns below, and a hook after
  // one of those is a hook that sometimes does not run.
  const [readHint, setReadHint] = useState(false);
  const [editingThought, setEditingThought] = useState(false);
  const [thoughtDraft, setThoughtDraft] = useState('');
  const [editingSummary, setEditingSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState('');
  // Which link was last copied, and how it went. One state for both links
  // in the share menu, so a "Copied!" never appears on the wrong one.
  const [shareCopied, setShareCopied] = useState({ target: null, status: 'idle' });
  const [shareOpen, setShareOpen] = useState(false);
  const [isSharingReading, setIsSharingReading] = useState(false);
  const [readMenuOpen, setReadMenuOpen] = useState(false);
  const pdfInputRef = useRef(null);
  const readControlRef = useRef(null);
  const shareControlRef = useRef(null);
  const shareUrlRef = useRef(null);
  const readingUrlRef = useRef(null);

  useEffect(() => {
    if (!readMenuOpen) return undefined;
    const dismiss = (event) => {
      if (!readControlRef.current?.contains(event.target)) setReadMenuOpen(false);
    };
    const dismissWithKey = (event) => {
      if (event.key === 'Escape') setReadMenuOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    window.addEventListener('keydown', dismissWithKey);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('keydown', dismissWithKey);
    };
  }, [readMenuOpen]);

  useEffect(() => {
    if (!shareOpen) return undefined;
    const dismiss = (event) => {
      if (!shareControlRef.current?.contains(event.target)) setShareOpen(false);
    };
    const dismissWithKey = (event) => {
      if (event.key === 'Escape') setShareOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    window.addEventListener('keydown', dismissWithKey);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('keydown', dismissWithKey);
    };
  }, [shareOpen]);

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
      await adoptEdition(paper.uuid, paper.latest_edition.uuid);
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
      await ignoreEdition(paper.uuid, paper.latest_edition.uuid);
      loadPaper();
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    loadPaper();
  }, [paperUuid]);

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
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('pageshow', onShow);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [paperUuid, editMode, editingSummary, editingThought]);

  // Every load after the first follows a change made here, so whatever lists
  // this paper beside the page (Papol Desktop's nook) is told to catch up.
  const loadedOnce = useRef(false);
  const loadPaper = async () => {
    setError(null);
    try {
      const data = await getPaper(paperUuid);
      setPaper(data);
      setIsLoading(false);
      if (currentUser && data.viewer_has_entry) {
        listShelves().then(setShelves).catch((err) => setError(err.message));
      }
      if (loadedOnce.current) onChanged?.();
      loadedOnce.current = true;
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const editionHash = (editionUuid = paper?.edition_uuid) =>
    paper?.editions?.find((edition) => edition.uuid === editionUuid)?.sha256 || null;

  const viewerHref = () => {
    if (demoActive()) return appPath(`/demo/viewer/?pdf=${paper.sha256 || editionHash()}`);
    const hash = editionHash();
    return hash ? appPath(`/viewer/?pdf=${hash}`) : null;
  };

  const noteHref = (comment) => {
    if (demoActive()) return appPath(`/demo/viewer/?pdf=${paper.sha256 || editionHash()}&note=${comment.uuid}`);
    const hash = editionHash(comment.edition_uuid || paper?.edition_uuid);
    return hash ? appPath(`/viewer/?pdf=${hash}&note=${comment.uuid}`) : null;
  };

  // A newer edition exists and this reader's copy is not on it. Only ever
  // an offer: nothing moves a reader's copy but the reader.
  const newEdition =
    paper &&
    paper.viewer_has_entry &&
    paper.latest_edition &&
    paper.latest_edition.uuid !== paper.edition_uuid &&
    paper.latest_edition.uuid !== paper.ignored_edition_uuid
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
      await updatePaper(paper.uuid, { [key]: value });
      loadPaper();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleShelfChange = async (shelfUuid) => {
    setError(null);
    setToggleWarning(null);
    try {
      await updatePaper(paper.uuid, { shelf_uuid: shelfUuid });
      loadPaper();
    } catch (err) {
      setToggleWarning(err.message);
    }
  };

  const handleAddToNook = async () => {
    setError(null);
    setIsAddingToNook(true);
    try {
      const added = await addToNook(paper);
      setPaper(added);
      // Swap the address to the canonical form without pushing a history
      // entry — it is the same page, and Back should leave it, not repeat it.
      const modePrefix = demoActive() ? '/demo' : '';
      window.history.replaceState(
        window.history.state,
        '',
        appPath(`${modePrefix}/paper/${added.uuid}`),
      );
      // Reload rather than stop at the returned copy: a paper just taken into
      // the nook needs the reader's shelves for its shelf menu.
      loadPaper();
    } catch (err) {
      setError(err?.message || String(err));
      if (err?.reportable !== false) {
        onReportableError?.(err, 'adding a Library paper to My Nook');
      }
    } finally {
      setIsAddingToNook(false);
    }
  };

  const copyLink = async (link, target, field) => {
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
        copied = true;
      }
    } catch {
      // Permissions policies and older browsers may block the async API;
      // selecting the visible URL gives them the established copy path.
    }
    if (!copied && field.current) {
      field.current.focus();
      field.current.select();
      field.current.setSelectionRange(0, link.length);
      try {
        copied = document.execCommand('copy');
      } catch {
        copied = false;
      }
    }
    setShareCopied({ target, status: copied ? 'copied' : 'failed' });
    window.setTimeout(() => setShareCopied({ target: null, status: 'idle' }), 1800);
  };

  const copyLabel = (target) => {
    if (shareCopied.target !== target) return 'Copy';
    return shareCopied.status === 'copied' ? 'Copied!' : 'Copy failed';
  };

  const paperUrl = () => `${window.location.origin}${appPath(`/paper/${paper.uuid}`)}`;

  // A sharable hands this reading — this PDF, with this reader's notes, ink
  // and clips on it — to anyone holding the link. Nothing is copied: what a
  // visitor sees is what the reader has now, until the link is taken back.
  const handleShareReading = async () => {
    setError(null);
    setIsSharingReading(true);
    try {
      const sharable = await createSharable(paper.uuid);
      setPaper((current) => ({ ...current, sharable_uuid: sharable.uuid }));
      copyLink(sharableHref(sharable.uuid), 'reading', readingUrlRef);
    } catch (err) {
      setError(err?.message || String(err));
      if (err?.reportable !== false) {
        onReportableError?.(err, 'sharing a reading of a paper');
      }
    } finally {
      setIsSharingReading(false);
    }
  };

  const handleStopSharingReading = async () => {
    if (!(await confirmAction(
      'Stop sharing your reading? The link you gave out stops working.',
      { confirmLabel: 'Stop sharing', destructive: true },
    ))) return;
    setError(null);
    try {
      await revokeSharable(paper.sharable_uuid);
      setPaper((current) => ({ ...current, sharable_uuid: null }));
    } catch (err) {
      setError(err?.message || String(err));
      if (err?.reportable !== false) {
        onReportableError?.(err, 'stopping the sharing of a reading');
      }
    }
  };

  const handleDelete = async () => {
    if (!(await confirmAction('Remove this paper from your nook? Your ratings and notes will be deleted. This cannot be undone.', { confirmLabel: 'Remove', destructive: true }))) return;
    try {
      await deletePaper(paper.uuid);
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

      await updatePaper(paper.uuid, {
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
        await addPaperEdition(paper.uuid, pendingPdf);
        setPendingPdf(null);
      }

      setEditMode(null);
      window.location.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsAddingEdition(false);
    }
  };

  const handleMetadataExtract = async () => {
    setError(null);
    setIsExtractingMetadata(true);
    try {
      const extracted = await reextractPaperMetadata(paper.uuid);
      setEditData((current) => ({
        ...current,
        ...(extracted.title != null && { title: extracted.title }),
        ...(extracted.authors != null && {
          authors: parseAuthors(extracted.authors).join(', '),
        }),
        ...(extracted.journal != null && { journal: extracted.journal }),
        ...(extracted.year != null && { year: extracted.year }),
        ...(extracted.doi != null && { doi: extracted.doi }),
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setIsExtractingMetadata(false);
    }
  };

  const saveSummary = async () => {
    setError(null);
    try {
      await updatePaper(paper.uuid, { summary: summaryDraft.trim() || null });
      setEditingSummary(false);
      loadPaper();
    } catch (err) {
      setError(err.message);
    }
  };

  const saveThought = async () => {
    setError(null);
    try {
      await updatePaper(paper.uuid, { thought: thoughtDraft.trim() || null });
      setEditingThought(false);
      loadPaper();
    } catch (err) {
      setError(err.message);
    }
  };

  if (isLoading) {
    return <div className="loading" role="status" aria-live="polite">Loading paper…</div>;
  }

  if (error && !paper) {
    return (
      <div className="panel paper-detail">
        <div className="error" role="alert">{error}</div>
        {!hideBack && <BackLink href={backHref} onBack={onBack}>Back</BackLink>}
      </div>
    );
  }

  if (!paper) {
    return <div>Paper not found</div>;
  }

  const authors = parseAuthors(paper.authors);
  const hasEntry = currentUser != null && paper.viewer_has_entry;
  const assignedTagUuids = new Set((paper.tags || []).map((tag) => tag.uuid));
  const tagQuery = tagDraft.trim().toLowerCase();
  const tagSuggestions = availableTags.filter(
    (tag) => !assignedTagUuids.has(tag.uuid) && (!tagQuery || tag.name.toLowerCase().includes(tagQuery))
  );
  const tagExists = availableTags.some((tag) => tag.name.toLowerCase() === tagQuery);
  const attachTag = async (tag) => {
    await updatePaper(paper.uuid, {
      tag_uuids: [...assignedTagUuids, tag.uuid],
    });
    setTagDraft('');
    setTagMenuOpen(false);
    setAvailableTags((current) => current.some((item) => item.uuid === tag.uuid) ? current : [...current, tag]);
    loadPaper();
  };
  const openViewer = () => {
    const href = viewerHref();
    if (!href) return;
    if (onRead) onRead(href);
    else window.location.assign(href);
  };
  // Papol Desktop keeps the reader's PDF in its local store. Save that copy,
  // which needs no network and exists before the paper syncs, and read it
  // only when asked, since a PDF can be large.
  const localPdf = nativeDataActive() && hasEntry && Boolean(paper.edition_sha256);
  const saveLocalPdf = async () => {
    try {
      const href = await nativeBlobUrl(paper.edition_sha256, 'application/pdf');
      const link = document.createElement('a');
      link.href = href;
      link.download = pdfFileName(paper);
      link.click();
      setTimeout(() => URL.revokeObjectURL(href), 60_000);
    } catch (err) {
      const message = err?.message || String(err);
      if (/blob is not available offline|pdf is not available in the local replica/i.test(message)) {
        setError('This PDF has not finished downloading to this Mac. Connect to the internet and choose Sync, then try again.');
      } else {
        setError(`PDF download failed: ${message}`);
        onReportableError?.(err, 'downloading a PDF from My Nook');
      }
    }
  };
  const paperContextMenu = contextMenuHandler(() => [
    hasEntry && viewerHref() && { label: 'Read', onSelect: openViewer },
    paper.file_path && { label: 'Download PDF', onSelect: () => {
      if (localPdf) {
        saveLocalPdf();
        return;
      }
      const link = document.createElement('a');
      link.href = pdfHref(paper);
      link.download = pdfFileName(paper);
      link.click();
    } },
    hasEntry && { label: 'Edit Paper…', onSelect: startMetadataEdit },
    currentUser && !demoActive() && { separator: true },
    currentUser && !demoActive() && { label: 'Share…', onSelect: () => setShareOpen(true) },
    hasEntry && { separator: true },
    hasEntry && { label: 'Remove from My Nook…', onSelect: handleDelete },
  ]);

  return (
    <div className="paper-detail">
      {!hideBack && (
        <BackLink className="back-btn" href={backHref} onBack={onBack} />
      )}

      {error && <div className="error" role="alert">{error}</div>}

      <div className="panel">
      {editMode === 'metadata' ? (
        <div className="paper-form">
          <div className="warning">
            These paper details are shared. Changes you make here update them
            for every reader.
          </div>

          <div className="form-actions metadata-extract-action">
            <button
              type="button"
              onClick={handleMetadataExtract}
              disabled={isExtractingMetadata}
            >
              {isExtractingMetadata ? (
                <><span className="metadata-spinner" aria-hidden="true" /> Extracting…</>
              ) : 'Extract metadata from PDF'}
            </button>
          </div>

          <div className="form-group">
            <label htmlFor="paper-metadata-title">Title</label>
            <input
              id="paper-metadata-title"
              type="text"
              name="title"
              value={editData.title}
              onChange={handleEditChange}
            />
          </div>

          <div className="form-group">
            <label htmlFor="paper-metadata-authors">Authors (comma-separated)</label>
            <input
              id="paper-metadata-authors"
              type="text"
              name="authors"
              value={editData.authors}
              onChange={handleEditChange}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="paper-metadata-journal">Journal</label>
              <input
                id="paper-metadata-journal"
                type="text"
                name="journal"
                value={editData.journal}
                onChange={handleEditChange}
              />
            </div>

            <div className="form-group">
              <label htmlFor="paper-metadata-year">Year</label>
              <input
                id="paper-metadata-year"
                type="number"
                name="year"
                value={editData.year}
                onChange={handleEditChange}
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="paper-metadata-doi">DOI</label>
            <input
              id="paper-metadata-doi"
              type="text"
              name="doi"
              value={editData.doi}
              onChange={handleEditChange}
            />
          </div>

          {hasEntry && (
            <div className="form-group">
              <div className="form-label">PDF</div>
              <div className="pdf-row">
                <a
                  className="btn"
                  href={pdfHref(paper)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(event) => {
                    if (!localPdf) return;
                    event.preventDefault();
                    openViewer();
                  }}
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
          <div className="detail-title-row" onContextMenu={paperContextMenu}>
            <h2>{paper.title}</h2>
            {hasEntry && (
              <div className="detail-toggle">
                <span className="hint-anchor paper-shelf-picker">
                  <label htmlFor="paper-shelf">Shelf:</label>
                  <select id="paper-shelf" value={paper.shelf_uuid || ''} onChange={(e) => handleShelfChange(shelves.find((shelf) => String(shelf.uuid) === e.target.value)?.uuid)}>
                    {shelves.map((shelf) => (
                      <option key={shelf.uuid} value={shelf.uuid}>{shelf.name} · {shelf.is_public ? 'Public' : 'Private'}</option>
                    ))}
                  </select>
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

          <div className="paper-actions" onContextMenu={paperContextMenu}>
            {hasEntry && viewerHref() && (
              <a
                className="btn primary"
                href={viewerHref()}
                data-document
                onClick={(event) => {
                  if (!onRead || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                  event.preventDefault();
                  openViewer();
                }}
              >
                Read
              </a>
            )}
            {!currentUser && (
              <div className="share-control" ref={readControlRef}>
                <button
                  type="button"
                  className="primary"
                  aria-expanded={readMenuOpen}
                  aria-haspopup="menu"
                  onClick={() => setReadMenuOpen((open) => !open)}
                >
                  Read <span aria-hidden="true">▾</span>
                </button>
                {readMenuOpen && (
                  <div className="share-menu read-menu" role="menu">
                    <a
                      role="menuitem"
                      href={pdfHref(paper)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <strong>Read PDF directly</strong>
                      <span>Open the original PDF in your browser.</span>
                    </a>
                    <a
                      role="menuitem"
                      href={appPath(`/signin?next=${encodeURIComponent(`/paper/${paper.uuid}`)}`)}
                      title="Sign in to use the built-in viewer"
                    >
                      <strong>Use built-in viewer</strong>
                      <span>Sign in required — continue to sign in.</span>
                    </a>
                  </div>
                )}
              </div>
            )}
            {/* Reading is offered before the paper is taken, because it is
                what a reader came here to do. Pressing it says what has to
                happen first — and only that. The reason a paper is read
                from your own copy is not what someone wants at the moment
                they are told they cannot read it yet. */}
            {currentUser && !paper.viewer_has_entry && (
              <span className="hint-anchor">
                <button onClick={() => setReadHint(true)}>Read</button>
                {readHint && (
                  <HintPop
                    text="Add this paper to your nook first."
                    onClose={() => setReadHint(false)}
                  />
                )}
              </span>
            )}
            {/* Leaves with a copy of the PDF, saved under the paper's title
                (Papol Desktop puts it in Downloads). A copy hosted elsewhere
                cannot be named from here, so it opens in a new tab instead
                of taking the reader away from Papol. */}
            {paper.file_path && (
              <a
                className="btn"
                href={pdfHref(paper)}
                download={pdfFileName(paper)}
                onClick={(event) => {
                  if (!localPdf) return;
                  event.preventDefault();
                  saveLocalPdf();
                }}
                {...(pdfHref(paper).startsWith('http')
                  ? { target: '_blank', rel: 'noopener noreferrer' }
                  : {})}
              >
                Download
              </a>
            )}
            {hasEntry && (
              <button onClick={startMetadataEdit}>Edit</button>
            )}
            {currentUser && !paper.viewer_has_entry && (
              /* The actual next step, so it carries the weight. */
              <button className="primary" onClick={handleAddToNook} disabled={isAddingToNook}>
                {isAddingToNook ? 'Downloading PDF…' : 'Add to my nook'}
              </button>
            )}
            {currentUser && !demoActive() && (
              <div className="share-control" ref={shareControlRef}>
                <button
                  type="button"
                  aria-expanded={shareOpen}
                  aria-haspopup="menu"
                  onClick={() => setShareOpen((open) => !open)}
                >
                  Share <span aria-hidden="true">▾</span>
                </button>
                {shareOpen && (
                  <div className="share-menu canonical-share-menu" role="menu">
                    <label htmlFor="canonical-share-url">Paper URL</label>
                    <div className="share-link-row">
                      <input
                        id="canonical-share-url"
                        ref={shareUrlRef}
                        value={paperUrl()}
                        readOnly
                        onFocus={(event) => event.target.select()}
                      />
                      <button
                        type="button"
                        onClick={() => copyLink(paperUrl(), 'paper', shareUrlRef)}
                      >
                        {copyLabel('paper')}
                      </button>
                    </div>
                    {/* The paper URL leads to the paper. This one leads to
                        the reader's own reading of it, which is a different
                        thing to hand someone. */}
                    {hasEntry && (
                      <div className="share-reading">
                        <label htmlFor="reading-share-url">Your reading</label>
                        {paper.sharable_uuid ? (
                          <>
                            <div className="share-link-row">
                              <input
                                id="reading-share-url"
                                ref={readingUrlRef}
                                value={sharableHref(paper.sharable_uuid)}
                                readOnly
                                onFocus={(event) => event.target.select()}
                              />
                              <button
                                type="button"
                                onClick={() => copyLink(
                                  sharableHref(paper.sharable_uuid), 'reading', readingUrlRef,
                                )}
                              >
                                {copyLabel('reading')}
                              </button>
                            </div>
                            <p className="share-note">
                              Anyone with this link can read your PDF with your notes,
                              paint and clips on it. They cannot change anything, and
                              what they see keeps up with what you write.
                            </p>
                            <button
                              type="button"
                              className="link share-revoke"
                              onClick={handleStopSharingReading}
                            >
                              Stop sharing
                            </button>
                          </>
                        ) : (
                          <>
                            <p className="share-note">
                              A read-only link to your PDF with your notes, paint and
                              clips on it.
                            </p>
                            <button
                              type="button"
                              onClick={handleShareReading}
                              disabled={isSharingReading}
                            >
                              {isSharingReading ? 'Making a link…' : 'Create a link'}
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {!currentUser && (paper.also_read_by || []).length > 0 && (
            <p className="signed-out-reviews">
              <a href={appPath('/signin')}>Sign in</a> to see others’ reviews of the paper.
            </p>
          )}

          {currentUser && (paper.also_read_by || []).length > 0 && (
            <div className="nooks-row">
              <span className="nooks-label">
                In {paper.also_read_by.length}{' '}
                {paper.also_read_by.length === 1 ? 'nook' : 'nooks'}:
              </span>
              <div className="title-chips">
                {paper.also_read_by.map((entry) => (
                  <a
                    key={entry.user.uuid}
                    className={
                      entry.is_author
                        ? 'avatar-chip has-pop mini author'
                        : 'avatar-chip has-pop mini'
                    }
                    href={appPath(`/u/${entry.user.uuid}`)}
                  >
                    <Avatar user={entry.user} className="mini-avatar" />
                    <span className="chip-pop">
                      <span className="chip-pop-name">
                        {entry.user.display_name}
                        {currentUser && entry.user.uuid === currentUser.uuid
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
                    maxLength={appLimits.text.paper_thought}
                    rows={2}
                    autoFocus
                    placeholder="Your public one-line take on this paper"
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

          <section className="paper-tags private-tags-group" aria-labelledby="paper-tags-title">
            <h4 id="paper-tags-title">
              Tags
              <span className="visibility-badge private">private</span>
            </h4>
            <div className="tag-editor-card">
              <div className="tag-picker">
                <div className="tag-editor">
                  {(paper.tags || []).map((tag) => (
                    <button
                      type="button"
                      className="tag-chip selected"
                      key={tag.uuid}
                      onClick={async () => {
                        await updatePaper(paper.uuid, { tag_uuids: paper.tags.filter((t) => t.uuid !== tag.uuid).map((t) => t.uuid) });
                        loadPaper();
                      }}
                      title="Remove tag from this paper"
                    >{tag.name} ×</button>
                  ))}
                  <input
                    className="tag-input"
                    value={tagDraft}
                    placeholder="Add a private tag…"
                    aria-label="Add a private tag"
                    onFocus={() => { setTagMenuOpen(true); listTags().then(setAvailableTags).catch((err) => setError(err.message)); }}
                    onBlur={() => setTagMenuOpen(false)}
                    onChange={(e) => { setTagDraft(e.target.value); setTagMenuOpen(true); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setTagMenuOpen(false);
                      if (e.key === 'Enter' && tagSuggestions.length === 1) {
                        e.preventDefault();
                        attachTag(tagSuggestions[0]).catch((err) => setError(err.message));
                      }
                    }}
                  />
                </div>
                {tagMenuOpen && (
                  <div className="tag-dropdown">
                    {tagSuggestions.length > 0 && <div className="tag-dropdown-label">Your tags</div>}
                    {tagSuggestions.map((tag) => (
                      <button type="button" key={tag.uuid} onMouseDown={(e) => e.preventDefault()} onClick={() => attachTag(tag).catch((err) => setError(err.message))}>
                        <span className="tag-option-mark">#</span>
                        <span>{tag.name}</span>
                        <span className="tag-option-hint">Add</span>
                      </button>
                    ))}
                    {tagQuery && !tagExists && (
                      <button type="button" className="tag-create-option" onMouseDown={(e) => e.preventDefault()} onClick={async () => {
                        try { await attachTag(await createTag(tagDraft.trim())); } catch (err) { setError(err.message); }
                      }}>
                        <span className="tag-create-mark">+</span>
                        <span>Create <strong>{tagDraft.trim()}</strong></span>
                      </button>
                    )}
                    {!tagQuery && tagSuggestions.length === 0 && <span className="tag-empty">All of your tags are already on this paper.</span>}
                  </div>
                )}
              </div>
            </div>
          </section>

          <CommentSection
            paperUuid={paper.uuid}
            comments={(paper.comments || []).filter((c) => c.content)}
            noteHref={noteHref}
            onOpenNote={onRead}
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
