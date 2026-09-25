import React, { useEffect, useRef, useState } from 'react';
import { Working } from '../../../shared/ui/Waiting.js';
import { sha256Hex } from '../../../shared/api/files.js';
import { getNook } from '../../../shared/api/people.js';
import {
  awaitPaperReading, createPaper, createShelf, discardPaperImport, listPapers, listShelves, listTags,
  uploadPaper,
} from '../../../shared/api/papers.js';
import appLimits from '../../../shared/appLimits.js';
import { isReportableUploadError } from '../../../shared/uploadError.js';
import { isPdfFile } from '../../../shared/fileDrop.js';
import { readIdentifier } from '../pdfIdentifier.js';
import { savedFile } from '../uploadReview.js';
import {
  MANIFEST_NAME, agentInstructions, droppedFolder, filesFromPicker, filesInFolder, folderRows, looseFiles,
  identifierFor, importSummary, parseManifest, rowAddable, rowMetadata, rowStatus,
  rowTitle,
} from '../agentFolder.js';
import TagPicker from './TagPicker';

// A folder of papers an agent gathered (USER_STORIES.md §2c, the format
// in agentFolder.js). Three steps in one panel: how it works and the
// instructions to hand the agent; the folder's review, where the user
// picks the shelf and the tags and leaves out what they do not want; and
// what was added.
//
// Each PDF goes up as the one-paper upload sends it, as soon as the
// folder is read, so the review fills in while the user looks at it.
// Nothing is saved until Add: a PDF sent and then left out is let go of,
// as the one-paper form lets go of a cancelled upload.

// Two PDFs go up at once: a review is tens of papers, and each is also
// read for its identifier in this window.
const UPLOADS_AT_ONCE = 2;
const NEW_SHELF = 'new';
const SHELF_COLORS = ['#b3923d', '#6b3f5e', '#35606b'];

