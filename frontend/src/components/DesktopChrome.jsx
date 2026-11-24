import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Working } from '../../../shared/ui/Waiting.js';
import NewsDot from '../../../shared/ui/NewsDot.jsx';
import Avatar from './Avatar';
import Glyph from './DesktopGlyph';
import { PAPER_DRAG_TYPE, isBrowsing, listingPath } from '../desktopListings';
import { KINDS, narrowed } from '../loungeStore';
import { appPath } from '../base';
import { DESKTOP, MAC } from '../../../shared/desktopShell';
import { getSyncStatus, OFFLINE_MODE_MESSAGE } from '../../../shared/connectivity.js';
import {
  nativeDataActive, nativeRepository, nativeSyncInProgress, subscribeNativeData,
  syncAllNow, recordDiagnosticEvent,
} from '../../../shared/nativeData.js';
import { unexpectedDesktopErrorReport } from '../../../shared/errorReport.js';
import { unrecoverableSyncReport } from '../syncDiagnostics.js';
import { syncFailureText } from '../../../shared/syncFailure.js';

// The sidebar and toolbar that stand in for the website masthead inside
// Papol macOS (see DESIGN.md, "Desktop shell"). Destinations are ordinary
// same-origin anchors, so the app routes them like any other link.

const MOD = MAC ? '⌘' : 'Ctrl+';

// The window is in one of two modes, the member's nook or the Lounge, and
// the switch at the top of the sidebar moves between them (⌘1, ⌘2). The
// nook's sidebar lists its shelves, tags and projects; the Lounge's lists
// its friends and what to show, the rail the Lounge has on the web. Pages
// opened from either (a paper, a friend's nook, the Inbox) keep the mode
// they were opened in.
export function desktopModes({ mode, nookPath = '/', roomNews = false }) {
  return [
    { key: 'nook', label: 'My nook', path: nookPath, glyph: 'nook', shortcut: '1', active: mode === 'nook' },
    { key: 'room', label: 'Lounge', path: '/lounge', glyph: 'room', shortcut: '2', active: mode === 'lounge', news: roomNews && mode !== 'lounge' },
  ];
}

const KIND_GLYPHS = { '': 'room', paper: 'papers', board: 'boards', project: 'folder' };

// The Lounge's rail as sidebar rows: whose news, then what kind. A row
// narrows the Lounge, and leads there from wherever the member is.
function loungeNavigation({ route, lounge, friends = [], onPick }) {
  const inRoom = route.page === 'room';
  const who = friends.some((f) => f.user.uuid === lounge.who) ? lounge.who : '';
  const counted = (kind) => (lounge.rows ? narrowed(lounge.rows, { kind, who }).length : undefined);
  return [
    {
      label: 'Friends',
      find: true,
      items: [
        { key: 'friends', label: 'All friends', glyph: 'room', active: inRoom && !who, count: friends.length, onSelect: () => onPick({ who: '' }) },
        ...friends.map(({ user }) => ({
          key: `friend:${user.uuid}`,
          label: user.display_name,
          person: user,
          active: inRoom && who === user.uuid,
          onSelect: () => onPick({ who: who === user.uuid ? '' : user.uuid }),
        })),
      ],
    },
    {
      label: 'Show',
      items: KINDS.map(([kind, name]) => ({
        key: `kind:${kind || 'all'}`,
        label: name,
        glyph: KIND_GLYPHS[kind],
        active: inRoom && lounge.kind === kind,
        count: counted(kind),
        onSelect: () => onPick({ kind }),
      })),
    },
  ];
}

