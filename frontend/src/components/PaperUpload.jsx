import React, { useEffect, useState, useRef } from 'react';
import { Progress, Working } from '../../../shared/ui/Waiting.js';
import { holdFullBar } from '../../../shared/waiting.js';
import { uploadProgressView } from '../../../shared/api/files.js';
import {
  awaitPaperReading, createPaper, discardPaperImport, listShelves, listTags, uploadPaper,
} from '../../../shared/api/papers.js';
import { RatingInput } from './Rating';
import TagPicker from './TagPicker';
import { nativeDataActive } from '../../../shared/nativeData.js';
import { isPdfFile } from '../../../shared/fileDrop.js';
import appLimits from '../../../shared/appLimits.js';
import { isReportableUploadError } from '../../../shared/uploadError.js';
import { readIdentifier } from '../pdfIdentifier.js';
import { droppedFolder, severalPdfs } from '../agentFolder.js';
import { READ_FIELDS, fillUnedited, knownVersionLine, reviewFields, savedFile, titleFromFilename } from '../uploadReview';

// The upload is a bar in the drop zone (docs/waiting.md), over the hash
// and the bytes going up. The form opens the moment the upload has
// answered, on the title the filename gives, and the reading of the PDF
// goes on beside it: the spinner while it is read, the fields it read
// filled in when it is done, a quiet line when it could not be. The user
// types and saves without waiting for any of it; a save or a cancel
// while the reading is still on simply stops listening for it.
export default function PaperUpload({
  onPaperCreated, onReviewChange = () => {}, compact = false,
  incomingFile = null, onIncomingFileHandled = () => {}, onReportableError, onAddFolder = null,
}) {
  const localImport = nativeDataActive();
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  // The upload as storeFile reports it, while a file is going up.
  const [uploadProgress, setUploadProgress] = useState(null);
  // 'reading' while the PDF is read, 'unread' when it could not be, null otherwise.
  const [reading, setReading] = useState(null);
  const [error, setError] = useState(null);
  const [extractedData, setExtractedData] = useState(null);
  // The version Papol already holds of this work, when the reading found
  // one, and whether the save takes it (the default) or keeps this PDF.
  const [known, setKnown] = useState(null);
  const [useKnown, setUseKnown] = useState(true);
  const [formData, setFormData] = useState({});
  const [availableTags, setAvailableTags] = useState([]);
  const [shelves, setShelves] = useState([]);
  const [selectedTags, setSelectedTags] = useState([]);
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

  // A folder, or several PDFs, go to the batch's review (FolderImport)
  // where there is one to go to; where there is not, a folder is left to
  // the window (App.jsx), which opens one.
  const handleDrop = (e) => {
    setIsDragging(false);
    const folder = droppedFolder(e.dataTransfer);
    if (folder && !onAddFolder) return;
    e.preventDefault();
    if (folder) {
      onAddFolder({ entry: folder });
      return;
    }
    const several = severalPdfs(e.dataTransfer.files);
    if (several.length && onAddFolder) {
      onAddFolder({ files: several });
      return;
    }
    const file = e.dataTransfer.files[0];
    if (e.dataTransfer.files.length > 1) {
      setError('Import one PDF at a time.');
    } else if (isPdfFile(file)) {
      handleFile(file);
    } else {
      setError('Papol’s library only supports PDF files.');
    }
  };

  const handleFileSelect = (e) => {
    const chosen = Array.from(e.target.files || []);
    const file = chosen[0];
    // Let the same file be selected again after a failed import.
    e.target.value = '';
    const several = severalPdfs(chosen);
    if (several.length && onAddFolder) {
      onAddFolder({ files: several });
    } else if (file) {
      handleFile(file);
    }
  };

  const handleFile = async (file) => {
    stopReading();
    setReading(null);
    setKnown(null);
    setUseKnown(true);
    setIsLoading(true);
    setUploadProgress(null);
    setError(null);

    try {
      // The PDF's first pages are read for its DOI or arXiv id here, while
      // the bytes go up; the server starts its reading from what was found.
      const identifier = readIdentifier(file);
      // The bar is held full for a moment before the form takes its place.
      let fullAt = null;
      const onProgress = (progress) => {
        if (fullAt == null && progress.phase === 'stored') fullAt = Date.now();
        setUploadProgress(progress);
      };
      const [uploaded, tags, shelfData] = await Promise.all([uploadPaper(file, { identifier, onProgress }), listTags(), listShelves()]);
      if (fullAt != null) await holdFullBar(fullAt);
      setExtractedData(uploaded);
      onReviewChange(true);
      setShelves(shelfData);
      setFormData({
        ...reviewFields({ title: titleFromFilename(file.name) }),
        thought: '',
        summary: '',
        shelf_uuid: shelfData.find((shelf) => shelf.is_default)?.uuid || shelfData[0]?.uuid || '',
        is_author: false,
        rating_expertise: null,
        rating_reading: null,
        rating_liking: null,
      });
      editedFields.current = new Set();
      setSelectedTags([]);
      setAvailableTags(tags);

      // Kept but not sent (the desktop only): there is no reading to wait
      // for, and why is said as it is. A send that failed is a fault, not
      // a PDF that could not be read, and is offered for a report.
      if (uploaded.offline || uploaded.sendFailure) {
        const failure = uploaded.sendFailure;
        setReading(uploaded.offline ? 'offline' : { unsent: failure.message || String(failure) });
        if (failure && isReportableUploadError(failure)) onReportableError?.(failure, 'sending a PDF to be read');
        return;
      }
      const settle = (read) => {
        if (read) setFormData((current) => fillUnedited(current, editedFields.current, read));
        setKnown(read?.existing?.sha256 ? read.existing : null);
        setReading(read ? null : 'unread');
      };
      // The indexes knew the paper while it went up: the form opens filled.
      if (uploaded.reading) {
        settle(uploaded.reading);
        return;
      }
      const wait = new AbortController();
      readingWait.current = wait;
      setReading('reading');
      void awaitPaperReading(uploaded, { signal: wait.signal }).then((read) => {
        // Saved, cancelled, or replaced by another file: nobody is listening.
        if (wait.signal.aborted) return;
        readingWait.current = null;
        settle(read);
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
        ...savedFile(extractedData, known, useKnown),
        shelf_uuid: shelves.find((shelf) => String(shelf.uuid) === String(formData.shelf_uuid))?.uuid,
        is_author: !!formData.is_author,
        rating_expertise: formData.rating_expertise,
        rating_reading: formData.rating_reading,
        rating_liking: formData.rating_liking,
        tag_uuids: selectedTags.map((tag) => tag.uuid),
      });

      // The known version was taken over a PDF the nook had stored: that
      // one has nothing standing behind it now.
      if (known && useKnown) await discardPaperImport(extractedData).catch(() => {});
      setExtractedData(null);
      setKnown(null);
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
    setKnown(null);
    setFormData({});
    setSelectedTags([]);
    setError(null);
    onReviewChange(false);
  };

  if (extractedData) {
    return (
      <>
      <div className="panel paper-form">
        <div className="paper-metadata-heading">
          <h3>Paper Metadata</h3>
        </div>
        {reading === 'reading' && (
          <div className="metadata-reading">
            <Working label="Extracting…" />
          </div>
        )}
        {reading === 'unread' && (
          <p className="metadata-reading" role="status">
            Papol could not read the PDF; fill in the details.
          </p>
        )}
        {reading === 'offline' && (
          <p className="metadata-reading" role="status">
            Offline, so the PDF was not read; fill in the details.
          </p>
        )}
        {reading?.unsent && (
          <p className="metadata-reading" role="status">
            Papol could not send the PDF to be read ({reading.unsent}); fill in the details.
          </p>
        )}
        {known && (
          <div className="metadata-reading known-version" role="status">
            <span>{knownVersionLine({ existing: known })}</span>
            <label className="checkbox-row inline">
              <input type="radio" name="known_version" checked={useKnown} onChange={() => setUseKnown(true)} />
              <span>Use that version</span>
            </label>
            <label className="checkbox-row inline">
              <input type="radio" name="known_version" checked={!useKnown} onChange={() => setUseKnown(false)} />
              <span>Keep this version</span>
            </label>
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
            <TagPicker
              id="upload-paper-tags"
              available={availableTags}
              onAvailableChange={setAvailableTags}
              selected={selectedTags}
              onSelectedChange={setSelectedTags}
              onError={(err) => showError(err, 'creating a tag for an imported PDF')}
            />
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
          multiple={Boolean(onAddFolder)}
          style={{ display: 'none' }}
        />
        {isLoading ? (
          <UploadWait progress={uploadProgress} />
        ) : (
          <>
            <p>
              {onAddFolder ? 'Drop PDFs or a folder here, or click to upload' : 'Drop a PDF here or click to upload'}
              {onAddFolder && <>
                {' '}
                <span className="add-folder">
                  ·{' '}
                  <button
                    type="button"
                    className="link-button add-folder-link"
                    onClick={(event) => { event.stopPropagation(); onAddFolder(null); }}
                  >
                    Add a folder
                  </button>
                </span>
              </>}
            </p>
            {!compact && <p className="hint">DOI will be extracted automatically</p>}
          </>
        )}
      </div>
      {error && <div className="error" role="alert">{error}</div>}
    </div>
  );
}

// The upload's wait, in the drop zone: one bar over the hash and the
// bytes going up, as storeFile reports them; the spinner before the first
// report, and on the desktop, whose store says nothing.
function UploadWait({ progress }) {
  const view = uploadProgressView(progress);
  if (!view) return <Working label="Uploading…" />;
  return <Progress fraction={view.fraction} label="Uploading" detail={view.detail} />;
}
