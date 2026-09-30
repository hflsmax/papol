import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Working } from '../../../shared/ui/Waiting.js';
import BackLink from '../../../shared/ui/BackLink.jsx';
import ActionGlyph from '../../../shared/ui/ActionGlyph.jsx';
import { PHASES, PhaseGlyph, DigThread, phaseRank, when } from '../../../shared/ui/Talk.jsx';
import NewsDot from '../../../shared/ui/NewsDot.jsx';
import { confirmAction } from '../../../shared/confirmAction';
import {
  addMember, annotationViewerPath, createProjectBoard, findPeople, getProject, invitationPath, openInvitation, removeMember,
  describeProject, renameProject, revokeInvitation, setKeeper,
} from '../../../shared/api/projects.js';
import appLimits from '../../../shared/appLimits.js';
import { appPath, backendPath } from '../base';
import { DESKTOP } from '../../../shared/desktopShell';
import { copyText } from '../../../shared/nativeData.js';
import { InToolbar } from './DesktopChrome';
import { InWay } from './Way';
import ExperimentalBadge from '../../../shared/ui/ExperimentalBadge.jsx';
import { formatAuthors } from '../paperFormat.js';
import Avatar from './Avatar';
import Face from '../../../shared/ui/Face.jsx';
import { keeperNames } from './ProjectMembers';
import PaperTitle from '../../../shared/ui/PaperTitle.jsx';
import PaperBrief from './PaperBrief';
import BoardJacket from './BoardJacket';
import { keep, kept } from '../lastMember';

// Opening a project marks what others added as seen, so every later answer
// calls nothing new, and this page may be fetched more than once as the app
// settles. What was new on arriving stays marked until another project, or
// the list of projects, is opened.
let arrivals = { project: null, papers: new Set(), boards: new Set(), digs: new Map() };

export function forgetArrivals() {
  arrivals = { project: null, papers: new Set(), boards: new Set(), digs: new Map() };
}

// A dig stays unread for the visit until it is opened, though the project
// counts as seen as soon as it loads.
export function readDigs(uuids) {
  uuids.forEach((uuid) => arrivals.digs.delete(uuid));
}

export function markArrivals(projectUuid, project) {
  if (!project?.papers) return project;
  if (arrivals.project !== projectUuid) arrivals = { project: projectUuid, papers: new Set(), boards: new Set(), digs: new Map() };
  project.papers.forEach((paper) => { if (paper.is_new) arrivals.papers.add(paper.sha256); });
  (project.boards ?? []).forEach((board) => { if (board.is_new) arrivals.boards.add(board.uuid); });
  (project.digs ?? []).forEach((d) => { if (d.unread) arrivals.digs.set(d.uuid, d.unread); });
  return {
    ...project,
    papers: project.papers.map((paper) => ({ ...paper, is_new: arrivals.papers.has(paper.sha256) })),
    boards: (project.boards ?? []).map((board) => ({ ...board, is_new: arrivals.boards.has(board.uuid) })),
    digs: (project.digs ?? []).map((d) => ({ ...d, unread: arrivals.digs.get(d.uuid) ?? 0, is_new: arrivals.digs.has(d.uuid) })),
  };
}

