import React, { useMemo, useState } from 'react';
import { paperHref } from '../../../shared/api/papers.js';
import Avatar from './Avatar';
import StatePill from './StatePill';
import BoardCreateForm from './BoardCreateForm';
import { RatingDots } from './Rating';
import { appPath } from '../base';
import { formatAuthors, newestFirst } from '../paperFormat';

const added = (at) => {
  const day = new Date(at);
  if (Number.isNaN(day.getTime())) return '';
  const sameYear = day.getFullYear() === new Date().getFullYear();
  return day.toLocaleDateString('en', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', year: 'numeric' });
};

function Faces({ users, max }) {
  return (
    <span className="desk-faces">
      {users.slice(0, max).map((u) => <Avatar key={u.uuid} user={u} className="desk-face" />)}
      {users.length > max && <span className="desk-more">+{users.length - max}</span>}
    </span>
  );
}

// A member's own nook on the web: a rail of their places (projects,
// boards, shelves) beside one table of their papers. Every row on the
// page keeps to one grid and one left edge; a shelf chosen in the rail
// narrows the table.
export default function NookDesk({ nook, adding, reviewing, onSelectBoard, onManage }) {
  const [shelf, setShelf] = useState(null);
  const [tag, setTag] = useState(null);
  const [search, setSearch] = useState('');
  const [creatingBoard, setCreatingBoard] = useState(false);
  const me = nook.user.uuid;
  const shelfOf = (uuid) => nook.shelves.find((s) => s.uuid === uuid);

  const papers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return nook.papers.filter((p) =>
      (shelf == null || p.shelf_uuid === shelf) &&
      (tag == null || p.tags.some((t) => t.uuid === tag)) &&
      (!q || [p.title, p.authors, p.journal].some((v) => v && v.toLowerCase().includes(q)))).sort(newestFirst);
  }, [nook.papers, shelf, tag, search]);

  const chosen = shelfOf(shelf);
  const rated = (key) => nook.papers.some((p) => p[key]);
  const showMerit = rated('rating_liking');

  return (
    <div className={reviewing ? 'nook-desk is-reviewing' : 'nook-desk'}>
      <aside className="desk-rail">
        {nook.projects?.length > 0 && (
          <section className="desk-rail-part" aria-labelledby="desk-projects">
            <h3 className="desk-rail-head" id="desk-projects">Projects</h3>
            <ul className="desk-rail-list">
              {nook.projects.map((project) => (
                <li key={project.uuid}>
                  <a className={project.new_count > 0 ? 'desk-project has-new' : 'desk-project'} href={appPath(`/project/${project.uuid}`)}>
                    <span className="desk-project-name">{project.name}</span>
                    <span className="desk-project-foot">
                      <Faces users={(project.members ?? []).map((m) => m.user).filter((u) => u.uuid !== me)} max={4} />
                      {project.new_count > 0 && <span className="desk-project-new">{project.new_count} new</span>}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="desk-rail-part" aria-labelledby="desk-boards">
          <div className="desk-rail-head">
            <h3 id="desk-boards">Boards</h3>
            {!creatingBoard && <button type="button" className="desk-quiet" onClick={() => setCreatingBoard(true)}>New</button>}
          </div>
          {creatingBoard && (
            <BoardCreateForm
              className="nook-inline-board-create"
              shelves={nook.shelves}
              onCreated={(board) => { setCreatingBoard(false); onSelectBoard(board.uuid); }}
              onCancel={() => setCreatingBoard(false)}
            />
          )}
          {nook.boards.length > 0 && (
            <ul className="desk-rail-list">
              {nook.boards.map((board) => (
                <li key={board.uuid}>
                  <a
                    className="desk-row"
                    href={appPath(`/board/${board.uuid}`)}
                    onClick={(event) => { event.preventDefault(); onSelectBoard(board.uuid); }}
                  >
                    <span className="desk-dot" style={{ background: shelfOf(board.shelf_uuid)?.color }} aria-hidden="true" />
                    <span className="desk-row-name">{board.name}</span>
                    <span className="desk-count">{board.item_count}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="desk-rail-part" aria-labelledby="desk-shelves">
          <div className="desk-rail-head">
            <h3 id="desk-shelves">Shelves</h3>
            <button type="button" className="desk-quiet" onClick={onManage}>Manage</button>
          </div>
          <ul className="desk-rail-list">
            <li>
              <button type="button" className={shelf == null ? 'desk-row is-on' : 'desk-row'} aria-pressed={shelf == null} onClick={() => setShelf(null)}>
                <span className="desk-dot" aria-hidden="true" />
                <span className="desk-row-name">All papers</span>
                <span className="desk-count">{nook.papers.length}</span>
              </button>
            </li>
            {nook.shelves.map((s) => (
              <li key={s.uuid}>
                <button type="button" className={shelf === s.uuid ? 'desk-row is-on' : 'desk-row'} aria-pressed={shelf === s.uuid} onClick={() => setShelf(shelf === s.uuid ? null : s.uuid)}>
                  <span className="desk-dot" style={{ background: s.color }} aria-hidden="true" />
                  <span className="desk-row-name">{s.name}</span>
                  {!s.is_public && (
                    <svg className="desk-lock" viewBox="0 0 16 16" aria-label="Private">
                      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
                      <path d="M5.5 7V5.5a2.5 2.5 0 0 1 5 0V7" />
                    </svg>
                  )}
                  <span className="desk-count">{s.paper_count}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </aside>

      <section className="desk-main" aria-labelledby="desk-papers">
        <div className="desk-main-head">
          <h2 id="desk-papers">{chosen ? chosen.name : 'Papers'}<span className="desk-count">{papers.length}</span></h2>
          <div className="desk-actions">{adding}</div>
        </div>
        {nook.papers.length > 0 && (
          <div className="desk-filter">
            <input
              type="search"
              className="desk-search"
              value={search}
              placeholder="Filter papers"
              aria-label="Filter papers"
              onChange={(e) => setSearch(e.target.value)}
            />
            {nook.tags.length > 0 && (
              <div className="desk-tags" role="group" aria-label="Tags">
                <button type="button" className={tag == null ? 'desk-tag is-on' : 'desk-tag'} aria-pressed={tag == null} onClick={() => setTag(null)}>All</button>
                {nook.tags.map((t) => (
                  <button key={t.uuid} type="button" className={tag === t.uuid ? 'desk-tag is-on' : 'desk-tag'} aria-pressed={tag === t.uuid} onClick={() => setTag(tag === t.uuid ? null : t.uuid)}>{t.name}</button>
                ))}
              </div>
            )}
          </div>
        )}
        {papers.length > 0 && (
          <table className={showMerit ? 'desk-table' : 'desk-table no-merit'}>
            <thead>
              <tr>
                <th scope="col" className="desk-col-title">Title</th>
                <th scope="col" className="desk-col-dots">Depth</th>
                {showMerit && <th scope="col" className="desk-col-dots">Merit</th>}
                <th scope="col" className="desk-col-faces">Also read</th>
                <th scope="col" className="desk-col-date">Added</th>
              </tr>
            </thead>
            <tbody>
              {papers.map((paper) => {
                const others = (paper.users ?? []).map((u) => u.user).filter((u) => u.uuid !== me);
                return (
                  <tr key={paper.sha256} style={{ '--shelf-color': shelfOf(paper.shelf_uuid)?.color }}>
                    <td className="desk-col-title">
                      <a className="desk-title" href={paperHref(paper)}>{paper.title}</a>
                      {paper.room_status && <StatePill status={paper.room_status} />}
                      <span className="desk-meta">
                        {[formatAuthors(paper.authors), paper.year].filter(Boolean).join(' · ')}
                        {paper.journal && <> · <i>{paper.journal}</i></>}
                        {paper.tags.map((t) => <span key={t.uuid} className="desk-meta-tag">{t.name}</span>)}
                      </span>
                    </td>
                    <td className="desk-col-dots">{paper.rating_reading ? <RatingDots value={paper.rating_reading} /> : null}</td>
                    {showMerit && <td className="desk-col-dots">{paper.rating_liking ? <RatingDots value={paper.rating_liking} /> : null}</td>}
                    <td className="desk-col-faces">{others.length > 0 && <Faces users={others} max={3} />}</td>
                    <td className="desk-col-date">{added(paper.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {nook.papers.length > 0 && papers.length === 0 && <p className="desk-none">No papers match.</p>}
      </section>
    </div>
  );
}
