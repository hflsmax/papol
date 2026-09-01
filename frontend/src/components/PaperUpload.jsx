import React, { useState, useRef } from 'react';
import { extractPaperMetadata, createPaper, listTags, createTag, listShelves } from '../api';
import { RatingInput } from './Rating';
import BackLink from './BackLink';

export default function PaperUpload({ onPaperCreated, onReviewChange = () => {}, compact = false }) {
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [extractedData, setExtractedData] = useState(null);
  const [formData, setFormData] = useState({});
  const [availableTags, setAvailableTags] = useState([]);
  const [shelves, setShelves] = useState([]);
  const [selectedTags, setSelectedTags] = useState([]);
  const [tagDraft, setTagDraft] = useState('');
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const fileInputRef = useRef(null);

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
    if (file && file.type === 'application/pdf') {
      handleFile(file);
    } else {
      setError('Drop a PDF file');
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      handleFile(file);
    }
  };

  const handleFile = async (file) => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await extractPaperMetadata(file);
      setExtractedData(data);
      onReviewChange(true);
      const [tags, shelfData] = await Promise.all([listTags(), listShelves()]);
      setShelves(shelfData);
      setFormData({
        title: data.title || '',
        authors: data.authors ? JSON.parse(data.authors).join(', ') : '',
        journal: data.journal || '',
        year: data.year || '',
        doi: data.doi || '',
        thought: '',
        summary: '',
        shelf_id: shelfData.find((shelf) => shelf.is_default)?.id || shelfData[0]?.id || '',
        is_author: false,
        rating_expertise: null,
        rating_reading: null,
        rating_liking: null,
      });
      setSelectedTags([]);
      setTagDraft('');
      setAvailableTags(tags);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

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

      await createPaper({
        title: formData.title,
        authors: JSON.stringify(authorsList),
        journal: formData.journal || null,
        year: formData.year ? parseInt(formData.year) : null,
        doi: formData.doi || null,
        thought: formData.thought || null,
        summary: formData.summary || null,
        file_path: extractedData.file_path,
        shelf_id: Number(formData.shelf_id),
        is_author: !!formData.is_author,
        rating_expertise: formData.rating_expertise,
        rating_reading: formData.rating_reading,
        rating_liking: formData.rating_liking,
        tag_ids: selectedTags.map((tag) => tag.id),
      });

      setExtractedData(null);
      setFormData({});
      setSelectedTags([]);
      onReviewChange(false);
      onPaperCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    setExtractedData(null);
    setFormData({});
    setSelectedTags([]);
    setTagDraft('');
    setError(null);
    onReviewChange(false);
  };

  if (extractedData) {
    const selectedIds = new Set(selectedTags.map((tag) => tag.id));
    const query = tagDraft.trim().toLowerCase();
    const suggestions = availableTags.filter(
      (tag) => !selectedIds.has(tag.id) && (!query || tag.name.toLowerCase().includes(query))
    );
    const exactTagExists = availableTags.some((tag) => tag.name.toLowerCase() === query);
    const selectTag = (tag) => {
      setSelectedTags((current) => current.some((item) => item.id === tag.id) ? current : [...current, tag]);
      setAvailableTags((current) => current.some((item) => item.id === tag.id) ? current : [...current, tag]);
      setTagDraft('');
      setTagMenuOpen(false);
    };

    return (
      <>
      <BackLink className={`back-btn upload-review-back${isLoading ? ' disabled' : ''}`} href={`${window.location.pathname}${window.location.search}`} onBack={isLoading ? undefined : handleCancel} aria-disabled={isLoading} />
      <div className="panel paper-form">
        <h3>Review Paper Metadata</h3>
        {error && <div className="error">{error}</div>}
        <form className="upload-review-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Title *</label>
            <input
              type="text"
              name="title"
              value={formData.title}
              onChange={handleInputChange}
              required
            />
          </div>

          <div className="form-group">
            <div className="field-label-row">
              <label>Authors (comma-separated)</label>
              <label
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
              </label>
            </div>
            <input
              type="text"
              name="authors"
              value={formData.authors}
              onChange={handleInputChange}
              placeholder="John Doe, Jane Smith"
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Journal</label>
              <input
                type="text"
                name="journal"
                value={formData.journal}
                onChange={handleInputChange}
              />
            </div>

            <div className="form-group">
              <label>Year</label>
              <input
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
            <label>DOI</label>
            <input
              type="text"
              name="doi"
              value={formData.doi}
              onChange={handleInputChange}
              placeholder="10.1234/example"
            />
          </div>

          <div className="form-group upload-private-field upload-shelf-field">
            <label>Shelf</label>
            <div className="upload-shelf-select">
              <select name="shelf_id" value={formData.shelf_id} onChange={handleInputChange}>
                {shelves.map((shelf) => (
                  <option key={shelf.id} value={shelf.id}>{shelf.name} · {shelf.is_public ? 'Public' : 'Private'}</option>
                ))}
              </select>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9 5 5 5-5" /></svg>
            </div>
          </div>

          <div className="form-group upload-private-field">
            <label>Private Tags</label>
            <div className="tag-editor-card upload-tag-editor">
              <div className="tag-picker">
                <div className="tag-editor">
                  {selectedTags.map((tag) => (
                    <button type="button" className="tag-chip selected" key={tag.id} onClick={() => setSelectedTags((current) => current.filter((item) => item.id !== tag.id))}>
                      {tag.name} ×
                    </button>
                  ))}
                  <input
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
                      <button type="button" key={tag.id} onMouseDown={(e) => e.preventDefault()} onClick={() => selectTag(tag)}>
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
            <label>Private summary</label>
            <div className="upload-private-card">
              <textarea
                name="summary"
                value={formData.summary}
                onChange={handleInputChange}
                rows={4}
                placeholder="Your private summary of this paper"
              />
            </div>
          </div>

          <div className="form-group upload-public-field upload-public-thought">
            <label>One-sentence thought</label>
            <div className="upload-public-card">
              <input
                type="text"
                name="thought"
                value={formData.thought}
                onChange={handleInputChange}
                maxLength={200}
                placeholder="Your public one-line take on this paper"
              />
            </div>
          </div>

          <div className="form-group upload-public-field">
            <label>Public ratings</label>
            <div className="upload-public-card">
              <RatingInput values={formData} onChange={handleRatingChange} />
            </div>
          </div>

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
      {error && <div className="error">{error}</div>}
    </div>
  );
}
