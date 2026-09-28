import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Working } from '../../../shared/ui/Waiting.js';
import BackLink from '../../../shared/ui/BackLink.jsx';
import ActionGlyph from '../../../shared/ui/ActionGlyph.jsx';
import { TalkCard, TalkGlyph, TalkOpener, phaseWord, when } from '../../../shared/ui/Talk.jsx';
import { confirmAction } from '../../../shared/confirmAction';
import {
  annotationViewerPath, createProjectBoard, getProject, invitationPath, openInvitation, removeMember, renameProject,
  revokeInvitation, setKeeper,
} from '../../../shared/api/projects.js';
import { appPath } from '../base';
import { DESKTOP } from '../../../shared/desktopShell';
import { InToolbar } from './DesktopChrome';
import { InWay } from './Way';
import ExperimentalBadge from '../../../shared/ui/ExperimentalBadge.jsx';
import { formatAuthors } from '../paperFormat.js';
import Avatar from './Avatar';
import Face from '../../../shared/ui/Face.jsx';
import { keeperNames } from './ProjectMembers';
import PaperTitle from '../../../shared/ui/PaperTitle.jsx';
import PaperBrief from './PaperBrief';
import { keep, kept } from '../lastMember';

// Opening a project marks what others added as seen, so every later answer
// calls nothing new, and this page may be fetched more than once as the app
// settles. What was new on arriving stays marked until another project, or
// the list of projects, is opened.
let arrivals = { project: null, papers: new Set(), digs: new Map() };

export function forgetArrivals() {
  arrivals = { project: null, papers: new Set(), digs: new Map() };
}

// A dig stays unread for the visit until it is opened, though the project
// counts as seen as soon as it loads.
export function readDigs(uuids) {
  uuids.forEach((uuid) => arrivals.digs.delete(uuid));
}

export function markArrivals(projectUuid, project) {
  if (!project?.papers) return project;
  if (arrivals.project !== projectUuid) arrivals = { project: projectUuid, papers: new Set(), digs: new Map() };
  project.papers.forEach((paper) => { if (paper.is_new) arrivals.papers.add(paper.sha256); });
  (project.digs ?? []).forEach((d) => { if (d.unread) arrivals.digs.set(d.uuid, d.unread); });
  return {
    ...project,
    papers: project.papers.map((paper) => ({ ...paper, is_new: arrivals.papers.has(paper.sha256) })),
    digs: (project.digs ?? []).map((d) => ({ ...d, unread: arrivals.digs.get(d.uuid) ?? 0, is_new: arrivals.digs.has(d.uuid) })),
  };
}

// A project as last seen, shown at once while it is fetched again. What
// was new then has since been seen, so it is kept without the marks.
const lastSeen = (projectUuid) => markArrivals(projectUuid, kept(`project:${projectUuid}`));
const settled = (project) => (project.papers ? {
  ...project,
  papers: project.papers.map((paper) => ({ ...paper, is_new: false })),
  digs: (project.digs ?? []).map((d) => ({ ...d, unread: 0, is_new: false })),
} : project);

// Overlapping faces, a few then a count: who is here without a row of
// chips. Each leads to its person's nook.
export function Faces({ users, max = 4 }) {
  const shown = users.slice(0, max);
  const more = users.length - shown.length;
  return (
    <span className="project-faces">
      {shown.map((user) => <Face key={user.uuid} user={user} />)}
      {more > 0 && <span className="project-faces-more">+{more}</span>}
    </span>
  );
}

// The way home from a dig on the web, in the bar over every page: the
// project it belongs to. The desk itself leads straight home.
// The way back to a project on the web is to it in the member's nook.
export function ProjectWay({ project }) {
  if (DESKTOP || !project) return null;
  return (
    <InWay>
      <a href={appPath(`/project/${project.uuid}`)}>{project.name}</a>
    </InWay>
  );
}