// A project as last seen, shown at once while it is fetched again. What
// was new then has since been seen, so it is kept without the marks.
const lastSeen = (projectUuid) => markArrivals(projectUuid, kept(`project:${projectUuid}`));
const settled = (project) => (project.papers ? {
  ...project,
  papers: project.papers.map((paper) => ({ ...paper, is_new: false })),
  boards: (project.boards ?? []).map((board) => ({ ...board, is_new: false })),
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

// One project. Its members see its papers, discussions and boards; anyone
// else sees who is in it, and whom to ask to be let in.
export default function ProjectPage({ projectUuid, board = null, currentUser, onBack, backHref, onChanged, onLeft, onRead, onOpenBoard, onOpenCanvas }) {
  const [project, setProject] = useState(() => lastSeen(projectUuid));
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [chosenView, chooseView] = useView(projectUuid);
  // A board's jacket opens in the Boards tab; another tab leaves it for
  // the project's own address.
  const view = board ? 'boards' : chosenView;
  const setView = (next) => {
    chooseView(next);
    if (board && next !== 'boards') onOpenBoard(null, { replace: true });
  };
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
  // A dig written in the viewer reaches this page only when it is fetched
  // again: on the Mac the viewer is a window of its own, and this one stays
  // as it was while it sits behind it. Fetch in place when it comes back.
  useEffect(() => {
    let active = true;
    const refresh = () => {
      getProject(projectUuid).then((next) => { if (active) setProject(show(next)); }).catch(() => {});
    };
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
    };
  }, [projectUuid, show]);
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
  // Anything new in the project, a new paper or a dig someone else moved
  // on, is the one news dot on whatever it concerns.
  const readDig = (uuid) => {
    readDigs([uuid]);
    setProject((p) => ({ ...p, digs: p.digs.map((x) => (x.uuid === uuid ? { ...x, unread: 0, is_new: false } : x)) }));
  };
  const hasNews = (about) => (project.digs ?? []).some((d) => d.is_new && about(d.subject));
  // Folded until asked for, even for a keeper alone in the project:
  // entering a project shows its work. Each face leads to its person's
  // nook; the button after them opens who is in it, and Invite opens the
  // invitation link; each is its own card.
  const open = peopleOpen;
  const people = project.members.map((m) => m.user);
  const count = plural(people.length, 'member', 'members');

  const talkedAbout = project.digs ?? [];
  const boards = project.boards ?? [];
  const newPapers = project.papers.some((p) => p.is_new);
  const newTalk = talkedAbout.some((d) => d.is_new);

  const title = <ProjectTitle project={project} onRename={(name) => act(() => renameProject(project.uuid, name))} />;
  const about = project.is_member && (
    <ProjectDescription project={project} onDescribe={(text) => act(() => describeProject(project.uuid, text))} />
  );
  const tabs = project.is_member && (
    <DeskTabs
      view={view} onView={setView}
      counts={{ papers: project.papers.length, boards: boards.length, digs: talkedAbout.length }}
      fresh={{ papers: newPapers, boards: boards.some((b) => b.is_new), digs: newTalk }}
    />
  );
  const seats = project.is_member ? (
    <div className="project-seats">
      {open && <People project={project} showing={open} currentUser={currentUser} act={act} onLeft={onLeft} onClose={() => setPeopleOpen(false)} />}
      <div className="project-seat-row" aria-label={`${count}: ${people.map((u) => u.display_name).join(', ')}`}>
        {people.slice(0, 5).map((user) => (
          <a className="project-seat" key={user.uuid} href={appPath(`/u/${user.uuid}`)} title={user.display_name}>
            <Avatar user={user} className="mini-avatar" />
            <small>{user.uuid === currentUser?.uuid ? 'You' : firstName(user)}</small>
          </a>
        ))}
        <button
          type="button" className="project-seat-more" aria-label="Members" aria-expanded={open === 'people'} aria-controls="project-people"
          onClick={() => setPeopleOpen(open === 'people' ? false : 'people')}
        >
          {people.length > 5 ? `+${people.length - 5}` : <ActionGlyph name="more" />}
        </button>
      </div>
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

  // In the Mac app a member's desk has no header: its name and its people
  // sit in the window's toolbar, and the sidebar is the way back. Its three
  // views stay with the page they change, over the list, as on the web.
  const inToolbar = DESKTOP && project.is_member;

  return (
    <div className={`project-page${project.is_member ? ' is-desk' : ''}`}>
      {inToolbar ? (
        <>
          <InToolbar>
            <div className="project-toolbar talk-host" data-toolbar-title>
              <div className="project-title-line">
                {title}
                <ExperimentalBadge />
              </div>
              {about}
            </div>
            {seats}
          </InToolbar>
          {tabs}
        </>
      ) : (
        <>
          <header className="project-head talk-host">
            <InWay>
              <div className="project-title-row">
                <div className="project-title-line">
                  {title}
                  <ExperimentalBadge />
                </div>
                {about}
              </div>
              {seats}
            </InWay>
            {tabs}
          </header>
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
                hasNews={hasNews}
                currentUser={currentUser}
                picked={picked}
                onPick={pick}
                onChanged={reload}
                onRead={onRead}
              />
            )}
            {view === 'boards' && (
              <ProjectBoards
                project={project} board={board} act={act} hasNews={hasNews} currentUser={currentUser}
                onOpenBoard={onOpenBoard} onOpenCanvas={onOpenCanvas} onChanged={talked}
              />
            )}
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
    const away = (e) => { if (!self.current?.contains(e.target) && !e.target.closest('.project-seat-more, .project-invite-open')) onClose(); };
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
      {showing === 'invite' && project.is_keeper && <>
        <AddPerson project={project} act={act} />
        <Invitation project={project} act={act} />
      </>}
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

// Someone already in Papol, found by name or by their whole address, is a
// member the moment a keeper picks them.
function AddPerson({ project, act }) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState([]);
  const input = useRef(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    const asked = query.trim();
    if (!asked) { setFound([]); return undefined; }
    let live = true;
    const timer = setTimeout(() => {
      findPeople(project.uuid, asked).then((people) => { if (live) setFound(people); }).catch(() => { if (live) setFound([]); });
    }, 150);
    return () => { live = false; clearTimeout(timer); };
  }, [project.uuid, project.members.length, query]);
  const add = async (user) => {
    if (await act(() => addMember(project.uuid, user.uuid))) {
      setQuery('');
      input.current?.focus();
    }
  };
  return (
    <div className="project-add">
      <input
        ref={input} type="search" className="project-add-field" value={query} aria-label="Name or email" placeholder="Name or email"
        autoComplete="off" spellCheck={false}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && found.length === 1) { e.preventDefault(); add(found[0]); } }}
      />
      {found.length > 0 && (
        <ul className="project-people-list project-add-found">
          {found.map((user) => (
            <li key={user.uuid} className="project-person">
              <Face user={user} />
              <span className="project-person-name">{user.display_name}</span>
              {user.affiliation && <span className="project-person-role">{user.affiliation}</span>}
              <span className="project-person-actions">
                <button type="button" onClick={() => add(user)}>Add</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// The one invitation link a project has, for a keeper to hand out or stop.
function Invitation({ project, act }) {
  const [copied, setCopied] = useState(false);
  // On the service's address, not this window's, which on the Mac is the app's.
  const linkFor = (code) => new URL(backendPath(invitationPath(code)), window.location.origin).toString();
  const link = project.invite_code ? linkFor(project.invite_code) : null;
  const copy = async (text) => {
    try { await copyText(text); setCopied(true); } catch { /* the link can be selected by hand */ }
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

// Papers, Boards, Digs: each with its count, and the news dot when
// something in it is new since the last visit.
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
          {fresh[v] && <NewsDot />}
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
function ProjectPapers({ project, currentUser, hasNews, picked, onPick, onChanged, onRead }) {
  const isMe = (user) => user.uuid === currentUser?.uuid;
  const wide = useWide();
  const papers = project.papers;
  // Beside the list there is always a brief: the one picked, else the first
  // new paper, else the top one. Under a row it is only the one picked.
  const chosen = papers.find((p) => p.sha256 === picked)
    ?? (wide ? papers.find((p) => p.is_new) ?? papers[0] : null);
  if (!papers.length) return <section className="project-section" aria-label="Papers" />;
  // What is new in each of the paper's digs, by dig.
  const unreadOn = (paper) => Object.fromEntries((project.digs ?? [])
    .filter((d) => d.subject.key === `paper:${paper.sha256}`)
    .map((d) => [d.uuid, Number(d.unread ?? 0)]));
  const brief = (paper) => (
    <PaperBrief
      key={paper.sha256} project={project} paper={paper} currentUser={currentUser} underRow={!wide}
      unread={unreadOn(paper)} onChanged={onChanged} onRead={onRead}
    />
  );
  const move = (e) => {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!step || !chosen || e.target.closest('input, textarea, [contenteditable]:not([contenteditable="false"])')) return;
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
                className={`project-row project-paper${selected ? ' is-selected' : ''}`}
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
                  {(paper.is_new || hasNews((subject) => subject.paper_sha256 === paper.sha256 && !(selected && subject.kind === 'paper'))) && <NewsDot />}
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

// Digs still digging lead, unheaded; gold and stashed ones follow in bands
// of their own, each by latest writing. Stashed starts folded; how
// each band is folded is kept per viewer and project.
const foldKey = (projectUuid) => `papol:dig-bands:${projectUuid}`;

function useFolded(projectUuid) {
  const [folded, setFolded] = useState(() => {
    try { return JSON.parse(localStorage.getItem(foldKey(projectUuid))) ?? { stashed: true }; } catch { return { stashed: true }; }
  });
  const toggle = (phase, to = !folded[phase]) => {
    const next = { ...folded, [phase]: to };
    setFolded(next);
    try { localStorage.setItem(foldKey(projectUuid), JSON.stringify(next)); } catch { /* folded for this visit */ }
  };
  return [folded, toggle];
}

function ProjectTalk({ project, currentUser, onTalked, onRead, onOpenPaper }) {
  const all = [...(project.digs ?? [])].sort((a, b) => phaseRank(a.phase) - phaseRank(b.phase));
  const [folded, fold] = useFolded(project.uuid);
  const phaseOf = (d) => d.phase ?? 'digging';
  // The digs in view: those in open bands. Keys walk these alone.
  const discussions = all.filter((d) => !folded[phaseOf(d)]);
  const wide = useWide();
  // A dig opens right here, never on a page of its own. On a wide window
  // the list stays put and the dig opens beside it: on arrival the first
  // unread one, else the latest. Narrower, it opens under its row, and a
  // second press folds it. Read when the selection moves on.
  const [picked, setPicked] = useState(() => (wide ? (discussions.find((d) => d.is_new) ?? discussions[0])?.uuid ?? null : null));
  const shown = all.find((d) => d.uuid === picked) ?? (wide ? discussions[0] : null) ?? null;
  // A dig moved into a folded band keeps its band open.
  const shownPhase = shown && phaseOf(shown);
  useEffect(() => { if (shownPhase && folded[shownPhase]) fold(shownPhase, false); }, [shown?.uuid, shownPhase]);
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
        ) : subjectHome(project, d.subject, d.uuid)
          ? <a href={appPath(subjectHome(project, d.subject, d.uuid))} data-document={d.subject.kind === 'annotation' || undefined}><PaperTitle title={d.subject.label} /></a>
          : <span><PaperTitle title={d.subject.label} /></span>}
      </h3>
      <DigThread
        key={d.uuid}
        projectUuid={project.uuid} subject={d.subject.key} label={d.subject.label} dig={d.uuid} currentUser={currentUser} onChanged={onTalked}
      />
    </>
  );
  // A row is one dig: what it is about first, then whose it is.
  const row = (d) => {
    const kind = d.subject.kind;
    return (
      <>
        <span className="project-talk-subject">
          <span className="project-card-kind">{SUBJECT_WORDS[kind]}</span>
          <span className="project-talk-label"><PaperTitle title={d.subject.label} /></span>
        </span>
        <span className="project-talk-meta">
          {d.owner && <Avatar user={d.owner} className="mini-avatar" />}
          <span>{d.is_mine ? 'You' : d.owner?.display_name}</span>
          <span>· {when(d.updated_at)}</span>
        </span>
        {d.is_new && <NewsDot />}
      </>
    );
  };
  const item = (d) => (
    <li key={d.uuid}>
      <button
        type="button" data-dig={d.uuid} aria-pressed={shown?.uuid === d.uuid}
        className={`project-talk-item${shown?.uuid === d.uuid ? ' is-selected' : ''}`}
        onClick={() => pick(d.uuid)}
      >
        {row(d)}
      </button>
      {!wide && shown?.uuid === d.uuid && <div className="project-talk-panel">{pane(d)}</div>}
    </li>
  );
  const bands = PHASES.map((p) => [p, all.filter((d) => phaseOf(d) === p.key)]).filter(([, digs]) => digs.length);
  return (
    <section className={`project-talk${wide ? ' is-wide' : ''}`} aria-label="Digs">
      {all.length > 0 && (
        <div className="project-talk-bands" onKeyDown={wide ? move : undefined}>
          {bands.map(([p, digs]) => (
            <section key={p.key} className={`project-talk-band is-${p.key}`} aria-label={p.word}>
              {p.key !== 'digging' && (
                <button type="button" className="project-talk-band-head" aria-expanded={!folded[p.key]} onClick={() => fold(p.key)}>
                  <svg className="project-talk-band-fold" viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 2 6.5 5 3.5 8" /></svg>
                  <PhaseGlyph phase={p.key} />{p.word}
                  <span className="project-talk-band-count">{digs.length}</span>
                </button>
              )}
              {!folded[p.key] && <ul className="project-talk-list">{digs.map(item)}</ul>}
            </section>
          ))}
        </div>
      )}
      {wide && shown && <div className="project-talk-panel">{pane(shown)}</div>}
    </section>
  );
}

// Where a card's or an annotation's dig subject lives: the board a card is
// on, the viewer at an annotation with the dig open. A paper's is its
// brief, on this page.
function subjectHome(project, subject, dig) {
  if (subject.kind === 'annotation') return annotationViewerPath(project.uuid, subject.paper_sha256, { annotation: subject.annotation_uuid, dig });
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

// The project's boards, which every member arranges, as a list read like
// the papers: each board by its name, what its newest card says and who
// put it there. A board picked here opens its jacket beside the list on a
// wide window, under its row on a narrow one, and has the address of its
// own; the canvas is the jacket's way in. On a wide window there is always
// a jacket beside the list: the one picked, else the first new board,
// else the latest. The last row makes one more.
function ProjectBoards({ project, board, act, hasNews, currentUser, onOpenBoard, onOpenCanvas, onChanged }) {
  const wide = useWide();
  const boards = project.boards ?? [];
  const chosen = boards.find((b) => b.uuid === board)
    ?? (wide ? boards.find((b) => b.is_new) ?? boards[0] : null);
  // Moving from one board to the next replaces the address, so Back
  // leaves the tab rather than walking through every board looked at.
  const pick = (uuid) => onOpenBoard(uuid, board ? { replace: true } : undefined);
  const isMe = (user) => user.uuid === currentUser?.uuid;
  const jacket = (b) => (
    <BoardJacket
      key={b.uuid}
      boardUuid={b.uuid}
      onOpen={onOpenCanvas}
      hideBack
      held
      onChanged={onChanged}
      onDeleted={() => { onChanged(); onOpenBoard(null, { replace: true }); }}
    />
  );
  const move = (e) => {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!step || !chosen || e.target.closest('input, textarea, [contenteditable]:not([contenteditable="false"])')) return;
    e.preventDefault();
    const at = boards.findIndex((b) => b.uuid === chosen.uuid);
    const next = boards[Math.max(0, Math.min(boards.length - 1, at + step))];
    pick(next.uuid);
    e.currentTarget.querySelector(`[data-board="${next.uuid}"]`)?.focus();
  };
  return (
    <section className={`project-section project-papers-view project-boards-view${wide ? ' is-wide' : ''}`} aria-label="Boards">
      <ul className="project-papers project-boards project-rows" onKeyDown={wide ? move : undefined}>
        {boards.map((b) => {
          const selected = chosen?.uuid === b.uuid;
          // A narrow window folds the jacket away again on a second press.
          const choose = () => (selected && !wide ? onOpenBoard(null, { replace: true }) : pick(b.uuid));
          const latest = b.latest_card;
          const who = latest ? latest.added_by : b.owner;
          return (
            <React.Fragment key={b.uuid}>
              <li
                data-subject={`board:${b.uuid}`}
                className={`project-row project-board${selected ? ' is-selected' : ''}`}
                onClick={(e) => { if (!e.target.closest('a, button, input, textarea')) choose(); }}
              >
                <div className="project-row-text">
                  <h4 className="project-card-title">
                    <button
                      type="button" className="project-row-open" data-board={b.uuid}
                      aria-expanded={wide ? undefined : selected} aria-pressed={wide ? selected : undefined}
                      onClick={choose}
                    >
                      {b.name}
                    </button>
                  </h4>
                  {latest?.text && <p className="project-card-authors project-board-latest">{latest.text}</p>}
                </div>
                <span className="project-row-facts">
                  <span className="project-card-added">
                    {who && <>{isMe(who) ? 'You' : firstName(who)} {latest ? 'added' : 'made it'} · </>}
                    {when(latest ? latest.added_at : b.created_at ?? b.updated_at)}
                  </span>
                </span>
                <span className="project-row-end">
                  {(b.is_new || hasNews((subject) => subject.board_uuid === b.uuid)) && <NewsDot />}
                </span>
              </li>
              {!wide && selected && <li className="project-board-open">{jacket(b)}</li>}
            </React.Fragment>
          );
        })}
        <NewBoard project={project} act={act} onMade={(uuid) => pick(uuid)} />
      </ul>
      {wide && chosen && <div className="project-papers-panel project-boards-panel">{jacket(chosen)}</div>}
    </section>
  );
}

// The last row of the Boards tab: pressed, it takes the new board's name
// in place, and Enter makes it and opens it. Escape, or leaving it empty,
// puts the row back.
function NewBoard({ project, act, onMade }) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const stop = () => { setNaming(false); setName(''); };
  const create = async (e) => {
    e.preventDefault();
    const next = name.trim();
    if (!next || busy) return;
    setBusy(true);
    const made = await act(() => createProjectBoard(project.uuid, next));
    setBusy(false);
    if (made) { stop(); onMade(made.uuid); }
  };
  return (
    <li className="project-row project-board-new">
      {naming ? (
        <form className="project-board-new-form" onSubmit={create}>
          <ActionGlyph name="plus" />
          <input
            className="project-board-name" autoFocus value={name} maxLength={200} placeholder="Board name" aria-label="Board name"
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => { if (!name.trim()) stop(); }}
            onKeyDown={(e) => { if (e.key === 'Escape') stop(); }}
          />
        </form>
      ) : (
        <button type="button" className="project-board-add" onClick={() => setNaming(true)}>
          <ActionGlyph name="plus" />New board
        </button>
      )}
    </li>
  );
}

// What the project is about, one quiet line in the bar under its name: a
// keeper writes it in place, kept when left, taken back with Escape; the
// whole of a long one shows on pointing at it. With none, a member who is
// not a keeper sees nothing.
function ProjectDescription({ project, onDescribe }) {
  const saved = project.description ?? '';
  const [text, setText] = useState(saved);
  const reverting = useRef(false);
  useEffect(() => setText(saved), [saved]);
  if (!project.is_keeper) return saved ? <p className="project-description" title={saved}>{saved}</p> : null;
  const keep = async () => {
    if (reverting.current) { reverting.current = false; return; }
    if (text.trim() === saved) { setText(saved); return; }
    if (!(await onDescribe(text))) setText(saved);
  };
  return (
    <input
      className="project-description project-description-input" value={text} title={saved || undefined}
      maxLength={appLimits.text.project_description} placeholder="Description" aria-label="Project description"
      onChange={(e) => setText(e.target.value)}
      onBlur={keep}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { reverting.current = true; setText(saved); e.currentTarget.blur(); }
      }}
    />
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
