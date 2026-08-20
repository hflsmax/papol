import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { getPaper, pdfHref, createNote, updateNote, deleteNote, getToken } from './api';
import PdfPage from './PdfPage';
import { styles } from './styles';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const ZOOMS = [0.75, 1, 1.25, 1.5, 2];

function numberParam(name) {
  const v = new URLSearchParams(window.location.search).get(name);
  return v && /^\d+$/.test(v) ? v : null;
}

export default function App() {
  const paperId = numberParam('paper');
  // Papol's Notes list links straight to one note: ?paper=9&note=42.
  const wantedNoteId = numberParam('note');
  const [paper, setPaper] = useState(null);
  const [doc, setDoc] = useState(null);
  const [notes, setNotes] = useState([]);
  const [error, setError] = useState(null);
  const [scale, setScale] = useState(1.25);
  const [placing, setPlacing] = useState(false);
  const [draft, setDraft] = useState(null); // {page, anchor} awaiting its words
  const [draftText, setDraftText] = useState('');
  const [activeNoteId, setActiveNoteId] = useState(null);
  const [editing, setEditing] = useState(null); // note id being reworded
  const [editText, setEditText] = useState('');
  const scrollerRef = useRef(null);

  useEffect(() => {
    if (!paperId) {
      setError('No paper given. Open this viewer from a paper in your nook.');
      return;
    }
    if (!getToken()) {
      setError('Sign in to Papol first — this viewer reads your own notes.');
      return;
    }
    // The paper carries the reader's own notes, located or not.
    getPaper(paperId)
      .then((p) => {
        setPaper(p);
        setNotes(p.comments || []);
      })
      .catch((e) => setError(e.message));
  }, [paperId]);

  useEffect(() => {
    if (!paper) return undefined;
    const href = pdfHref(paper);
    if (!href) {
      setError('This paper has no PDF.');
      return undefined;
    }
    let cancelled = false;
    const task = pdfjs.getDocument({ url: href });
    task.promise
      .then((d) => !cancelled && setDoc(d))
      .catch((e) => !cancelled && setError(`Could not open the PDF: ${e.message}`));
    return () => {
      cancelled = true;
      task.destroy();
    };
  }, [paper]);

  // Esc leaves placing mode; a click that lands nowhere shouldn't trap the
  // reader in a crosshair cursor.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      setPlacing(false);
      setDraft(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // A note placed on a different edition may sit anywhere on this one; it
  // is shown, and marked, never moved.
  const numbered = useMemo(
    () =>
      notes.map((n, i) => ({
        ...n,
        index: i + 1,
        drifted:
          n.anchor != null && paper != null && n.edition_id !== paper.edition_id,
      })),
    [notes, paper]
  );

  const notesByPage = useMemo(() => {
    const map = new Map();
    for (const n of numbered) {
      if (!n.anchor) continue; // a note without a place has no pin
      if (!map.has(n.page)) map.set(n.page, []);
      map.get(n.page).push(n);
    }
    return map;
  }, [numbered]);

  const handlePlace = (spot) => {
    setPlacing(false);
    setDraft(spot);
    setDraftText('');
  };

  const saveDraft = async () => {
    if (!draftText.trim()) return;
    try {
      const note = await createNote(paperId, { ...draft, content: draftText.trim() });
      setNotes((prev) => [...prev, note].sort((a, b) => a.page - b.page || a.id - b.id));
      setDraft(null);
      setDraftText('');
      setActiveNoteId(note.id);
    } catch (e) {
      setError(e.message);
    }
  };

  const saveEdit = async (id) => {
    if (!editText.trim()) return;
    try {
      const updated = await updateNote(id, editText.trim());
      setNotes((prev) => prev.map((n) => (n.id === id ? updated : n)));
      setEditing(null);
    } catch (e) {
      setError(e.message);
    }
  };

  const removeNote = async (id) => {
    if (!confirm('Delete this note? This cannot be undone.')) return;
    try {
      await deleteNote(id);
      setNotes((prev) => prev.filter((n) => n.id !== id));
    } catch (e) {
      setError(e.message);
    }
  };

  // Arriving from a link to one note: show it, once the pages exist.
  useEffect(() => {
    if (!wantedNoteId || !doc || notes.length === 0) return;
    const note = notes.find((n) => String(n.id) === wantedNoteId);
    if (!note) return;
    setActiveNoteId(note.id);
    if (!note.anchor) return;
    const el = scrollerRef.current?.querySelector(`[data-page="${note.page}"]`);
    el?.scrollIntoView({ block: 'center' });
  }, [wantedNoteId, doc, notes]);

  const goToNote = (note) => {
    setActiveNoteId(note.id);
    if (!note.anchor) return;
    const el = scrollerRef.current?.querySelector(`[data-page="${note.page}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  if (error) {
    return (
      <>
        <style>{styles}</style>
        <div className="shell">
          <div className="error">{error}</div>
          <p className="hint">
            <a href="../">Back to Papol</a>
          </p>
        </div>
      </>
    );
  }

  if (!paper || !doc) {
    return (
      <>
        <style>{styles}</style>
        <div className="shell">
          <div className="loading">Opening the paper…</div>
        </div>
      </>
    );
  }

  const pages = Array.from({ length: doc.numPages }, (_, i) => i + 1);

  return (
    <>
      <style>{styles}</style>
      <header className="viewer-bar">
        <a className="back" href={`../#/paper/${paper.id}`}>
          ← Go back to Papol
        </a>
        <span className="spacer" />
        {/* The paper page no longer offers the raw file, so the way to keep
            a copy lives here, beside the reading of it. */}
        <a
          className="bar-link"
          href={pdfHref(paper)}
          download={`${(paper.title || 'paper').replace(/[\\/:*?"<>|]/g, '-')}.pdf`}
        >
          Download
        </a>
        <button
          className={placing ? 'primary' : ''}
          onClick={() => {
            setPlacing((v) => !v);
            setDraft(null);
          }}
        >
          {placing ? 'Click the page…' : 'Add a note'}
        </button>
        <span className="zoom">
          <button
            onClick={() =>
              setScale((s) => ZOOMS[Math.max(0, ZOOMS.indexOf(s) - 1)] ?? s)
            }
            disabled={scale === ZOOMS[0]}
            aria-label="Zoom out"
          >
            −
          </button>
          <span className="zoom-level">{Math.round(scale * 100)}%</span>
          <button
            onClick={() =>
              setScale((s) => ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(s) + 1)] ?? s)
            }
            disabled={scale === ZOOMS[ZOOMS.length - 1]}
            aria-label="Zoom in"
          >
            +
          </button>
        </span>
      </header>

      <div className="viewer-body">
        <div className="pages" ref={scrollerRef}>
          {pages.map((n) => (
            <PdfPage
              key={n}
              doc={doc}
              pageNumber={n}
              scale={scale}
              notes={notesByPage.get(n) || []}
              activeNoteId={activeNoteId}
              placing={placing}
              onPlace={handlePlace}
              onSelectNote={setActiveNoteId}
            />
          ))}
        </div>

        <aside className="rail">
          <h2>
            My notes <span className="count">{numbered.length}</span>
          </h2>

          {draft && (
            <div className="note-card draft">
              <p className="note-where">New note · page {draft.page}</p>
              <textarea
                autoFocus
                rows={3}
                value={draftText}
                placeholder="What is worth remembering here?"
                onChange={(e) => setDraftText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setDraft(null);
                }}
              />
              <div className="note-actions">
                <button className="primary" onClick={saveDraft} disabled={!draftText.trim()}>
                  Save
                </button>
                <button onClick={() => setDraft(null)}>Cancel</button>
              </div>
            </div>
          )}

          {numbered.length === 0 && !draft && (
            <p className="empty">
              Nothing yet. Choose <em>Add a note</em>, then click the spot on the
              page it belongs to.
            </p>
          )}

          {numbered.map((note) => (
            <div
              key={note.id}
              className={`note-card${note.id === activeNoteId ? ' active' : ''}`}
              onClick={() => goToNote(note)}
            >
              <p className="note-where">
                <span className="note-index">{note.index}</span>
                {note.anchor ? `page ${note.page}` : 'not placed on the page'}
                {note.drifted && (
                  <span className="drift" title="Placed on a different PDF of this paper — it may not line up">
                    other PDF
                  </span>
                )}
              </p>
              {editing === note.id ? (
                <>
                  <textarea
                    autoFocus
                    rows={3}
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setEditing(null);
                    }}
                  />
                  <div className="note-actions">
                    <button
                      className="primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        saveEdit(note.id);
                      }}
                    >
                      Save
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing(null);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="note-text">{note.content}</p>
                  <div className="note-actions">
                    <button
                      className="link"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing(note.id);
                        setEditText(note.content);
                      }}
                    >
                      edit
                    </button>
                    <button
                      className="link danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeNote(note.id);
                      }}
                    >
                      delete
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </aside>
      </div>
    </>
  );
}