// One project. Its members see its papers, discussions and boards; anyone
// else sees who is in it, and whom to ask to be let in.
export default function ProjectPage({ projectUuid, currentUser, onBack, backHref, onChanged, onLeft, onRead }) {
  const [project, setProject] = useState(() => lastSeen(projectUuid));
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [view, setView] = useView(projectUuid);
  const [picked, pick] = usePicked(projectUuid);
  const show = useCallback((next) => markArrivals(projectUuid, next), [projectUuid]);

  const load = useCallback(() => {
    let active = true;
    setProject(lastSeen(projectUuid));
    setError(null);
    getProject(projectUuid)
      .then((next) => { const shown = show(next); if (active) { setProject(shown); onChanged?.(); } })
      .catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [projectUuid]);

  useEffect(() => load(), [load]);
  useEffect(() => {
    if (project?.uuid === projectUuid) keep(`project:${projectUuid}`, settled(project));
  }, [project, projectUuid]);

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

  // How a dig card or a brief tells the page it changed something.
  const reload = () => getProject(project.uuid).then((next) => setProject(show(next)));
  const talked = () => { reload().catch(() => {}); };
  const openPaper = (sha256) => { pick(sha256); setView('papers'); };
  // On a desk card, digs speak up only when there is something unread: the
  // spade and the count of posts others wrote since you looked, gold, like a
  // notification. It opens the latest unread dig.
  const readDig = (uuid) => {
    readDigs([uuid]);
    setProject((p) => ({ ...p, digs: p.digs.map((x) => (x.uuid === uuid ? { ...x, unread: 0, is_new: false } : x)) }));
  };
  const alert = (about) => {
    const unread = (project.digs ?? []).filter((d) => d.is_new && about(d.subject));
    if (!unread.length) return null;
    const count = unread.reduce((sum, d) => sum + (d.unread || 1), 0);
    const d = unread[0];
    return (
      <TalkOpener
        projectUuid={project.uuid} subject={d.subject.key} label={d.subject.label} currentUser={currentUser} onChanged={talked} onClosed={() => readDig(d.uuid)}
        className="project-card-alert" title={`${plural(count, 'unread post', 'unread posts')}`}
      >
        <TalkGlyph /><span>{count > 99 ? '99+' : count}</span>
      </TalkOpener>
    );
  };
  // Folded until asked for, even for a keeper alone in the project:
  // entering a project shows its work. The faces open who is in it, and
  // Invite opens the invitation link; each is its own card.
  const open = peopleOpen;
  const people = project.members.map((m) => m.user);
  const count = plural(people.length, 'member', 'members');

  const talkedAbout = project.digs ?? [];
  const boards = project.boards ?? [];
  const newPapers = project.papers.filter((p) => p.is_new).length;
  const newTalk = talkedAbout.filter((d) => d.is_new).length;

  const title = <ProjectTitle project={project} onRename={(name) => act(() => renameProject(project.uuid, name))} />;
  const tabs = project.is_member && (
    <DeskTabs
      view={view} onView={setView}
      counts={{ papers: project.papers.length, boards: boards.length, digs: talkedAbout.length }}
      fresh={{ papers: newPapers, digs: newTalk }}
    />
  );
  const seats = project.is_member ? (
    <div className="project-seats">
      {open && <People project={project} showing={open} currentUser={currentUser} act={act} onLeft={onLeft} onClose={() => setPeopleOpen(false)} />}
      <button
        type="button" className="project-seat-row" aria-expanded={open === 'people'} aria-controls="project-people"
        aria-label={`${count}: ${people.map((u) => u.display_name).join(', ')}`}
        onClick={() => setPeopleOpen(open === 'people' ? false : 'people')}
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
        <button
          type="button" className="project-invite-open" aria-expanded={open === 'invite'} aria-controls="project-people"
          onClick={() => setPeopleOpen(open === 'invite' ? false : 'invite')}
        >
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
            <ExperimentalBadge />
          </div>
          {tabs}
          {seats}
        </InToolbar>
      ) : (
        <>
          <ProjectWay />
          <header className="project-head talk-host">
            <div className="project-head-main">
              <div className="project-title-row">
                {title}
                <ExperimentalBadge />
              </div>
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
          <div className="project-desk" role="tabpanel" id="project-view" aria-labelledby={`project-tab-${view}`}>
            {view === 'papers' && (
              <ProjectPapers
                project={project}
                alert={alert}
                currentUser={currentUser}
                picked={picked}
                onPick={pick}
                onChanged={reload}
                onRead={onRead}
              />
            )}
            {view === 'boards' && <ProjectBoards project={project} act={act} alert={alert} currentUser={currentUser} />}
            {view === 'digs' && <ProjectTalk project={project} currentUser={currentUser} onTalked={talked} onRead={readDig} onOpenPaper={openPaper} />}
          </div>
        </>
      )}
    </div>
  );
}

