import React, { useEffect, useRef, useState } from 'react';
import ActionGlyph from '../../../shared/ui/ActionGlyph.jsx';
import PaperTitle from '../../../shared/ui/PaperTitle.jsx';
import { getNook } from '../../../shared/api/people.js';
import { isPdfFile } from '../../../shared/fileDrop.js';
import { formatAuthors } from '../paperFormat.js';

// How many of the nook's papers the search shows at once.
const SHOWN = 8;

// The nook's papers that every word typed is found in: in the title, the
// authors, the venue or the year. Typed nothing, the latest first.
export function matchingPapers(papers, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const text = (p) => [p.title, p.authors, p.journal, p.year].filter(Boolean).join(' ').toLowerCase();
  const found = words.length ? papers.filter((p) => words.every((w) => text(p).includes(w))) : papers;
  return [...found].sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
}

// The first row of a project's Papers: Add papers, which opens in place
// on a search of the member's own nook. Each paper is added with one
// press and the search stays open, so several go in one after another.
// PDFs not yet in the nook are chosen from disk here, or dropped anywhere
// on the page, and go to the nook and the project together.
export default function ProjectAddPapers({ project, currentUser, onAdd, onFiles, startOpen = false }) {
  const [open, setOpen] = useState(startOpen);
  const [papers, setPapers] = useState(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const field = useRef(null);
  const files = useRef(null);

  useEffect(() => {
    if (!open || !currentUser) return undefined;
    let active = true;
    getNook(currentUser.uuid)
      .then((nook) => { if (active) setPapers(nook.papers ?? []); })
      .catch((err) => { if (active) { setPapers([]); setError(err.message); } });
    return () => { active = false; };
  }, [open, currentUser?.uuid]);
  useEffect(() => { if (open) field.current?.focus(); }, [open]);

  const close = () => { setOpen(false); setQuery(''); setError(null); };
  const inProject = new Set(project.papers.map((p) => p.sha256));
  // Those the project does not hold yet come first: they are the ones to add.
  const matched = papers ? matchingPapers(papers, query) : [];
  const found = [...matched.filter((p) => !inProject.has(p.sha256)), ...matched.filter((p) => inProject.has(p.sha256))];
  const shown = found.slice(0, SHOWN);

  const add = async (paper) => {
    if (busy || inProject.has(paper.sha256)) return;
    setBusy(paper.sha256);
    setError(null);
    const ok = await onAdd(paper.sha256);
    if (!ok) setError('That paper could not be added.');
    setBusy(null);
    field.current?.focus();
  };

  if (!open) {
    return (
      <button type="button" className="project-board-add project-paper-add" aria-expanded="false" onClick={() => setOpen(true)}>
        <ActionGlyph name="plus" />Add papers
      </button>
    );
  }
  return (
    <div
      className="project-paper-adder" role="group" aria-label="Add papers"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }}
    >
      <div className="project-paper-adder-head">
        <input
          ref={field} type="search" className="project-board-name project-paper-search"
          value={query} placeholder="Search your nook" aria-label="Search your nook"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const first = shown.find((p) => !inProject.has(p.sha256));
            if (first) add(first);
          }}
        />
        <button type="button" className="project-quiet" onClick={close}>Done</button>
      </div>
      {papers === null && <p className="project-paper-adder-note">Reading your nook…</p>}
      {papers !== null && papers.length === 0 && !error && (
        <p className="project-paper-adder-note">Your nook has no papers yet. Choose a PDF below and it goes to both.</p>
      )}
      {papers?.length > 0 && found.length === 0 && (
        <p className="project-paper-adder-note">Nothing in your nook matches “{query.trim()}”.</p>
      )}
      {shown.length > 0 && (
        <ul className="project-paper-found">
          {shown.map((paper) => {
            const held = inProject.has(paper.sha256);
            const facts = [formatAuthors(paper.authors), paper.year].filter(Boolean).join(' · ');
            return (
              <li key={paper.sha256}>
                <button
                  type="button" className="project-paper-found-row" disabled={held || (busy != null && busy !== paper.sha256)}
                  aria-label={held ? `${paper.title}, already in the project` : `Add ${paper.title}`}
                  onClick={() => add(paper)}
                >
                  <span className="project-paper-found-text">
                    <strong><PaperTitle title={paper.title} /></strong>
                    {facts && <small>{facts}</small>}
                  </span>
                  <span className={`project-paper-found-state${held ? ' is-held' : ''}`}>
                    {held ? '✓ In project' : busy === paper.sha256 ? 'Adding…' : 'Add'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {found.length > SHOWN && (
        <p className="project-paper-adder-note">{found.length - SHOWN} more. Type to narrow the list.</p>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <p className="project-paper-adder-foot">
        Not in your nook yet?{' '}
        <button type="button" className="project-paper-choose" onClick={() => files.current?.click()}>Choose PDFs</button>
        {' '}or drop them anywhere on this page.
        <input
          ref={files} type="file" accept="application/pdf,.pdf" multiple hidden
          onChange={(e) => {
            const chosen = Array.from(e.target.files || []).filter(isPdfFile);
            e.target.value = '';
            if (chosen.length) onFiles(chosen);
          }}
        />
      </p>
    </div>
  );
}

const STATE_WORDS = {
  waiting: 'Waiting…', uploading: 'Uploading…', reading: 'Reading…', saving: 'Saving to your nook…', adding: 'Adding…', added: 'Added',
};

// PDFs on their way in from a drop or Choose PDFs, one line each.
export function ArrivingPapers({ rows, onDismiss }) {
  if (!rows.length) return null;
  return (
    <ul className="project-paper-arriving" aria-live="polite">
      {rows.map((row) => (
        <li key={row.key} className={`is-${row.state}`}>
          <span className="project-paper-arriving-name">{row.title || row.name}</span>
          <span className="project-paper-arriving-state">
            {row.state === 'failed' ? row.error || 'Could not be added' : STATE_WORDS[row.state]}
          </span>
          {(row.state === 'failed' || row.state === 'added') && (
            <button type="button" className="project-quiet" aria-label={`Dismiss ${row.name}`} onClick={() => onDismiss(row.key)}>×</button>
          )}
        </li>
      ))}
    </ul>
  );
}
