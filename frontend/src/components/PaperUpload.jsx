import React, { useEffect, useState, useRef } from 'react';
import {
  awaitPaperReading, createPaper, createTag, discardPaperImport, listShelves, listTags,
  uploadPaper,
} from '../../../shared/api/papers.js';
import { RatingInput } from './Rating';
import BackLink from '../../../shared/ui/BackLink.jsx';
import { nativeDataActive } from '../../../shared/nativeData.js';
import { isPdfFile } from '../../../shared/fileDrop.js';
import appLimits from '../../../shared/appLimits.js';
import { isReportableUploadError } from '../../../shared/uploadError.js';
import { readIdentifier } from '../pdfIdentifier.js';
import { READ_FIELDS, fillUnedited, reviewFields, titleFromFilename } from '../uploadReview';

// The form opens the moment the upload has answered, on the title the
// filename gives, and the reading of the PDF goes on beside it: a
// spinner while it is read, the fields it read filled in when it is
// done, a quiet line when it could not be. The user types and saves
// without waiting for any of it; a save or a cancel while the reading is
// still on simply stops listening for it.
export default function PaperUpload({
  onPaperCreated, onReviewChange = () => {}, compact = false,
  incomingFile = null, onIncomingFileHandled = () => {}, onReportableError,
}) {
  const localImport = nativeDataActive();
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  // 'reading' while the PDF is read, 'unread' when it could not be, null otherwise.
  const [reading, setReading] = useState(null);
  const [error, setError] = useState(null);
  const [extractedData, setExtractedData] = useState(null);
  const [formData, setFormData] = useState({});
  const [availableTags, setAvailableTags] = useState([]);
  const [shelves, setShelves] = useState([]);
  const [selectedTags, setSelectedTags] = useState([]);
  const [tagDraft, setTagDraft] = useState('');
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const fileInputRef = useRef(null);
  const handledIncomingFile = useRef(null);
  // The fields the user has typed in since the form opened: the reading
  // leaves those alone.
  const editedFields = useRef(new Set());
  // Ends the wait for the reading, not the reading.
  const readingWait = useRef(null);
  const extractedDataRef = useRef(null);

  const showError = (failure, area) => {
    setError(failure?.message || String(failure));
    if (isReportableUploadError(failure)) onReportableError?.(failure, area);
  };

  const stopReading = () => {
    readingWait.current?.abort();
    readingWait.current = null;
  };

  extractedDataRef.current = extractedData;
  useEffect(() => () => {
    stopReading();
    if (extractedDataRef.current) discardPaperImport(extractedDataRef.current).catch(() => {});
  }, []);

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (isPdfFile(file)) {
      handleFile(file);
    } else {
      setError('Papol’s library only supports PDF files.');
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    // Let the same file be selected again after a failed import.
    e.target.value = '';
    if (file) {
      handleFile(file);
    }
  };

  const handleFile = async (file) => {
    stopReading();
    setReading(null);
    setIsLoading(true);
    setError(null);

    try {
      // The PDF's first pages are read for its DOI or arXiv id here, while
      // the bytes go up; the server starts its reading from what was found.
      const identifier = readIdentifier(file);
      const [uploaded, tags, shelfData] = await Promise.all([uploadPaper(file, { identifier }), listTags(), listShelves()]);
      setExtractedData(uploaded);
      onReviewChange(true);
      setShelves(shelfData);
      setFormData({
        ...reviewFields({ title: titleFromFilename(file.name) }),
        thought: '',
        summary: '',
        shelf_uuid: (localImport
          ? shelfData.find((shelf) => !shelf.is_public)
          : shelfData.find((shelf) => shelf.is_default))?.uuid || shelfData[0]?.uuid || '',
        is_author: false,
        rating_expertise: null,
        rating_reading: null,
        rating_liking: null,
      });
      editedFields.current = new Set();
      setSelectedTags([]);
      setTagDraft('');
      setAvailableTags(tags);

      const wait = new AbortController();
      readingWait.current = wait;
      setReading('reading');
      void awaitPaperReading(uploaded, file, { signal: wait.signal, identifier }).then((read) => {
        // Saved, cancelled, or replaced by another file: nobody is listening.
        if (wait.signal.aborted) return;
        readingWait.current = null;
        if (read) setFormData((current) => fillUnedited(current, editedFields.current, read));
        setReading(read ? null : 'unread');
      });
    } catch (err) {
      showError(err, 'importing a PDF');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!incomingFile || handledIncomingFile.current === incomingFile.uuid) return;
    handledIncomingFile.current = incomingFile.uuid;
    onIncomingFileHandled();
    if (isPdfFile(incomingFile.file)) handleFile(incomingFile.file);
    else setError('Papol’s library only supports PDF files.');
  }, [incomingFile]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    if (READ_FIELDS.includes(name)) editedFields.current.add(name);
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleRatingChange = (key, value) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Saved as it stands: a reading still on its way is dropped, and the
    // paper page can ask for it again.
    stopReading();
    setReading(null);
    setIsLoading(true);
    setError(null);

    try {
      const authorsList = formData.authors
        .split(',')
        .map((a) => a.trim())
        .filter((a) => a);

      const paper = await createPaper({
        title: formData.title,
        authors: JSON.stringify(authorsList),
        journal: formData.journal || null,
        year: formData.year ? parseInt(formData.year) : null,
        doi: formData.doi || null,
        thought: formData.thought || null,
        summary: formData.summary || null,
        file_path: extractedData.file_path,
        shelf_uuid: shelves.find((shelf) => String(shelf.uuid) === String(formData.shelf_uuid))?.uuid,
        is_author: !!formData.is_author,
        rating_expertise: formData.rating_expertise,
        rating_reading: formData.rating_reading,
        rating_liking: formData.rating_liking,
        tag_uuids: selectedTags.map((tag) => tag.uuid),
      });

      setExtractedData(null);
      setFormData({});
      setSelectedTags([]);
      onReviewChange(false);
      onPaperCreated(paper);
    } catch (err) {
      showError(err, 'saving an imported PDF');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = async () => {
    stopReading();
    setReading(null);
    await discardPaperImport(extractedData).catch(() => {});
    setExtractedData(null);
    setFormData({});
    setSelectedTags([]);
    setTagDraft('');
    setError(null);
    onReviewChange(false);
  };

  if (extractedData) {
    const selectedUuids = new Set(selectedTags.map((tag) => tag.uuid));
    const query = tagDraft.trim().toLowerCase();
    const suggestions = availableTags.filter(
      (tag) => !selectedUuids.has(tag.uuid) && (!query || tag.name.toLowerCase().includes(query))
    );
    const exactTagExists = availableTags.some((tag) => tag.name.toLowerCase() === query);
    const selectTag = (tag) => {
      setSelectedTags((current) => current.some((item) => item.uuid === tag.uuid) ? current : [...current, tag]);
      setAvailableTags((current) => current.some((item) => item.uuid === tag.uuid) ? current : [...current, tag]);
      setTagDraft('');
      setTagMenuOpen(false);
    };

    return (
      <>
      <BackLink className={`back-button upload-review-back${isLoading ? ' disabled' : ''}`} href={`${window.location.pathname}${window.location.search}`} onBack={isLoading ? undefined : handleCancel} aria-disabled={isLoading} />
      <div className="panel paper-form">
        <div className="paper-metadata-heading">
          <h3>Review Paper Metadata</h3>
        </div>
        {reading === 'reading' && (
          <p className="metadata-reading" role="status">
            <span className="spinner metadata-spinner" aria-hidden="true" />
            Reading the PDF for its title and authors…
          </p>
        )}
        {reading === 'unread' && (
          <p className="metadata-reading" role="status">
            Papol could not read the PDF; fill in the details.
          </p>
        )}
        {error && <div className="error" role="alert">{error}</div>}
        <form className="upload-review-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="upload-paper-title">Title <span aria-hidden="true">*</span></label>
            <input
              id="upload-paper-title"
              type="text"
              name="title"
              value={formData.title}
              onChange={handleInputChange}
              required
            />
          </div>

          <div className="form-group">
            <div className="field-label-row">
              <label htmlFor="upload-paper-authors">Authors (comma-separated)</label>
              {!localImport && <label
                className="checkbox-row inline"
                title="Marks your chip on this paper as an author"
              >
                <input
                  type="checkbox"
                  checked={!!formData.is_author}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, is_author: e.target.checked }))
                  }
                />
                <span>I am an author</span>
              </label>}
            </div>
            <input
              id="upload-paper-authors"
              type="text"
              name="authors"
              value={formData.authors}
              onChange={handleInputChange}
              placeholder="John Doe, Jane Smith"
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="upload-paper-journal">Journal</label>
              <input
                id="upload-paper-journal"
                type="text"
                name="journal"
                value={formData.journal}
                onChange={handleInputChange}
              />
            </div>

            <div className="form-group">
              <label htmlFor="upload-paper-year">Year</label>
              <input
                id="upload-paper-year"
                type="number"
                name="year"
                value={formData.year}
                onChange={handleInputChange}
                min="1900"
                max="2100"
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="upload-paper-doi">DOI</label>
            <input
              id="upload-paper-doi"
              type="text"
              name="doi"
              value={formData.doi}
              onChange={handleInputChange}
              placeholder="10.1234/example"
            />
          </div>

          <div className="form-group upload-private-field upload-shelf-field">
            <label htmlFor="upload-paper-shelf">Shelf</label>
            <div className="shelf-select upload-shelf-select">
              <select id="upload-paper-shelf" name="shelf_uuid" value={formData.shelf_uuid} onChange={handleInputChange}>
                {shelves.map((shelf) => (
                  <option key={shelf.uuid} value={shelf.uuid}>{shelf.name} · {shelf.is_public ? 'Public' : 'Private'}</option>
                ))}
              </select>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9 5 5 5-5" /></svg>
            </div>
          </div>

          <div className="form-group upload-private-field">
            <label htmlFor="upload-paper-tags">Private tags</label>
            <div className="tag-editor-card upload-tag-editor">
              <div className="tag-picker">
                <div className="tag-editor">
                  {selectedTags.map((tag) => (
                    <button type="button" className="tag-chip selected" key={tag.uuid} onClick={() => setSelectedTags((current) => current.filter((item) => item.uuid !== tag.uuid))}>
                      {tag.name} ×
                    </button>
                  ))}
                  <input
                    id="upload-paper-tags"
                    className="tag-input"
                    value={tagDraft}
                    placeholder="Add a private tag…"
                    onFocus={() => setTagMenuOpen(true)}
                    onBlur={() => setTagMenuOpen(false)}
                    onChange={(e) => { setTagDraft(e.target.value); setTagMenuOpen(true); }}
                  />
                </div>
                {tagMenuOpen && (
                  <div className="tag-dropdown">
                    {suggestions.length > 0 && <div className="tag-dropdown-label">Your tags</div>}
                    {suggestions.map((tag) => (
                      <button type="button" key={tag.uuid} onMouseDown={(e) => e.preventDefault()} onClick={() => selectTag(tag)}>
                        <span className="tag-option-mark">#</span><span>{tag.name}</span><span className="tag-option-hint">Add</span>
                      </button>
                    ))}
                    {query && !exactTagExists && (
                      <button type="button" className="tag-create-option" onMouseDown={(e) => e.preventDefault()} onClick={async () => {
                        try { selectTag(await createTag(tagDraft.trim())); } catch (err) { showError(err, 'creating a tag for an imported PDF'); }
                      }}>
                        <span className="tag-create-mark">+</span><span>Create <strong>{tagDraft.trim()}</strong></span>
                      </button>
                    )}
                    {!query && suggestions.length === 0 && <span className="tag-empty">All of your tags are selected.</span>}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="form-group upload-private-field upload-private-summary">
            <label htmlFor="upload-paper-summary">Private summary</label>
            <div className="upload-private-card">
              <textarea
                id="upload-paper-summary"
                name="summary"
                value={formData.summary}
                onChange={handleInputChange}
                rows={4}
                placeholder="Your private summary of this paper"
              />
            </div>
          </div>

          {!localImport && <div className="form-group upload-public-field upload-public-thought">
            <label htmlFor="upload-paper-thought">One-sentence thought</label>
            <div className="upload-public-card">
              <input
                id="upload-paper-thought"
                type="text"
                name="thought"
                value={formData.thought}
                onChange={handleInputChange}
                maxLength={appLimits.text.paper_thought}
                placeholder="Your public one-line take on this paper"
              />
            </div>
          </div>}

          {!localImport && <div className="form-group upload-public-field">
            <div className="form-label">Public ratings</div>
            <div className="upload-public-card">
              <RatingInput values={formData} onChange={handleRatingChange} />
            </div>
          </div>}

          <div className="form-actions">
            <button type="button" onClick={handleCancel} disabled={isLoading}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={isLoading}>
              {isLoading ? 'Saving...' : 'Save Paper'}
            </button>
          </div>
        </form>
      </div>
      </>
    );
  }

  return (
    <div className={`upload-section${compact ? ' compact' : ''}`}>
      <div
        className={`dropzone ${isDragging ? 'dragging' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          accept=".pdf"
          style={{ display: 'none' }}
        />
        {isLoading ? (
          <p>Uploading…</p>
        ) : (
          <>
            <p>Drop a PDF here or click to upload</p>
            {!compact && <p className="hint">DOI will be extracted automatically</p>}
          </>
        )}
      </div>
      {error && <div className="error" role="alert">{error}</div>}
    </div>
  );
}
