import React, { useEffect, useMemo, useRef, useState } from 'react';
import { paperName } from '../../../shared/paperName.js';
import Avatar from './Avatar';
import Face from '../../../shared/ui/Face.jsx';
import BoardCreateForm from './BoardCreateForm';
import BoardJacket from './BoardJacket';
import { RatingDots } from './Rating';
import { appPath } from '../base';
import { formatAuthors, newestFirst } from '../paperFormat';
import PaperTitle from '../../../shared/ui/PaperTitle.jsx';

const added = (at) => {
  const day = new Date(at);
  if (Number.isNaN(day.getTime())) return '';
  const sameYear = day.getFullYear() === new Date().getFullYear();
  return day.toLocaleDateString('en', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', year: 'numeric' });
};

// Where a paper opens beside the rail, the shelf or board it came from kept
// in front of it (frontend/DESIGN.md, Navigation).
const paperPlace = (sha256, { shelf = null, board = null }) =>
  appPath(`${board ? `/board/${board}` : shelf ? `/shelf/${shelf}` : ''}/paper/${paperName(sha256)}`);

// Who else is here. Each face leads to its person's nook, except inside a
// link of its own (a project's card), where the card is the one way in.
function Faces({ users, max, linked = false }) {
  return (
    <span className="desk-faces">
      {users.slice(0, max).map((u) => (linked
        ? <Face key={u.uuid} user={u} className="desk-face" />
        : <Avatar key={u.uuid} user={u} className="desk-face" />))}
      {users.length > max && <span className="desk-more">+{users.length - max}</span>}
    </span>
  );
}

// A member's own nook on the web: a rail of places beside the main area.
// Every place in the rail opens in the main area: a project its desk, a
// shelf (or all papers) its papers, a board its jacket; and a paper picked
// from a shelf's papers or a board's jacket its jacket, the shelf or board
// still chosen. Search and tags narrow what the main area shows. Every place
// is a link the app follows without reloading; the papers stay mounted
// behind whatever opens, so Back finds them filtered and scrolled as left.
export default function NookDesk({ nook, adding, reviewing, onSelectBoard, onManage, board: boardAsked = null, shelf: shelfAsked = null, project = null, renderProject, paper = null, renderPaper, onOpenCanvas, onChanged }) {
  const board = project ? null : boardAsked;
  const shelf = nook.shelves.some((s) => s.uuid === shelfAsked) ? shelfAsked : null;
  const [tag, setTag] = useState(null);
  const [search, setSearch] = useState('');
  // The column heads stick just under the filter bar, whose height changes
  // as its tags wrap.
  const papersRef = useRef(null);
  const filterRef = useRef(null);
  useEffect(() => {
    const filter = filterRef.current;
    if (!filter || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      papersRef.current?.style.setProperty('--desk-filter-h', `${filter.getBoundingClientRect().height}px`);
    });
    observer.observe(filter);
    return () => observer.disconnect();
  }, []);
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
              {nook.projects.map((p) => (
                <li key={p.uuid}>
                  <a
                    className={`desk-project${p.new_count > 0 ? ' has-new' : ''}${p.uuid === project ? ' is-on' : ''}`}
                    href={appPath(`/project/${p.uuid}`)}
                    aria-current={p.uuid === project ? 'page' : undefined}
                  >
                    <span className="desk-project-name">{p.name}</span>
                    <span className="desk-project-foot">
                      <Faces users={(p.members ?? []).map((m) => m.user).filter((u) => u.uuid !== me)} max={4} />
                      {p.new_count > 0 && <span className="desk-project-new">{p.new_count} new</span>}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="desk-rail-part" aria-labelledby="desk-shelves">
          <div className="desk-rail-head">
            <h3 id="desk-shelves">Shelves</h3>
            <button type="button" className="desk-quiet" onClick={onManage}>Manage</button>
          </div>
          <ul className="desk-rail-list">
            {[{ uuid: null, name: 'All papers', paper_count: nook.papers.length, is_public: true }, ...nook.shelves].map((s) => {
              const on = !board && !project && shelf === s.uuid;
              return (
                <li key={s.uuid ?? 'all'}>
                  <a
                    className={on ? 'desk-row is-on' : 'desk-row'}
                    href={appPath(s.uuid ? `/shelf/${s.uuid}` : '/')}
                    aria-current={on ? 'page' : undefined}
                  >
                    <span className="desk-dot" style={s.color ? { background: s.color } : undefined} aria-hidden="true" />
                    <span className="desk-row-name">{s.name}</span>
                    {!s.is_public && (
                      <svg className="desk-lock" viewBox="0 0 16 16" aria-label="Private">
                        <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
                        <path d="M5.5 7V5.5a2.5 2.5 0 0 1 5 0V7" />
                      </svg>
                    )}
                    <span className="desk-count">{s.paper_count}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>

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
              {nook.boards.map((b) => (
                <li key={b.uuid}>
                  <a
                    className={b.uuid === board ? 'desk-row is-on' : 'desk-row'}
                    href={appPath(`/board/${b.uuid}`)}
                    aria-current={b.uuid === board ? 'page' : undefined}
                  >
                    <span className="desk-dot" style={{ background: shelfOf(b.shelf_uuid)?.color }} aria-hidden="true" />
                    <span className="desk-row-name">{b.name}</span>
                    <span className="desk-count">{b.item_count}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>

      </aside>

      {project && <section className="desk-main desk-project-view">{renderProject(project)}</section>}
      {!project && paper && <section className="desk-main desk-paper-view">{renderPaper(paper)}</section>}
      {board && (
        <section className="desk-main desk-board" hidden={Boolean(paper)}>
          <BoardJacket
            key={board}
            boardUuid={board}
            onOpen={onOpenCanvas}
            paperLink={(p) => paperPlace(p.sha256, { board })}
            hideBack
            onChanged={onChanged}
            onDeleted={() => { onChanged?.(); onSelectBoard(null); }}
          />
        </section>
      )}
      <section ref={papersRef} className="desk-main" aria-labelledby="desk-papers" hidden={Boolean(project || paper || board)}>
        <div className="desk-main-head">
          <h2 id="desk-papers">{chosen ? chosen.name : 'Papers'}<span className="desk-count">{papers.length}</span></h2>
          <div className="desk-actions">{adding}</div>
        </div>
        <div ref={filterRef} className="desk-filter">
          {nook.papers.length > 0 && (
            <input
              type="search"
              className="desk-search"
              value={search}
              placeholder="Filter papers"
              aria-label="Filter papers"
              onChange={(e) => setSearch(e.target.value)}
            />
          )}
          <div className="desk-chips">
            {nook.tags.length > 0 && (
              <div className="desk-tags" role="group" aria-label="Tags">
                {nook.tags.map((t) => (
                  <button key={t.uuid} type="button" className={tag === t.uuid ? 'desk-tag is-on' : 'desk-tag'} aria-pressed={tag === t.uuid} onClick={() => setTag(tag === t.uuid ? null : t.uuid)}>
                    <span aria-hidden="true">#</span>{t.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
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
                      <a
                        className="desk-title"
                        href={paperPlace(paper.sha256, { shelf })}
                      ><PaperTitle title={paper.title} /></a>
                      <span className="desk-meta">
                        {[formatAuthors(paper.authors), paper.year].filter(Boolean).join(' · ')}
                        {paper.journal && <> · <i>{paper.journal}</i></>}
                      </span>
                      {paper.tags.length > 0 && (
                        <span className="desk-row-tags">
                          {paper.tags.map((t) => (
                            <button key={t.uuid} type="button" className={tag === t.uuid ? 'desk-row-tag is-on' : 'desk-row-tag'} aria-pressed={tag === t.uuid} onClick={() => setTag(tag === t.uuid ? null : t.uuid)}>
                              <span aria-hidden="true">#</span>{t.name}
                            </button>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className="desk-col-dots">{paper.rating_reading ? <RatingDots value={paper.rating_reading} /> : null}</td>
                    {showMerit && <td className="desk-col-dots">{paper.rating_liking ? <RatingDots value={paper.rating_liking} /> : null}</td>}
                    <td className="desk-col-faces">{others.length > 0 && <Faces users={others} max={3} linked />}</td>
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