// The sidebar's destinations, in groups. Items numbered with `shortcut`
// are also reachable with ⌘3…⌘4; ⌘1 and ⌘2 are the modes.
export function desktopNavigation({
  user, route, unreadCount, projects = [], nook, listing,
  mode = 'nook', lounge = null, friends = [], onPickLounge = () => {},
}) {
  const page = route.page;
  if (!user) {
    return [
      {
        items: [
          { key: 'signin', label: 'Sign in', path: '/signin', glyph: 'signin', shortcut: '1', active: page === 'signin' || page === 'home' },
          { key: 'join', label: 'Create account', path: '/join', glyph: 'join', shortcut: '2', active: page === 'join' },
        ],
      },
      {
        label: 'Discover',
        items: [
          { key: 'learn', label: 'Learn', path: '/learn', glyph: 'learn', shortcut: '3', active: page === 'learn' },
        ],
      },
    ];
  }
  const papol = {
    label: 'Papol',
    items: [
      { key: 'inbox', label: 'Inbox', path: '/inbox', glyph: 'inbox', shortcut: '3', active: page === 'inbox', count: unreadCount, unread: true },
      { key: 'learn', label: 'Learn', path: '/learn', glyph: 'learn', shortcut: '4', active: page === 'learn' },
      ...(user.is_admin
        ? [{ key: 'admin', label: 'Admin', path: '/admin', glyph: 'admin', active: page === 'admin' }]
        : []),
    ],
  };
  if (mode === 'lounge' && lounge) {
    return [...loungeNavigation({ route, lounge, friends, onPick: onPickLounge }), papol];
  }
  const browsing = isBrowsing(route, user);
  const at = (key) => browsing && listing === key;
  // One shelf is the whole nook, so it only earns rows once there are two.
  const shelves = nook?.shelves.length > 1 ? nook.shelves : [];
  const tags = nook?.tags || [];
  return [
    {
      label: 'My nook',
      manage: true,
      items: [
        { key: 'all', label: 'All papers', path: listingPath('all'), glyph: 'papers', active: at('all'), count: nook?.papers.length },
        ...shelves.map((shelf) => ({
          key: `shelf:${shelf.uuid}`,
          label: shelf.name,
          title: `${shelf.name} · ${shelf.is_public ? 'Public' : 'Private'}`,
          path: listingPath(`shelf:${shelf.uuid}`),
          shelfUuid: shelf.uuid,
          swatch: shelf.color,
          active: at(`shelf:${shelf.uuid}`),
          count: shelf.paper_count,
        })),
        { key: 'boards', label: 'Boards', path: listingPath('boards'), glyph: 'boards', active: at('boards'), count: nook?.boards.length },
      ],
    },
    ...(tags.length > 0 ? [{
      label: 'Tags',
      items: tags.map((tag) => ({
        key: `tag:${tag.uuid}`,
        label: tag.name,
        path: listingPath(`tag:${tag.uuid}`),
        hash: true,
        active: at(`tag:${tag.uuid}`),
      })),
    }] : []),
    // Each project is a place of its own, like a shelf; the last row leads
    // to all of them, and to starting one.
    {
      label: 'Projects',
      items: [
        ...projects.map((project) => ({
          key: `project:${project.uuid}`,
          label: project.name,
          path: `/project/${project.uuid}`,
          glyph: 'folder',
          active: page === 'project' && route.uuid === project.uuid,
          news: project.new_count > 0,
        })),
        {
          key: 'projects',
          label: projects.length ? 'All projects' : 'Projects',
          path: '/projects',
          glyph: projects.length ? 'projects' : 'folder',
          active: ['projects', 'invitation'].includes(page),
        },
      ],
    },
    papol,
  ];
}

const TITLES = {
  nook: 'Nook',
  paper: 'Paper',
  room: 'Lounge',
  projects: 'Projects',
  project: 'Project',
  invitation: 'Invitation',
  inbox: 'Inbox',
  admin: 'Admin',
  about: 'About Papol',
  learn: 'Learn',
  join: 'Create account',
  signin: 'Sign in',
  profile: 'Settings',
};

// A project's pages carry its name, which says more than the word Project.
export function desktopTitle(route, user, projects = []) {
  if (route.page === 'home') return user ? 'My nook' : 'Sign in';
  if (route.page === 'project') {
    const project = projects.find((p) => p.uuid === route.uuid);
    if (project) return project.name;
  }
  return TITLES[route.page] || 'Papol';
}