export default function FolderImport({ currentUser, incomingFolder = null, onIncomingFolderHandled = () => {}, onClose, onAdded, onReportableError }) {
  const [folder, setFolder] = useState(null); // { name, manifestError }
  const [rows, setRows] = useState([]);
  const [opening, setOpening] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);
  const [shelves, setShelves] = useState([]);
  const [shelfUuid, setShelfUuid] = useState('');
  const [newShelfName, setNewShelfName] = useState('');
  const [availableTags, setAvailableTags] = useState([]);
  const [selectedTags, setSelectedTags] = useState([]);
  const [dragging, setDragging] = useState(false);
  const rowsRef = useRef(rows);
  const stop = useRef(new AbortController());
  const pickerRef = useRef(null);
  const handledIncoming = useRef(null);
  rowsRef.current = rows;

  const update = (key, patch) => setRows((current) => current.map((row) => (
    row.key === key ? { ...row, ...(typeof patch === 'function' ? patch(row) : patch) } : row
  )));

  const showError = (failure, area) => {
    setError(failure?.message || String(failure));
    if (isReportableUploadError(failure)) onReportableError?.(failure, area);
  };

  // Every PDF that went up and was not saved is let go of when the panel
  // goes, however it goes.
  useEffect(() => () => {
    stop.current.abort();
    for (const row of rowsRef.current) {
      if (row.uploaded && row.state !== 'added') discardPaperImport(row.uploaded).catch(() => {});
    }
  }, []);

  // One PDF: hashed, skipped when the nook has it, sent otherwise, and
  // read for its details while the review is open.
  const send = async (row, { nookShas, library }) => {
    const { signal } = stop.current;
    update(row.key, { state: 'uploading' });
    try {
      const sha256 = await sha256Hex(row.file);
      if (signal.aborted) return;
      if (nookShas.has(sha256)) {
        update(row.key, { state: 'yours', include: false, sha256 });
        return;
      }
      const held = library.get(sha256) || null;
      const identifier = held ? null : identifierFor(readIdentifier(row.file), row.entry);
      const name = row.path.split('/').pop();
      const uploaded = await uploadPaper(row.file, { name, identifier });
      if (signal.aborted) {
        discardPaperImport(uploaded).catch(() => {});
        return;
      }
      if (held || uploaded.offline || uploaded.sendFailure) {
        update(row.key, { state: 'ready', uploaded, sha256, library: held });
        return;
      }
      update(row.key, { state: 'reading', uploaded, sha256 });
      const read = await awaitPaperReading(uploaded, { signal });
      if (signal.aborted) return;
      const known = read?.existing?.sha256 && read.existing.sha256 !== sha256 ? read.existing : null;
      update(row.key, (current) => (current.state === 'reading'
        ? { state: 'ready', reading: read, known, useKnown: true }
        : { reading: read }));
    } catch (failure) {
      if (signal.aborted) return;
      update(row.key, { state: 'failed', include: false, error: failure?.message || String(failure) });
      if (isReportableUploadError(failure)) onReportableError?.(failure, 'sending a PDF from a folder');
    }
  };

  const open = async (read) => {
    setOpening(true);
    setError(null);
    try {
      const { name, files } = await read;
      const manifestFile = files.find(({ path }) => path.toLowerCase() === MANIFEST_NAME);
      const manifest = manifestFile ? parseManifest(await manifestFile.file.text()) : null;
      const [shelfList, tags, nook, papers] = await Promise.all([
        listShelves(), listTags(), getNook(currentUser.uuid),
        // Offline, nothing is known to be held: every PDF is read as new.
        listPapers().catch(() => []),
      ]);
      const planned = folderRows(files, manifest?.papers ? manifest : null)
        .map((row) => ({ ...row, state: row.problem ? null : 'waiting', include: !row.problem }));
      if (!planned.length) {
        setError(name ? `There are no PDFs in “${name}”.` : 'There are no PDFs among these files.');
        return;
      }
      setShelves(shelfList);
      setShelfUuid(shelfList.find((shelf) => shelf.is_default)?.uuid || shelfList[0]?.uuid || '');
      setNewShelfName(name.slice(0, appLimits.text.shelf_name));
      setAvailableTags(tags);
      setSelectedTags([]);
      setFolder({ name, manifestError: manifest?.error || null, manifest: Boolean(manifest?.papers) });
      setRows(planned);

      const context = {
        nookShas: new Set((nook?.papers || []).map((paper) => paper.sha256)),
        library: new Map(papers.map((paper) => [paper.sha256, paper])),
      };
      const queue = planned.filter((row) => !row.problem);
      const next = async () => {
        while (queue.length && !stop.current.signal.aborted) await send(queue.shift(), context);
      };
      void Promise.all(Array.from({ length: UPLOADS_AT_ONCE }, next));
    } catch (failure) {
      showError(failure, 'opening a folder of papers');
    } finally {
      setOpening(false);
    }
  };

  useEffect(() => {
    if (!incomingFolder || handledIncoming.current === incomingFolder.uuid) return;
    handledIncoming.current = incomingFolder.uuid;
    onIncomingFolderHandled();
    if (folder) return;
    void open(incomingFolder.entry
      ? filesInFolder(incomingFolder.entry)
      : Promise.resolve(looseFiles(incomingFolder.files)));
  }, [incomingFolder]);

  const add = async () => {
    setSaving(true);
    setError(null);
    try {
      let shelf = shelfUuid;
      if (shelf === NEW_SHELF) {
        const name = newShelfName.trim();
        if (!name) throw new Error('Name the new shelf.');
        const created = await createShelf({ name, color: SHELF_COLORS[shelves.length % SHELF_COLORS.length], is_public: false });
        setShelves((current) => [...current, created]);
        setShelfUuid(created.uuid);
        shelf = created.uuid;
      }
      // Readings still out are not waited for: the PDF is saved with what
      // is known, as the one-paper form saves, and its jacket can ask again.
      // Each row as it stands when its turn comes: a reading may have come
      // in while the ones before it were saved.
      for (const key of rowsRef.current.map((row) => row.key)) {
        const row = rowsRef.current.find((item) => item.key === key);
        if (!row.include || !rowAddable(row)) continue;
        update(row.key, { state: 'saving' });
        try {
          const useKnown = Boolean(row.known && row.useKnown);
          await createPaper({
            ...rowMetadata(row),
            ...savedFile(row.uploaded, row.known, useKnown),
            shelf_uuid: shelf,
            tag_uuids: selectedTags.map((tag) => tag.uuid),
            initial_comment: row.entry?.note || null,
          });
          if (useKnown) await discardPaperImport(row.uploaded).catch(() => {});
          update(row.key, { state: 'added' });
        } catch (failure) {
          const message = failure?.message || String(failure);
          update(row.key, /already in your nook/i.test(message)
            ? { state: 'yours' }
            : { state: 'failed', error: message });
          if (isReportableUploadError(failure)) onReportableError?.(failure, 'saving a PDF from a folder');
        }
      }
      stop.current.abort();
      for (const row of rowsRef.current) {
        if (row.uploaded && !row.include) discardPaperImport(row.uploaded).catch(() => {});
      }
      setDone(true);
      onAdded?.(shelf);
    } catch (failure) {
      showError(failure, 'adding a folder of papers');
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------- views

  if (!folder) {
    const takeDrop = (event) => {
      event.preventDefault();
      setDragging(false);
      const entry = droppedFolder(event.dataTransfer);
      const pdfs = Array.from(event.dataTransfer.files || []).filter(isPdfFile);
      if (entry) void open(filesInFolder(entry));
      else if (pdfs.length) void open(Promise.resolve(looseFiles(pdfs)));
      else setError('Drop a folder, or PDFs, here.');
    };
    return (
      <div className="panel folder-import">
        <h3>Add a folder</h3>
        <p className="folder-import-lede">
          Ask your agent to gather the PDFs of a literature review into one folder, then drop the folder here.
          You choose the shelf and the tags when they arrive. You may use the prompt below.
        </p>
        <pre className="folder-import-instructions">{agentInstructions()}</pre>
        <div
          className={`dropzone folder-dropzone${dragging ? ' dragging' : ''}`}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={(event) => { event.preventDefault(); setDragging(false); }}
          onDrop={takeDrop}
          onClick={() => pickerRef.current?.click()}
        >
          <input
            type="file"
            ref={pickerRef}
            webkitdirectory=""
            directory=""
            multiple
            style={{ display: 'none' }}
            onChange={(event) => {
              const chosen = filesFromPicker(event.target.files);
              event.target.value = '';
              if (chosen.files.length) void open(Promise.resolve(chosen));
            }}
          />
          {opening ? <Working label="Reading the folder…" /> : <p>Drop the folder here or click to choose it</p>}
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        <div className="form-actions">
          <button type="button" onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }

  const busy = rows.some((row) => row.state === 'waiting' || row.state === 'uploading');
  const reading = rows.filter((row) => row.state === 'reading').length;
  const chosen = rows.filter((row) => row.include && rowAddable(row));
  const canAddShelf = shelves.length < appLimits.counts.shelves_per_nook;

  return (
    <div className="panel folder-import">
      <div className="paper-metadata-heading">
        <h3>{folder.name
          ? (done ? `Added from “${folder.name}”` : `Papers in “${folder.name}”`)
          : (done ? 'Added' : 'Papers to add')}</h3>
      </div>
      {!folder.manifest && !done && (
        // No manifest: likely PDFs gathered by hand. Where an agent could
        // have gathered them, with a note on each, say how — once, folded.
        <details className="folder-agent-hint">
          <summary>From an agent? Ask it for a folder instead, with a note on why each paper is there.</summary>
          <pre className="folder-import-instructions">{agentInstructions()}</pre>
        </details>
      )}
      {folder.manifestError && (
        <p className="metadata-reading" role="status">{folder.manifestError} Every PDF in the folder is listed instead.</p>
      )}
      {done && <p className="metadata-reading" role="status">{importSummary(rows)}.</p>}
      {error && <div className="error" role="alert">{error}</div>}

      <ul className="folder-rows">
        {rows.map((row) => {
          const status = rowStatus(row);
          const settled = row.state === 'added' || row.state === 'yours';
          const trouble = row.problem || row.state === 'failed';
          const identifier = row.entry?.doi || row.entry?.arxiv_id;
          return (
            <li key={row.key} className={`folder-row${trouble ? ' trouble' : ''}${!row.include ? ' left-out' : ''}`}>
              <input
                type="checkbox"
                aria-label={`Add ${rowTitle(row)}`}
                checked={Boolean(row.include) && !trouble && row.state !== 'yours'}
                disabled={done || saving || trouble || settled}
                onChange={(event) => update(row.key, { include: event.target.checked })}
              />
              <div className="folder-row-body">
                {done || saving || trouble || settled || !row.file ? (
                  <span className="folder-row-title">{rowTitle(row)}</span>
                ) : (
                  <input
                    className="folder-row-title"
                    aria-label="Title"
                    value={row.editedTitle ?? rowTitle(row)}
                    onChange={(event) => update(row.key, { editedTitle: event.target.value })}
                  />
                )}
                <span className="folder-row-meta">
                  {[row.path, identifier].filter(Boolean).join(' · ')}
                </span>
                {row.entry?.note && <span className="folder-row-note">{row.entry.note}</span>}
                {row.known && !done && row.state !== 'added' && (
                  <label className="checkbox-row inline folder-row-known">
                    <input type="checkbox" checked={row.useKnown} disabled={saving} onChange={(event) => update(row.key, { useKnown: event.target.checked })} />
                    <span>Papol has a version of this paper; use that one</span>
                  </label>
                )}
              </div>
              <span className={`folder-row-status${trouble ? ' trouble' : ''}`}>
                {(row.state === 'uploading' || row.state === 'reading' || row.state === 'saving')
                  ? <Working label={status} />
                  : status}
              </span>
            </li>
          );
        })}
      </ul>

      {!done && (
        <div className="upload-review-form folder-filing">
          <div className="form-group">
            <label htmlFor="folder-shelf">Shelf</label>
            <div className="shelf-select upload-shelf-select">
              <select id="folder-shelf" value={shelfUuid} disabled={saving} onChange={(event) => setShelfUuid(event.target.value)}>
                {shelves.map((shelf) => (
                  <option key={shelf.uuid} value={shelf.uuid}>{shelf.name} · {shelf.is_public ? 'Public' : 'Private'}</option>
                ))}
                {canAddShelf && <option value={NEW_SHELF}>New private shelf…</option>}
              </select>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9 5 5 5-5" /></svg>
            </div>
          </div>
          {shelfUuid === NEW_SHELF && (
            <div className="form-group">
              <label htmlFor="folder-new-shelf">New shelf’s name</label>
              <input
                id="folder-new-shelf"
                value={newShelfName}
                maxLength={appLimits.text.shelf_name}
                disabled={saving}
                onChange={(event) => setNewShelfName(event.target.value)}
              />
            </div>
          )}
          <div className="form-group">
            <label htmlFor="folder-tags">Private tags for every paper</label>
            <TagPicker
              id="folder-tags"
              available={availableTags}
              onAvailableChange={setAvailableTags}
              selected={selectedTags}
              onSelectedChange={setSelectedTags}
              onError={(failure) => showError(failure, 'creating a tag for a folder of papers')}
            />
          </div>
          {reading > 0 && !busy && (
            <p className="metadata-reading" role="status">
              Still reading {reading} {reading === 1 ? 'PDF' : 'PDFs'}; adding now saves {reading === 1 ? 'it' : 'them'} with what is known so far.
            </p>
          )}
        </div>
      )}

      <div className="form-actions">
        {done ? (
          <button type="button" className="primary" onClick={onClose}>Done</button>
        ) : (
          <>
            <button type="button" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="button" className="primary" onClick={add} disabled={saving || busy || chosen.length === 0}>
              {saving ? 'Adding…' : busy ? 'Uploading…' : `Add ${chosen.length} ${chosen.length === 1 ? 'paper' : 'papers'}`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