// A card under the seats, so the desk stays where the eye was: who is in
// it and leaving (the faces), or the one invitation link (a keeper's Invite).
function People({ project, showing, currentUser, act, onLeft, onClose }) {
  const alone = project.members.length === 1;
  const self = useRef(null);
  useEffect(() => {
    const away = (e) => { if (!self.current?.contains(e.target) && !e.target.closest('.project-seat-row, .project-invite-open')) onClose(); };
    const escape = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', escape); };
  }, [onClose]);
  const leave = async () => {
    const ok = await confirmAction(
      alone ? `Leave ${project.name}? It ends when its last member leaves.` : `Leave ${project.name}?`,
      { confirmLabel: 'Leave', destructive: true },
    );
    if (ok && await act(() => removeMember(project.uuid, currentUser.uuid))) onLeft?.();
  };
  return (
    <section id="project-people" className="project-people" aria-label={showing === 'invite' ? 'Invite' : 'Members'} ref={self}>
      {showing === 'invite' && project.is_keeper && <Invitation project={project} act={act} />}
      {showing === 'people' && <ul className="project-people-list">
        {project.members.map((member) => {
          const me = member.user.uuid === currentUser?.uuid;
          return (
            <li key={member.user.uuid} className="project-person">
              <Face user={member.user} />
              <a className="project-person-name" href={appPath(`/u/${member.user.uuid}`)}>
                {member.user.display_name}
              </a>
              {(me || member.is_keeper) && (
                <span className="project-person-role">{[me && 'you', member.is_keeper && 'Keeper'].filter(Boolean).join(' · ')}</span>
              )}
              {me ? (
                <span className="project-person-actions">
                  <button type="button" className="project-quiet project-danger" onClick={leave}>Leave</button>
                </span>
              ) : project.is_keeper && (
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
      </ul>}
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
    </div>
  );
}

const VIEWS = [['papers', 'Papers'], ['boards', 'Boards'], ['digs', 'Digs']];

// The desk shows one of its three things at a time. The view is kept for
// the visit, so coming back from the viewer or a board lands where you were.
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

const pickedKey = (projectUuid) => `papol:project-paper:${projectUuid}`;

// The paper whose brief is open in the Papers tab, kept for the visit like
// the tab. Picking a paper is not a place of its own: the address stays
// the project's, as picking a dig does.
function usePicked(projectUuid) {
  const [picked, setPicked] = useState(() => {
    try { return sessionStorage.getItem(pickedKey(projectUuid)); } catch { return null; }
  });
  const choose = (sha256) => {
    setPicked(sha256);
    try {
      if (sha256) sessionStorage.setItem(pickedKey(projectUuid), sha256);
      else sessionStorage.removeItem(pickedKey(projectUuid));
    } catch { /* the pick lasts until the page is left */ }
  };
  return [picked, choose];
}

// Papers, Boards, Digs: each with its count, and in gold how many in it
// are new since the last visit.
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
          {fresh[v] > 0 && <span className="project-tab-new" aria-label={`${fresh[v]} new`}>{fresh[v]}</span>}
        </button>
      ))}
    </nav>
  );
}

// Each paper is a row of a list, the way a bibliography reads: its title
// and authors, where it appeared, who brought it in, and
// what is unread about it. Picking a row shows the paper's brief: beside
// the list on a wide window, as the Digs tab shows a dig, and under the
// row on a narrow one.
function ProjectPapers({ project, currentUser, alert, picked, onPick, onChanged, onRead }) {
  const isMe = (user) => user.uuid === currentUser?.uuid;
  const wide = useWide();
  const papers = project.papers;
  // Beside the list there is always a brief: the one picked, else the first
  // new paper, else the top one. Under a row it is only the one picked.
  const chosen = papers.find((p) => p.sha256 === picked)
    ?? (wide ? papers.find((p) => p.is_new) ?? papers[0] : null);
  if (!papers.length) return <section className="project-section" aria-label="Papers" />;
  const unreadOn = (paper) => (project.digs ?? [])
    .filter((d) => d.subject.key === `paper:${paper.sha256}`)
    .reduce((sum, d) => sum + Number(d.unread ?? 0), 0);
  const brief = (paper) => (
    <PaperBrief
      key={paper.sha256} project={project} paper={paper} currentUser={currentUser} underRow={!wide}
      unread={unreadOn(paper)} onChanged={onChanged} onRead={onRead}
    />
  );
  const move = (e) => {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!step || !chosen || e.target.closest('input, textarea')) return;
    e.preventDefault();
    const at = papers.findIndex((p) => p.sha256 === chosen.sha256);
    const next = papers[Math.max(0, Math.min(papers.length - 1, at + step))];
    onPick(next.sha256);
    e.currentTarget.querySelector(`[data-paper="${next.sha256}"]`)?.focus();
  };
  return (
    <section className={`project-section project-papers-view${wide ? ' is-wide' : ''}`} aria-label="Papers">
      <ul className="project-papers project-rows" onKeyDown={wide ? move : undefined}>
        {papers.map((paper) => {
          const where = [paper.journal, paper.year].filter(Boolean).join(' · ');
          const selected = chosen?.sha256 === paper.sha256;
          // A narrow window folds the brief away again on a second press.
          const choose = () => onPick(selected && !wide ? null : paper.sha256);
          return (
            <React.Fragment key={paper.sha256}>
              <li
                data-subject={`paper:${paper.sha256}`}
                className={`project-row project-paper${paper.is_new ? ' is-new' : ''}${selected ? ' is-selected' : ''}`}
                onClick={(e) => { if (!e.target.closest('a, button, input, textarea')) choose(); }}
              >
                <div className="project-row-text">
                  <h4 className="project-card-title">
                    <button
                      type="button" className="project-row-open" data-paper={paper.sha256}
                      aria-expanded={wide ? undefined : selected} aria-pressed={wide ? selected : undefined}
                      onClick={choose}
                    >
                      <PaperTitle title={paper.title} />
                    </button>
                  </h4>
                  <p className="project-card-authors">{formatAuthors(paper.authors)}</p>
                </div>
                <span className="project-row-facts">
                  <span className="project-row-cite">{where}</span>
                  <span className="project-card-added">{paper.added_by && <>{isMe(paper.added_by) ? 'You' : firstName(paper.added_by)} added · {when(paper.added_at)}</>}</span>
                </span>
                <span className="project-row-end">
                  {paper.is_new && <span className="project-card-new">New</span>}
                  {alert((subject) => subject.paper_sha256 === paper.sha256 && !(selected && subject.kind === 'paper'))}
                </span>
              </li>
              {!wide && selected && <li className="project-paper-open">{brief(paper)}</li>}
            </React.Fragment>
          );
        })}
      </ul>
      {wide && chosen && <div className="project-papers-panel">{brief(chosen)}</div>}
    </section>
  );
}