function ItemMark({ item }) {
  if (item.person) return <Avatar user={item.person} className="desktop-sidebar-face" />;
  if (item.swatch) return <span className="desktop-sidebar-swatch" style={{ background: item.swatch }} aria-hidden="true" />;
  if (item.hash) return <span className="desktop-sidebar-hash" aria-hidden="true">#</span>;
  return <Glyph name={item.glyph} />;
}

function SyncControl({ onReportableError, onSynced }) {
  const [status, setStatus] = useState(() => ({ ...getSyncStatus(), syncing: nativeSyncInProgress() }));
  const reportedErrors = useRef(new Set());
  // The coordinator's process-wide latch, as last heard from a native start/stop
  // event or read back from the sync status query.
  const processSyncing = useRef(false);

  // Whether a sync is running, from every source that knows: the last
  // process-wide latch, the window's own lifecycle (a sync it started before
  // the native start event arrives, or that never reaches the coordinator),
  // and the web status. Reading the latch fresh on every status query keeps
  // the glyph turning for a sync that started before this control mounted.
  const syncRunning = (web, local) => {
    if (typeof local?.syncing === 'boolean') processSyncing.current = local.syncing;
    return Boolean(web.syncing || processSyncing.current || nativeSyncInProgress());
  };

  useEffect(() => {
    const offer = (report) => {
      if (!report || reportedErrors.current.has(report.signature)) return;
      reportedErrors.current.add(report.signature);
      void recordDiagnosticEvent({
        level: 'error', component: 'sync', event: 'reportable_error',
        message: report.content,
      });
      onReportableError?.(report);
    };
    const update = async () => {
      const web = getSyncStatus();
      if (!nativeDataActive()) { setStatus({ ...web, syncing: syncRunning(web) }); return; }
      try {
        const local = await nativeRepository.syncStatus();
        const report = unrecoverableSyncReport(local, {
          surface: window.__PAPOL_ENV__?.surface,
          platform: navigator.platform,
        });
        offer(report);
        setStatus({
          ...web,
          syncing: syncRunning(web, local),
          pending: local.pending,
          error: web.error || local.error || local.outbox_error || null,
          conflicts: local.conflicts,
        });
      } catch (error) {
        setStatus({ ...web, syncing: syncRunning(web) });
        offer(unexpectedDesktopErrorReport(error, 'reading native sync status', {
          surface: window.__PAPOL_ENV__?.surface,
          platform: navigator.platform,
        }));
      }
    };
    window.addEventListener('papol-offline-status', update);
    const unsubscribeNative = subscribeNativeData((nativeStatus) => {
      if (typeof nativeStatus?.syncing === 'boolean') processSyncing.current = nativeStatus.syncing;
      update();
    });
    update();
    return () => {
      unsubscribeNative();
      window.removeEventListener('papol-offline-status', update);
    };
  }, []);

  const syncNow = async () => {
    setStatus((current) => ({ ...current, syncing: true, error: null }));
    const failure = await syncAllNow();
    // Another sync may still be running (one scheduled behind this one, or
    // started from another window), so ask rather than assume it is over.
    const web = getSyncStatus();
    const latest = { ...web, syncing: syncRunning(web), pending: 0 };
    if (failure) latest.error = failure;
    if (nativeDataActive()) {
      try {
        const local = await nativeRepository.syncStatus();
        latest.syncing = syncRunning(web, local);
        latest.pending = local.pending;
        latest.error ||= local.error || local.outbox_error;
        latest.conflicts = local.conflicts;
      } catch { /* retain the last known native status */ }
    }
    setStatus(latest);
    if (!latest.error && latest.pending === 0) onSynced?.();
  };

  const summary = status.syncing
    ? 'Syncing…'
    : status.offline
      ? `Offline${status.pending ? ` · ${status.pending} pending` : ''}`
      : status.error || status.conflicts
        ? 'Needs attention'
        : status.pending
        ? `${status.pending} pending`
        : 'Up to date';

  return (
    <section id="desktop-sync-control" className={`desktop-sync-control${status.error ? ' has-error' : ''}`} aria-label="Synchronization">
      <button
        type="button"
        className="desktop-sync-button"
        onClick={syncNow}
        disabled={status.syncing}
        aria-label={`Sync now — ${summary}`}
        title={status.offline ? OFFLINE_MODE_MESSAGE : (syncFailureText(status.error) || 'Send and receive changes now')}
      >
        <span className={`desktop-sync-mark${status.syncing ? ' spinning' : ''}`} aria-hidden="true">↻</span>
        <span>{status.syncing ? 'Syncing…' : status.offline ? 'Offline — Sync' : 'Sync'}</span>
      </button>
    </section>
  );
}

