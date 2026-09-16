import React, { useEffect, useState, useRef } from 'react';
import {
  createPaper, createTag, discardPaperImport, extractPaperMetadata, listShelves, listTags,
  lookupPaperMetadata,
} from '../../../shared/api/papers.js';
import { RatingInput } from './Rating';
import BackLink from '../../../shared/ui/BackLink.jsx';
import { nativeDataActive } from '../../../shared/nativeData.js';
import { isPdfFile } from '../../../shared/fileDrop.js';
import appLimits from '../../../shared/appLimits.js';

function editableAuthors(authors) {
  if (!authors) return '';
  try {
    const parsed = JSON.parse(authors);
    return Array.isArray(parsed) ? parsed.join(', ') : String(authors);
  } catch {
    return String(authors);
  }
}

export default function PaperUpload({
  onPaperCreated, onReviewChange = () => {}, compact = false,
  incomingFile = null, onIncomingFileHandled = () => {},
}) {
  const localImport = nativeDataActive();
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isParsingMetadata, setIsParsingMetadata] = useState(false);
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
  const metadataRequest = useRef(0);
  const extractedDataRef = useRef(null);

  extractedDataRef.current = extractedData;
  useEffect(() => () => {
    metadataRequest.current += 1;
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
    if (file) {
      handleFile(file);
    }
  };

  const handleFile = async (file) => {
    const requestId = metadataRequest.current + 1;
    metadataRequest.current = requestId;
    setIsLoading(true);
    setIsParsingMetadata(false);
    setError(null);

    try {
      const data = await extractPaperMetadata(file);
      setExtractedData(data);
      onReviewChange(true);
      const [tags, shelfData] = await Promise.all([listTags(), listShelves()]);
      setShelves(shelfData);
      const initialForm = {
        title: data.title || '',
        authors: editableAuthors(data.authors),
        journal: data.journal || '',
        year: data.year || '',
        doi: data.doi || '',
        thought: '',
        summary: '',
        shelf_uuid: (nativeDataActive()
          ? shelfData.find((shelf) => !shelf.is_public)
          : shelfData.find((shelf) => shelf.is_default))?.uuid || shelfData[0]?.uuid || '',
        is_author: false,
        rating_expertise: null,
        rating_reading: null,
        rating_liking: null,
      };
      setFormData(initialForm);
      setSelectedTags([]);
      setTagDraft('');
      setAvailableTags(tags);
      if (localImport) {
        setIsParsingMetadata(true);
        void lookupPaperMetadata(file).then((remote) => {
          if (metadataRequest.current !== requestId) return;
          if (!remote) {
            setExtractedData((current) => current ? { ...current, metadata_offline: true } : current);
            return;
          }
          const enriched = {
            title: remote.title || initialForm.title,
            authors: remote.authors ? editableAuthors(remote.authors) : initialForm.authors,
            journal: remote.journal || initialForm.journal,
            year: remote.year || initialForm.year,
            doi: remote.doi || initialForm.doi,
          };
          // Do not replace a field the user has already changed while the
          // backend was parsing the PDF.
          setFormData((current) => Object.fromEntries(Object.entries(current).map(([key, value]) => [
            key,
            Object.hasOwn(enriched, key) && value === initialForm[key] ? enriched[key] : value,
          ])));
          setExtractedData((current) => current ? {
            ...current,
            doi: remote.doi || null,
            title: remote.title || current.title,
            authors: remote.authors || null,
            journal: remote.journal || null,
            year: remote.year || null,
            metadata_offline: false,
          } : current);
        }).catch(() => {
          if (metadataRequest.current === requestId) {
            setExtractedData((current) => current ? { ...current, metadata_offline: true } : current);
          }
        }).finally(() => {
          if (metadataRequest.current === requestId) setIsParsingMetadata(false);
        });
      }
    } catch (err) {
      setError(err.message);
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
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleRatingChange = (key, value) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
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
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = async () => {
    metadataRequest.current += 1;
    setIsParsingMetadata(false);
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
      <BackLink className={`back-btn upload-review-back${isLoading ? ' disabled' : ''}`} href={`${window.location.pathname}${window.location.search}`} onBack={isLoading ? undefined : handleCancel} aria-disabled={isLoading} />
      <div className="panel paper-form">
        <div className="paper-metadata-heading">
          <h3>Review Paper Metadata</h3>
          {isParsingMetadata && (
            <span className="metadata-parsing" role="status">
              <span className="metadata-spinner" aria-hidden="true" />
              Looking up metadata…
            </span>
          )}
        </div>
        {extractedData.metadata_offline && (
          <div className="offline-notice" role="status">
            Metadata could not be looked up. You can still review and save the paper.
          </div>
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
                title="Annotations your chip on this paper as an author"
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
            <div className="upload-shelf-select">
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
                        try { selectTag(await createTag(tagDraft.trim())); } catch (err) { setError(err.message); }
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
          <p>Extracting metadata...</p>
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
