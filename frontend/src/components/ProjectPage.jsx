import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Working } from '../../../shared/ui/Waiting.js';
import BackLink from '../../../shared/ui/BackLink.jsx';
import ActionGlyph from '../../../shared/ui/ActionGlyph.jsx';
import { TalkGlyph, TalkOpener, TalkPin, when } from '../../../shared/ui/Talk.jsx';
import { confirmAction } from '../../../shared/confirmAction';
import {
  briefPath, createProjectBoard, getProject, invitationPath, openInvitation, removeMember, renameProject,
  revokeInvitation, setKeeper,
} from '../../../shared/api/projects.js';
import { appPath } from '../base';
import { DESKTOP } from '../../../shared/desktopShell';
import { InToolbar } from './DesktopChrome';
import { formatAuthors } from '../paperFormat.js';
import { coloursFor } from '../activityView.js';
import Avatar from './Avatar';
import { keeperNames } from './ProjectMembers';

// Opening a project marks what others added as seen, so every later answer
// calls nothing new, and this page may be fetched more than once as the app
// settles. What was new on arriving stays marked until another project, or
// the list of projects, is opened.
let arrivals = { project: null, papers: new Set() };

export function forgetArrivals() {
  arrivals = { project: null, papers: new Set() };
}

export function markArrivals(projectUuid, project) {
  if (!project?.papers) return project;
  if (arrivals.project !== projectUuid) arrivals = { project: projectUuid, papers: new Set() };
  project.papers.forEach((paper) => { if (paper.is_new) arrivals.papers.add(paper.sha256); });
  return { ...project, papers: project.papers.map((paper) => ({ ...paper, is_new: arrivals.papers.has(paper.sha256) })) };
}

// Overlapping faces, a few then a count: who is here without a row of chips.
export function Faces({ users, max = 4 }) {
  const shown = users.slice(0, max);
  const more = users.length - shown.length;
  return (
    <span className="project-faces" aria-hidden="true">
      {shown.map((user) => <Avatar key={user.uuid} user={user} className="mini-avatar" />)}
      {more > 0 && <span className="project-faces-more">+{more}</span>}
    </span>
  );
}