// The two modes, as a segmented control under the traffic lights.
function ModeSwitch({ modes }) {
  return (
    <nav className="desktop-mode" aria-label="Mode">
      {modes.map((item) => (
        <a
          key={item.key}
          href={appPath(item.path)}
          className={`desktop-mode-item${item.active ? ' active' : ''}`}
          aria-current={item.active ? 'page' : undefined}
          title={`${item.label} (${MOD}${item.shortcut})`}
          draggable="false"
        >
          <Glyph name={item.glyph} />
          <span className="desktop-mode-word">{item.label}</span>
          {item.news && <NewsDot />}
        </a>
      ))}
    </nav>
  );
}

export function DesktopSidebar({ groups, modes, user, profileActive, finding = false, onFeedback, onFind, onManageNook, onMovePaper, onNavigate, onReportableError, onSync, notice }) {
  const [dropKey, setDropKey] = useState(null);
  // Shelves accept a paper dragged from the list, the way a Finder sidebar
  // accepts files: the shelf lights up under the pointer and takes the paper
  // on release.
  const shelfDropProps = (item) => {
    if (item.shelfUuid == null || !onMovePaper) return {};
    const carriesPaper = (event) => Array.from(event.dataTransfer.types).includes(PAPER_DRAG_TYPE);
    const over = (event) => {
      if (!carriesPaper(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setDropKey(item.key);
    };
    return {
      onDragEnter: over,
      onDragOver: over,
      onDragLeave: (event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        setDropKey((current) => (current === item.key ? null : current));
      },
      onDrop: (event) => {
        if (!carriesPaper(event)) return;
        event.preventDefault();
        setDropKey(null);
        const { sha256, shelfUuid } = JSON.parse(event.dataTransfer.getData(PAPER_DRAG_TYPE));
        if (shelfUuid !== item.shelfUuid) onMovePaper(sha256, item.shelfUuid);
      },
    };
  };

  return (
    <aside className="desktop-sidebar">
      {/* The strip under the traffic lights moves the window. */}
      <div className="desktop-sidebar-drag" data-tauri-drag-region />
      {modes && <ModeSwitch modes={modes} />}
      <div className="desktop-sidebar-list">
        {groups.map((group, index) => (
          <nav className="desktop-sidebar-group" key={group.label || index} aria-label={group.label || 'Main'}>
            {group.label && (
              <div className="desktop-sidebar-label">
                <span>{group.label}</span>
                {group.manage && onManageNook && (
                  <button
                    type="button"
                    className="desktop-sidebar-label-action"
                    onClick={onManageNook}
                    title="Manage nook"
                    aria-label="Manage nook"
                  >
                    <Glyph name="manage" />
                  </button>
                )}
                {group.find && onFind && (
                  <button
                    type="button"
                    className={`desktop-sidebar-label-action${finding ? ' active' : ''}`}
                    onClick={onFind}
                    aria-pressed={finding}
                    title="Find someone"
                    aria-label="Find someone"
                  >
                    <Glyph name="join" />
                  </button>
                )}
              </div>
            )}
            {group.items.map((item) => {
              // A row that narrows the Lounge is a button; one that goes
              // somewhere is a link.
              const Row = item.onSelect ? 'button' : 'a';
              const where = item.onSelect
                ? { type: 'button', onClick: item.onSelect, 'aria-pressed': item.active }
                : { href: appPath(item.path), 'aria-current': item.active ? 'page' : undefined, draggable: 'false' };
              return (
              <Row
                key={item.key}
                {...where}
                className={`desktop-sidebar-item${item.active ? ' active' : ''}${dropKey === item.key ? ' drop-target' : ''}`}
                title={item.shortcut ? `${item.title || item.label} (${MOD}${item.shortcut})` : item.title}
                {...shelfDropProps(item)}
              >
                <ItemMark item={item} />
                <span className="desktop-sidebar-text">{item.label}</span>
                {item.news && <NewsDot />}
                {item.count > 0 && (
                  <span
                    className={`desktop-sidebar-count${item.unread ? ' unread' : ''}`}
                    aria-label={item.unread ? `${item.count} unread` : undefined}
                  >
                    {item.count}
                  </span>
                )}
              </Row>
              );
            })}
          </nav>
        ))}
        {notice && <p className="desktop-sidebar-notice" role="alert">{notice}</p>}
      </div>
      <div className="desktop-sidebar-footer">
        <button type="button" className="desktop-sidebar-item" onClick={onFeedback}>
          <Glyph name="feedback" />
          <span className="desktop-sidebar-text">Feedback</span>
        </button>
        {user && (
          <div className="desktop-sidebar-account">
            <a
              href={appPath('/profile')}
              className={`desktop-sidebar-item desktop-sidebar-profile${profileActive ? ' active' : ''}`}
              aria-current={profileActive ? 'page' : undefined}
              title="Edit profile"
              draggable="false"
            >
              <Avatar user={user} className="desktop-sidebar-avatar" />
              <span className="desktop-sidebar-text">{user.display_name}</span>
            </a>
            <SyncControl onReportableError={onReportableError} onSynced={onSync} />
          </div>
        )}
      </div>
    </aside>
  );
}

// ⌘1…⌘4 open the modes and the sidebar's numbered rows. Papol has no
// in-app history to walk, so there is no Back or Forward: the sidebar is
// how a user moves.
export function useDesktopShortcuts({ groups, modes = [], onNavigate }) {
  const latest = useRef(null);
  latest.current = {
    items: [...modes, ...groups.flatMap((group) => group.items)].filter((item) => item.shortcut),
    onNavigate,
  };

  useEffect(() => {
    if (!DESKTOP) return undefined;
    const onKey = (event) => {
      if (event.defaultPrevented || event.altKey || event.shiftKey) return;
      if (!(MAC ? event.metaKey : event.ctrlKey)) return;
      const current = latest.current;
      const item = current.items.find((entry) => entry.shortcut === event.key);
      if (!item) return;
      event.preventDefault();
      current.onNavigate(item.path);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

// A page's toolbar: its title, in the strip that moves the window, and a
// slot a page fills with its own controls through InToolbar, so a page in
// the Mac app needs no header of its own.
//
// `back` is where a page opened on its own came from (the Lounge, for a
// paper opened in Lounge mode): a step back to it, ahead of the title.
export function DesktopToolbar({ title, back = null }) {
  return (
    <header className="desktop-toolbar" data-tauri-drag-region="deep">
      {back && (
        <button type="button" className="desktop-toolbar-back" onClick={back.onBack} title={`Back to ${back.label} (⌘[)`}>
          <span aria-hidden="true">‹</span>{back.label}
        </button>
      )}
      {title && <h1 className="desktop-toolbar-title">{title}</h1>}
      <div className="desktop-toolbar-slot" id="desktop-toolbar-slot" />
    </header>
  );
}

// What a page puts in the toolbar. A page that brings its own title marks
// it data-toolbar-title, and the toolbar's plain title steps aside.
export function InToolbar({ children }) {
  const [slot, setSlot] = useState(null);
  useEffect(() => { setSlot(document.getElementById('desktop-toolbar-slot')); }, []);
  return slot ? createPortal(children, slot) : null;
}