// Every dig, latest first. Each is a card that opens its dig right there.
export const SUBJECT_WORDS = { paper: 'Paper', card: 'Card', annotation: 'Annotation' };

// Digs still digging lead; stashed, gold and buried ones follow, each by
// latest writing.
const PHASE_ORDER = { digging: 0, stashed: 1, gold: 2, buried: 3 };

function ProjectTalk({ project, currentUser, onTalked, onRead, onOpenPaper }) {
  const discussions = [...(project.digs ?? [])].sort((a, b) => (PHASE_ORDER[a.phase] ?? 0) - (PHASE_ORDER[b.phase] ?? 0));
  const wide = useWide();
  // A dig opens right here, never on a page of its own. On a wide window
  // the list stays put and the dig opens beside it: on arrival the first
  // unread one, else the latest. Narrower, it opens under its row, and a
  // second press folds it. Read when the selection moves on.
  const [picked, setPicked] = useState(() => (wide ? (discussions.find((d) => d.is_new) ?? discussions[0])?.uuid ?? null : null));
  const shown = discussions.find((d) => d.uuid === picked) ?? (wide ? discussions[0] : null) ?? null;
  const pick = (uuid) => setPicked(wide || shown?.uuid !== uuid ? uuid : null);
  useEffect(() => () => { if (shown) onRead(shown.uuid); }, [shown?.uuid]);
  const move = (e) => {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!step || !shown) return;
    e.preventDefault();
    const at = discussions.findIndex((d) => d.uuid === shown.uuid);
    const next = discussions[Math.max(0, Math.min(discussions.length - 1, at + step))];
    pick(next.uuid);
    e.currentTarget.querySelector(`[data-dig="${next.uuid}"]`)?.focus();
  };
  const pane = (d) => (
    <>
      <h3 className="project-talk-subject-line">
        <span className="project-card-kind">{SUBJECT_WORDS[d.subject.kind]}</span>
        {d.subject.kind === 'paper' ? (
          <button type="button" className="project-talk-subject-open" onClick={() => onOpenPaper(d.subject.paper_sha256)}>
            <PaperTitle title={d.subject.label} />
          </button>
        ) : subjectHome(project, d.subject)
          ? <a href={appPath(subjectHome(project, d.subject))}><PaperTitle title={d.subject.label} /></a>
          : <span><PaperTitle title={d.subject.label} /></span>}
      </h3>
      <TalkCard
        key={d.uuid} inline
        projectUuid={project.uuid} subject={d.subject.key} label={d.subject.label} dig={d.uuid} currentUser={currentUser} onChanged={onTalked} single
      />
    </>
  );
  // A row is one member's dig: whose it is first, then what it is about.
  const row = (d) => {
    const kind = d.subject.kind;
    return (
      <>
        <span className="project-talk-meta">
          {d.owner && <Avatar user={d.owner} className="mini-avatar" />}
          <b>{d.is_mine ? 'You' : d.owner?.display_name}</b>
          {d.phase && d.phase !== 'digging' && <span className={`project-talk-phase is-${d.phase}`}>{phaseWord(d.phase)}</span>}
          <span>{when(d.updated_at)}</span>
        </span>
        <span className="project-talk-subject">
          <span className="project-card-kind">{SUBJECT_WORDS[kind]}</span>
          <span className="project-talk-label"><PaperTitle title={d.subject.label} /></span>
        </span>
        {d.is_new && <span className="project-card-alert" aria-label={plural(d.unread || 1, 'unread post', 'unread posts')}><TalkGlyph /><span>{d.unread || 1}</span></span>}
      </>
    );
  };
  return (
    <section className={`project-talk${wide ? ' is-wide' : ''}`} aria-label="Digs">
      {discussions.length > 0 && (
        <ul className="project-talk-list" onKeyDown={wide ? move : undefined}>
          {discussions.map((d) => (
            <li key={d.uuid}>
              <button
                type="button" data-dig={d.uuid} aria-pressed={shown?.uuid === d.uuid}
                className={`project-talk-item${d.is_new ? ' is-new' : ''}${d.phase === 'buried' ? ' is-buried' : ''}${shown?.uuid === d.uuid ? ' is-selected' : ''}`}
                onClick={() => pick(d.uuid)}
              >
                {row(d)}
              </button>
              {!wide && shown?.uuid === d.uuid && <div className="project-talk-panel">{pane(d)}</div>}
            </li>
          ))}
        </ul>
      )}
      {wide && shown && <div className="project-talk-panel">{pane(shown)}</div>}
    </section>
  );
}