// One project. Its members see its papers, discussions and boards; anyone
// else sees who is in it, and whom to ask to be let in.
export default function ProjectPage({ projectUuid, currentUser, onBack, backHref, onChanged, onLeft, onOpenBrief }) {
  const [project, setProject] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [peopleOpen, setPeopleOpen] = useState(null);
  const [view, setView] = useView(projectUuid);
  const show = useCallback((next) => markArrivals(projectUuid, next), [projectUuid]);

  const load = useCallback(() => {
    let active = true;
    getProject(projectUuid)
      .then((next) => { const shown = show(next); if (active) { setProject(shown); onChanged?.(); } })
      .catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [projectUuid]);

  useEffect(() => load(), [load]);

  const act = async (work) => {
    setNotice(null);
    try {
      const next = await work();
      if (next?.uuid === projectUuid) setProject(show(next));
      return next;
    } catch (err) {
      setNotice(err.message);
      return null;
    }
  };

  if (error) {
    return (
      <div className="panel">
        <div className="error" role="alert">{error}</div>
        <BackLink href={backHref} onBack={onBack}>Back</BackLink>
      </div>
    );
  }
  if (!project) return <div className="loading"><Working label="Loading project…" /></div>;

  // Each paper keeps one hue, the one the activity views give it, on its
  // card and wherever it is talked about.
  const colours = coloursFor(project.papers.map((p) => ({ subject: p.sha256 })));
  const hueOf = (sha256) => {
    const colour = colours.get(sha256);
    return !colour ? null : colour === 'other' ? 'var(--line-strong)' : `var(--activity-${colour})`;
  };

  // What is being said, by subject, and how a pin tells the page it spoke.
  const talk = new Map((project.discussions ?? []).map((d) => [d.subject.key, d]));
  const talked = () => { getProject(project.uuid).then((next) => setProject(show(next))).catch(() => {}); };
  const pin = (subject, label, extra = {}) => (
    <TalkPin
      projectUuid={project.uuid} subject={subject} label={label} summary={talk.get(subject)}
      currentUser={currentUser} onChanged={talked} {...extra}
    />
  );
  // A dig is a conversation, so a card on the desk shows where it stands:
  // the latest words said about the thing or anything on it, and by whom.
  const latestDig = (about) => (project.discussions ?? []).find((d) => d.last_post && about(d.subject));
  const digLine = (d, home) => {
    const last = d.last_post;
    const elsewhere = d.subject.key !== home;
    return (
      <TalkOpener
        projectUuid={project.uuid} subject={d.subject.key} label={d.subject.label} currentUser={currentUser} onChanged={talked}
        className={`project-card-dig${d.is_new ? ' is-new' : ''}`} title="Open the dig"
      >
        <span className="project-card-dig-text">{last.excerpt}</span>
        <span className="project-card-dig-meta">
          <Avatar user={last.user} className="mini-avatar" />
          <b>{last.user.uuid === currentUser?.uuid ? 'You' : firstName(last.user)}</b>
          {elsewhere && <span className="project-card-dig-on">on {d.subject.label}</span>}
          <span>{when(d.updated_at)}</span>
          {d.is_new && <span className="project-card-new">New</span>}
        </span>
      </TalkOpener>
    );
  };

  // A keeper alone in a project has one thing to do next: invite.
  const open = peopleOpen ?? (project.is_keeper && project.members.length === 1);
  const people = project.members.map((m) => m.user);
  const count = plural(people.length, 'member', 'members');

  const talkedAbout = project.discussions ?? [];
  const boards = project.boards ?? [];
  const latest = [
    ...project.papers.map((p) => p.added_at), ...talkedAbout.map((d) => d.updated_at), ...boards.map((b) => b.updated_at),
  ].filter(Boolean).sort().at(-1);
  const newPapers = project.papers.filter((p) => p.is_new).length;
  const newTalk = talkedAbout.filter((d) => d.is_new).length;

  const title = <ProjectTitle project={project} onRename={(name) => act(() => renameProject(project.uuid, name))} />;
  const active = latest && `active ${when(latest)}`;
  const tabs = project.is_member && (
    <DeskTabs
      view={view} onView={setView}
      counts={{ papers: project.papers.length, boards: boards.length, digs: talkedAbout.length }}
      fresh={{ papers: newPapers > 0, digs: newTalk > 0 }}
    />
  );
  const seats = project.is_member ? (
    <div className="project-seats">
      <button
        type="button" className="project-seat-row" aria-expanded={open} aria-controls="project-people"
        aria-label={`${count}: ${people.map((u) => u.display_name).join(', ')}`}
        onClick={() => setPeopleOpen(!open)}
      >
        {people.slice(0, 5).map((user) => (
          <span className="project-seat" key={user.uuid}>
            <Avatar user={user} className="mini-avatar" />
            <small>{user.uuid === currentUser?.uuid ? 'You' : firstName(user)}</small>
          </span>
        ))}
        {people.length > 5 && <span className="project-seat-more">+{people.length - 5}</span>}
      </button>
      {project.is_keeper && (
        <button type="button" className="project-invite-open" onClick={() => setPeopleOpen(true)}>
          <ActionGlyph name="plus" />Invite
        </button>
      )}
    </div>
  ) : (
    <p className="project-crowd"><Faces users={people} /><span>{count}</span></p>
  );

  // In the Mac app a member's desk has no header: its name, its three views
  // and its people sit in the window's toolbar, and the sidebar is the way back.
  const inToolbar = DESKTOP && project.is_member;

  return (
    <div className={`project-page${project.is_member ? ' is-desk' : ''}`}>
      {inToolbar ? (
        <InToolbar>
          <div className="project-toolbar talk-host" data-toolbar-title>
            {title}
          </div>
          {tabs}
          {seats}
        </InToolbar>
      ) : (
        <>
          <BackLink className="back-button" href={backHref} onBack={onBack} />
          <header className="project-head talk-host">
            <div className="project-head-main">
              <div className="project-title-row">
                {title}
              </div>
              {project.is_member && active && <p className="project-tally">{active}</p>}
            </div>
            {seats}
          </header>
          {tabs}
        </>
      )}
      {notice && <div className="error" role="alert">{notice}</div>}

      {!project.is_member ? (
        <p className="project-closed">By invitation. Kept by {keeperNames(project.members)}.</p>
      ) : (
        <>
          {open && <People project={project} currentUser={currentUser} act={act} onLeft={onLeft} />}
          <div className="project-desk" role="tabpanel" id="project-view" aria-labelledby={`project-tab-${view}`}>
            {view === 'papers' && (
              <ProjectPapers
                project={project}
                pin={pin}
                latestDig={latestDig}
                digLine={digLine}
                hueOf={hueOf}
                currentUser={currentUser}
                onOpenBrief={onOpenBrief}
              />
            )}
            {view === 'boards' && <ProjectBoards project={project} act={act} pin={pin} latestDig={latestDig} digLine={digLine} />}
            {view === 'digs' && <ProjectTalk project={project} currentUser={currentUser} hueOf={hueOf} onTalked={talked} />}
          </div>
        </>
      )}
    </div>
  );
}

// Who is in it, the one invitation link for a keeper, and leaving.
function People({ project, currentUser, act, onLeft }) {
  const alone = project.members.length === 1;
  const leave = async () => {
    const ok = await confirmAction(
      alone ? `Leave ${project.name}? It ends when its last member leaves.` : `Leave ${project.name}?`,
      { confirmLabel: 'Leave', destructive: true },
    );
    if (ok && await act(() => removeMember(project.uuid, currentUser.uuid))) onLeft?.();
  };
  return (
    <section id="project-people" className="project-people" aria-label="Members">
      {project.is_keeper && <Invitation project={project} act={act} />}
      <ul className="project-people-list">
        {project.members.map((member) => {
          const me = member.user.uuid === currentUser?.uuid;
          return (
            <li key={member.user.uuid} className="project-person">
              <Avatar user={member.user} className="mini-avatar" />
              <a className="project-person-name" href={appPath(`/u/${member.user.uuid}`)}>
                {member.user.display_name}
              </a>
              {(me || member.is_keeper) && (
                <span className="project-person-role">{[me && 'you', member.is_keeper && 'Keeper'].filter(Boolean).join(' · ')}</span>
              )}
              {project.is_keeper && !me && (
                <span className="project-person-actions">
                  <button type="button" className="project-quiet" onClick={() => act(() => setKeeper(project.uuid, member.user.uuid, !member.is_keeper))}>
                    {member.is_keeper ? 'Not keeper' : 'Make keeper'}
                  </button>
                  <button type="button" className="project-quiet project-danger" onClick={() => act(async () => { await removeMember(project.uuid, member.user.uuid); return getProject(project.uuid); })}>
                    Remove
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <button type="button" className="project-quiet project-danger project-leave" onClick={leave}>Leave project</button>
    </section>
  );
}

// The one invitation link a project has, for a keeper to hand out or stop.
function Invitation({ project, act }) {
  const [copied, setCopied] = useState(false);
  const linkFor = (code) => `${window.location.origin}${appPath(invitationPath(code))}`;
  const link = project.invite_code ? linkFor(project.invite_code) : null;
  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { /* the link can be selected by hand */ }
  };
  if (!link) {
    return (
      <div className="project-invite">
        <button
          type="button" className="primary"
          onClick={() => act(async () => {
            await openInvitation(project.uuid);
            const next = await getProject(project.uuid);
            if (next.invite_code) copy(linkFor(next.invite_code));
            return next;
          })}
        >
          Create link
        </button>
      </div>
    );
  }
  return (
    <div className="project-invite">
      <code className="project-invite-link" title={link} tabIndex={0}>{link}</code>
      <button type="button" onClick={() => copy(link)}>{copied ? 'Copied' : 'Copy link'}</button>
      <button type="button" className="project-quiet" onClick={() => act(async () => { setCopied(false); await revokeInvitation(project.uuid); return getProject(project.uuid); })}>
        Stop link
      </button>
      <span className="project-invite-note">Anyone with the link can join.</span>
    </div>
  );
}

// A section heading: a serif word, a faint count, and at most one action.
export function SectionHead({ id, title, count, action }) {
  return (
    <header className="project-section-head">
      <h3 id={id}>{title}</h3>
      {count > 0 && <span className="project-count">{count}</span>}
      {action}
    </header>
  );
}

const VIEWS = [['papers', 'Papers'], ['boards', 'Boards'], ['digs', 'Digs']];

// The desk shows one of its three things at a time. The view is kept for
// the visit, so coming back from a brief or a board lands where you were.
function useView(projectUuid) {
  const key = `papol:project-view:${projectUuid}`;
  const [view, setView] = useState(() => {
    try { return sessionStorage.getItem(key) || 'papers'; } catch { return 'papers'; }
  });
  const choose = (next) => {
    setView(next);
    try { sessionStorage.setItem(key, next); } catch { /* the view lasts until the page is left */ }
  };
  return [VIEWS.some(([v]) => v === view) ? view : 'papers', choose];
}

// Papers, Boards, Digs: each with its count, and a dot when something in it
// is new since the last visit.
function DeskTabs({ view, onView, counts, fresh }) {
  const move = (e) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    const at = VIEWS.findIndex(([v]) => v === view);
    const next = VIEWS[(at + step + VIEWS.length) % VIEWS.length][0];
    onView(next);
    e.currentTarget.parentElement.querySelector(`#project-tab-${next}`)?.focus();
  };
  return (
    <nav className="project-tabs" role="tablist" aria-label="Project">
      {VIEWS.map(([v, label]) => (
        <button
          key={v} type="button" role="tab" id={`project-tab-${v}`} aria-controls="project-view"
          aria-selected={view === v} tabIndex={view === v ? 0 : -1}
          className={`project-tab${view === v ? ' is-on' : ''}`}
          onClick={() => onView(v)} onKeyDown={move}
        >
          {label}
          {counts[v] > 0 && <span className="project-tab-count">{counts[v]}</span>}
          {fresh[v] && <i className="project-tab-new" aria-label="New" />}
        </button>
      ))}
    </nav>
  );
}

// Each paper is a card: its title and citation, who has it, and the latest
// words said about it. The card opens the paper's brief, where the takes,
// the dig and the rest of what the project knows about it are.
function ProjectPapers({ project, currentUser, pin, latestDig, digLine, hueOf, onOpenBrief }) {
  const isMe = (user) => user.uuid === currentUser?.uuid;
  return (
    <section className="project-section" aria-label="Papers">
      {!project.papers.length ? (
        <div className="project-paper-empty">
          <b>No papers yet</b>
        </div>
      ) : (
        <ul className="project-papers project-grid">
          {project.papers.map((paper) => {
            const takes = paper.users.filter((u) => u.thought);
            const quoted = takes.find((u) => !isMe(u.user)) ?? takes[0];
            const dig = latestDig((subject) => subject.paper_sha256 === paper.sha256);
            const href = appPath(briefPath(project.uuid, paper.sha256));
            const open = (e) => { e.preventDefault(); onOpenBrief(paper.sha256); };
            return (
              <li
                key={paper.sha256}
                data-subject={`paper:${paper.sha256}`}
                style={{ '--hue': hueOf(paper.sha256) }}
                className={`project-card project-paper talk-host${paper.is_new ? ' is-new' : ''}`}
                onClick={(e) => { if (!e.target.closest('a, button, input, textarea') && !e.defaultPrevented) open(e); }}
              >
                <header className="project-card-head">
                  <span className="project-card-kind"><i className="project-card-hue" />Paper{paper.year ? ` · ${paper.year}` : ''}</span>
                  {paper.is_new
                    ? <span className="project-card-new">New</span>
                    : paper.journal && <span className="project-card-venue">{paper.journal}</span>}
                  {pin(`paper:${paper.sha256}`, paper.title)}
                </header>
                <div className="project-card-body">
                  <h4 className="project-card-title">
                    <a className="paper-title-link" href={href} onClick={open}>{paper.title}</a>
                  </h4>
                  <p className="project-card-authors">{formatAuthors(paper.authors)}</p>
                  {dig ? digLine(dig, `paper:${paper.sha256}`) : quoted && (
                    <blockquote className="project-card-quote">
                      “{quoted.thought}”<cite>{isMe(quoted.user) ? 'You' : quoted.user.display_name}</cite>
                    </blockquote>
                  )}
                </div>
                <footer className="project-card-foot">
                  {paper.users.length > 0 ? (
                    <span className="project-card-readers">
                      <Faces users={paper.users.map((u) => u.user)} max={3} />
                      <span>{takes.length ? plural(takes.length, 'thought', 'thoughts') : 'No thoughts yet'}</span>
                    </span>
                  ) : null}
                </footer>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// Every dig, latest first. Each is a card that opens its dig right there.
export const SUBJECT_WORDS = { paper: 'Paper', take: 'Thought', board: 'Board', card: 'Card' };

function ProjectTalk({ project, currentUser, hueOf, onTalked }) {
  const discussions = project.discussions ?? [];
  const opener = (subject, label) => ({ projectUuid: project.uuid, subject, label, currentUser, onChanged: onTalked });
  const square = (d) => (d.subject.paper_sha256 ? hueOf(d.subject.paper_sha256) : 'var(--gold)');
  return (
    <section className="project-talk" aria-label="Digs">
      {discussions.length > 0 && (
          <ul className="project-talk-list">
            {discussions.map((d) => {
              const last = d.last_post;
              const kind = d.subject.kind;
              return (
                <li key={d.uuid}>
                  <TalkOpener {...opener(d.subject.key, d.subject.label)} className={`project-talk-item${d.is_new ? ' is-new' : ''}`}>
                    <span className="project-talk-subject">
                      <i style={{ background: square(d) }} />
                      <span className="project-card-kind">{SUBJECT_WORDS[kind]}</span>
                      <span className="project-talk-label">{d.subject.label}</span>
                    </span>
                    {last && <span className="project-talk-excerpt">{last.excerpt}</span>}
                    <span className="project-talk-meta">
                      {last && <Avatar user={last.user} className="mini-avatar" />}
                      {last && <b>{last.user.uuid === currentUser?.uuid ? 'You' : last.user.display_name}</b>}
                      <span>{when(d.updated_at)}</span>
                      {d.post_count > 1 && <span className="project-talk-count"><TalkGlyph outline />{d.post_count}</span>}
                      {d.is_new && <span className="visually-hidden">New</span>}
                    </span>
                  </TalkOpener>
                </li>
              );
            })}
          </ul>
      )}
    </section>
  );
}

// The project's boards, which every member arranges; one more is a name away.
function ProjectBoards({ project, act, pin, latestDig, digLine }) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const boards = project.boards ?? [];
  const stop = () => { setNaming(false); setName(''); };
  const create = async (e) => {
    e.preventDefault();
    const next = name.trim();
    if (!next || busy) return;
    setBusy(true);
    const board = await act(() => createProjectBoard(project.uuid, next));
    setBusy(false);
    if (board) window.location.assign(appPath(`/boards/${board.uuid}`));
  };
  return (
    <section className="project-section" aria-label="Boards">
      {boards.length > 0 && !naming && (
        <div className="project-section-actions">
          <button type="button" className="project-board-start" onClick={() => setNaming(true)}><ActionGlyph name="plus" />New board</button>
        </div>
      )}
      {!boards.length && !naming ? (
        <button type="button" className="project-board-add" onClick={() => setNaming(true)}>
          <ActionGlyph name="plus" />New board
        </button>
      ) : (
        <ul className="project-boards project-grid">
          {boards.map((board) => {
            const dig = latestDig((subject) => subject.board_uuid === board.uuid);
            return (
              <li key={board.uuid} data-subject={`board:${board.uuid}`} className="project-card project-board talk-host">
                <header className="project-card-head">
                  <span className="project-card-kind">Board</span>
                  {pin(`board:${board.uuid}`, board.name)}
                </header>
                <a className="project-card-body project-board-link" href={appPath(`/boards/${board.uuid}`)}>
                  <strong className="project-card-title">{board.name}</strong>
                  {board.description && <span className="project-board-description">{board.description}</span>}
                  <span className="project-board-meta">
                    {[plural(board.item_count ?? 0, 'card', 'cards'), board.owner && firstName(board.owner), `updated ${when(board.updated_at)}`].filter(Boolean).join(' · ')}
                  </span>
                </a>
                {dig && <div className="project-board-dig">{digLine(dig, `board:${board.uuid}`)}</div>}
              </li>
            );
          })}
          {naming && (
            <li className="project-card project-board is-naming">
              <header className="project-card-head"><span className="project-card-kind">New board</span></header>
              <form className="project-card-body" onSubmit={create}>
                <input
                  className="project-board-name" autoFocus value={name} maxLength={200} placeholder="Board name" aria-label="Board name"
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') stop(); }}
                />
                <span className="project-board-form-actions">
                  <button type="button" className="project-quiet" onClick={stop}>Cancel</button>
                  <button type="submit" className="primary" disabled={!name.trim() || busy}>{busy ? 'Making…' : 'Make board'}</button>
                </span>
              </form>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

// The name, which a keeper renames in place: kept when left, taken back
// with Escape. There is no Save.
function ProjectTitle({ project, onRename }) {
  const [name, setName] = useState(project.name);
  const reverting = useRef(false);
  useEffect(() => setName(project.name), [project.name]);
  if (!project.is_keeper) return <h2 className="project-title">{project.name}</h2>;
  const keep = async () => {
    if (reverting.current) { reverting.current = false; return; }
    const next = name.trim();
    if (!next || next === project.name) { setName(project.name); return; }
    if (!(await onRename(next))) setName(project.name);
  };
  return (
    <h2 className="project-title project-title-sizer" data-value={name}>
      <input
        className="project-title-input" value={name} size={1} maxLength={80} aria-label="Project name" title="Rename"
        onChange={(e) => setName(e.target.value)}
        onBlur={keep}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') { reverting.current = true; setName(project.name); e.currentTarget.blur(); }
        }}
      />
    </h2>
  );
}

export function firstName(user) {
  return (user.display_name || '').split(/\s+/)[0] || user.display_name;
}

export function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}
