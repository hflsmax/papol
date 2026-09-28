import React, { useCallback, useEffect, useState } from 'react';
import ActionGlyph from '../../../shared/ui/ActionGlyph.jsx';
import { TalkCard } from '../../../shared/ui/Talk.jsx';
import { confirmAction } from '../../../shared/confirmAction';
import { annotationViewerPath, findDigs, removePaperFromProject } from '../../../shared/api/projects.js';
import { addToNook } from '../../../shared/api/papers.js';
import { appPath } from '../base';
import { formatAuthors } from '../paperFormat.js';
import PaperTitle from '../../../shared/ui/PaperTitle.jsx';

// The year only when it is not this one.
function day(iso) {
  const date = new Date(iso);
  const thisYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(thisYear ? {} : { year: 'numeric' }) });
}

// A paper's brief: the paper as one project sees it, shown in the Papers
// tab beside the list (or under its row on a narrow window). Where the
// Library's jacket says what the paper is, the brief says what this group
// makes of it: its digs, one per member who wrote about it, each on its
// own, then yours to write if you have not.
export default function PaperBrief({ project, paper, currentUser, unread = {}, underRow = false, onChanged, onRead }) {
  const [notice, setNotice] = useState(null);
  const [digs, setDigs] = useState(null);
  const subject = `paper:${paper.sha256}`;

  const loadDigs = useCallback(() => findDigs(project.uuid, subject)
    .then((found) => setDigs(found.digs ?? []))
    .catch((err) => setNotice(err.message)), [project.uuid, subject]);
  useEffect(() => { setDigs(null); loadDigs(); }, [loadDigs]);

  const act = async (work) => {
    setNotice(null);
    try {
      await work();
      await onChanged();
      return true;
    } catch (err) {
      setNotice(err.message);
      return false;
    }
  };

  const isMe = (user) => user.uuid === currentUser?.uuid;
  const canTakeOut = project.is_keeper || isMe(paper.added_by);
  // The paper opens with this project on: every member's marks on it.
  const viewer = appPath(annotationViewerPath(project.uuid, paper.sha256));
  const where = [paper.journal, paper.year].filter(Boolean).join(' · ');

  const takeOut = async () => {
    const ok = await confirmAction(`Take this paper out of ${project.name}? Its digs stay in the project.`, { confirmLabel: 'Take out', destructive: true });
    if (ok) await act(() => removePaperFromProject(project.uuid, paper.sha256));
  };

  return (
    <article className="paper-brief" aria-label="Brief">
      <header className="paper-brief-head">
        {/* Under its row, the row already names the paper and its authors. */}
        {!underRow && <h3 className="paper-brief-title"><PaperTitle title={paper.title} /></h3>}
        {(!underRow || where) && (
          <p className="paper-brief-cite">
            {!underRow && <span className="paper-brief-authors">{formatAuthors(paper.authors)}</span>}
            {where && <span>{where}</span>}
          </p>
        )}
        <div className="paper-brief-actions">
          <a
            className="button primary" href={viewer} data-document
            onClick={(e) => {
              if (!onRead || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
              e.preventDefault();
              onRead(viewer);
            }}
          >
            Read
          </a>
          {!paper.in_my_nook && (
            <button type="button" className="paper-brief-quiet" onClick={() => act(() => addToNook(paper.sha256))}><ActionGlyph name="add" />Add to my nook</button>
          )}
          {canTakeOut && <button type="button" className="paper-brief-quiet paper-brief-take-out" onClick={takeOut}>Take out</button>}
        </div>
      </header>
      {notice && <div className="error" role="alert">{notice}</div>}

      {paper.added_by && (
        <p className="project-paper-added">Added by {isMe(paper.added_by) ? 'you' : paper.added_by.display_name} · {day(paper.added_at)}</p>
      )}

      {digs && (
        <section className="paper-brief-digs" aria-label="Digs">
          {/* Yours first, then the others' as they came. */}
          {[...digs].sort((a, b) => Number(b.is_mine) - Number(a.is_mine)).map((d) => (
            <div className="paper-brief-dig" key={d.uuid}>
              <TalkCard
                inline single unread={unread[d.uuid] ?? 0} seekUnread={() => false} dig={d.uuid}
                projectUuid={project.uuid} subject={subject} label={paper.title} currentUser={currentUser}
                onChanged={() => { loadDigs(); onChanged().catch(() => {}); }}
              />
            </div>
          ))}
          {currentUser && !digs.some((d) => d.is_mine) && (
            <div className="paper-brief-dig is-yours" key={`mine:${digs.length}`}>
              <TalkCard
                inline single seekUnread={() => false} dig="mine"
                projectUuid={project.uuid} subject={subject} label={paper.title} currentUser={currentUser}
                onChanged={() => { loadDigs(); onChanged().catch(() => {}); }}
              />
            </div>
          )}
        </section>
      )}
    </article>
  );
}
