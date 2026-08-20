import React, { useState, useRef } from 'react';
import { extractPaperMetadata, createPaper } from '../api';
import { RatingInput } from './Rating';

export default function PaperUpload({ onPaperCreated }) {
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [extractedData, setExtractedData] = useState(null);
  const [formData, setFormData] = useState({});
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
      setError('Please drop a PDF file');
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
      setFormData({
        title: data.title || '',
        authors: data.authors ? JSON.parse(data.authors).join(', ') : '',
        journal: data.journal || '',
        year: data.year || '',
        doi: data.doi || '',
        thought: '',
        marketed: true,
        is_author: false,
        rating_expertise: null,
        rating_reading: null,
        rating_liking: null,
      });
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
        file_path: extractedData.file_path,
        marketed: formData.marketed,
        is_author: !!formData.is_author,
        rating_expertise: formData.rating_expertise,
        rating_reading: formData.rating_reading,
        rating_liking: formData.rating_liking,
      });

      setExtractedData(null);
      setFormData({});
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
    setError(null);
  };

  if (extractedData) {
    return (
      <div className="panel paper-form">
        <h3>Review Paper Metadata</h3>
        {error && <div className="error">{error}</div>}
        <form onSubmit={handleSubmit}>
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

          <div className="form-group">
            <label>One-sentence thought (public, optional)</label>
            <input
              type="text"
              name="thought"
              value={formData.thought}
              onChange={handleInputChange}
              maxLength={200}
              placeholder="Your one-line take on this paper"
            />
          </div>

          <div className="form-group">
            <label>My ratings</label>
            <RatingInput values={formData} onChange={handleRatingChange} />
          </div>

          <div className="form-group">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={formData.marketed}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, marketed: e.target.checked }))
                }
              />
              Display in my nook
            </label>
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
    );
  }

  return (
    <div className="upload-section">
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
            <p className="hint">DOI will be extracted automatically</p>
          </>
        )}
      </div>
      {error && <div className="error">{error}</div>}
    </div>
  );
}