// Where a card's or an annotation's dig subject lives: the board a card is
// on, the viewer at an annotation. A paper's is its brief, on this page.
function subjectHome(project, subject) {
  if (subject.kind === 'annotation') return annotationViewerPath(project.uuid, subject.paper_sha256, subject.page);
  if (subject.board_uuid) return `/boards/${subject.board_uuid}`;
  return null;
}

// Whether the window is wide enough for a list and a dig side by side.
function useWide(query = '(min-width: 1000px)') {
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setWide(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return wide;
}

// The project's boards, which every member arranges; a board is known by
// its shape, so its map is the card. The last tile is the one way to make
// one more.
function ProjectBoards({ project, act, alert, currentUser }) {
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
      <ul className="project-boards project-grid">
        {boards.map((board) => {
          const papers = project.papers.filter((p) => (p.board_uuids ?? []).includes(board.uuid)).length;
          const href = appPath(`/boards/${board.uuid}`);
          const owner = board.owner?.display_name ? (board.owner.uuid === currentUser?.uuid ? 'You' : firstName(board.owner)) : null;
          return (
            <li key={board.uuid} data-subject={`board:${board.uuid}`} className="project-card project-board">
              <a className="project-card-body project-board-link" href={href}>
                <BoardMap boxes={board.boxes} />
                <strong className="project-card-title">{board.name}</strong>
              </a>
              {alert((subject) => subject.board_uuid === board.uuid)}
              <footer className="project-card-foot project-board-meta">
                {[
                  board.item_count ? plural(board.item_count, 'card', 'cards') : 'No cards',
                  papers ? plural(papers, 'paper', 'papers') : null,
                  owner,
                  `edited ${when(board.updated_at)}`,
                ].filter(Boolean).join(' · ')}
              </footer>
            </li>
          );
        })}
        {naming ? (
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
        ) : (
          <li className="project-board-tile">
            <button type="button" className="project-board-add" onClick={() => setNaming(true)}>
              <ActionGlyph name="plus" />New board
            </button>
          </li>
        )}
      </ul>
    </section>
  );
}

// A board from a distance: its cards as plain boxes where they sit, fitted
// to a fixed strip so the cards in a row line up.
function BoardMap({ boxes = [] }) {
  if (!boxes.length) return <svg className="project-board-map" aria-hidden="true" />;
  const left = Math.min(...boxes.map((b) => b.x));
  const top = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h));
  const margin = Math.max(24, 0.04 * Math.max(right - left, bottom - top));
  return (
    <svg
      className="project-board-map" aria-hidden="true" preserveAspectRatio="xMidYMid meet"
      viewBox={`${left - margin} ${top - margin} ${right - left + 2 * margin} ${bottom - top + 2 * margin}`}
    >
      {boxes.map((b, i) => <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} rx="10" className={`is-${b.kind}`} />)}
    </svg>
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
