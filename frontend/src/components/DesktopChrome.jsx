import React, { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar';
import Glyph from './DesktopGlyph';
import { PAPER_DRAG_TYPE, isBrowsing, sourcePath } from '../desktopSources';
import { appPath } from '../base';
import { DESKTOP, MAC } from '../../../shared/desktopShell';
import { contextMenuHandler } from '../../../shared/contextMenu';
import {
  getSyncStatus, OFFLINE_MODE_MESSAGE, refreshSyncStatus,
} from '../../../shared/connectivity.js';
import {
  nativeDataActive, nativeRepository, nativeSyncInProgress, subscribeNativeData,
  syncAllNow, recordDiagnosticEvent,
} from '../../../shared/nativeData.js';
import {
  unexpectedDesktopErrorReport, unrecoverableSyncReport,
} from '../syncDiagnostics.js';

// The sidebar and toolbar that stand in for the website masthead inside
// Papol macOS (see DESIGN.md, "Desktop shell"). Destinations are ordinary
// same-origin anchors, so the app routes them like any other link.

const MOD = MAC ? '⌘' : 'Ctrl+';

// The sidebar's destinations, in groups. Items numbered with `shortcut`
// are also reachable with ⌘1…⌘4.
export function desktopNavigation({ user, route, unreadCount, space, source }) {
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
          { key: 'demo', label: 'Try the demo', path: '/demo', glyph: 'demo' },
        ],
      },
    ];
  }
  const browsing = isBrowsing(route, user);
  const at = (key) => browsing && source === key;
  // One shelf is the whole nook, so it only earns rows once there are two.
  const shelves = space?.shelves?.length > 1 ? space.shelves : [];
  const tags = space?.tags || [];
  return [
    {
      label: 'My nook',
      manage: true,
      items: [
        { key: 'all', label: 'All papers', path: sourcePath('all'), glyph: 'papers', shortcut: '1', active: at('all'), count: space?.papers.length },
        ...shelves.map((shelf) => ({
          key: `shelf:${shelf.uuid}`,
          label: shelf.name,
          title: `${shelf.name} · ${shelf.is_public ? 'Public' : 'Private'}`,
          path: sourcePath(`shelf:${shelf.uuid}`),
          shelfUuid: shelf.uuid,
          swatch: shelf.color,
          active: at(`shelf:${shelf.uuid}`),
          count: shelf.paper_count,
        })),
        { key: 'boards', label: 'Boards', path: sourcePath('boards'), glyph: 'boards', active: at('boards'), count: space?.boards?.length },
      ],
    },
    ...(tags.length > 0 ? [{
      label: 'Tags',
      items: tags.map((tag) => ({
        key: `tag:${tag.uuid}`,
        label: tag.name,
        path: sourcePath(`tag:${tag.uuid}`),
        hash: true,
        active: at(`tag:${tag.uuid}`),
      })),
    }] : []),
    {
      label: 'Papol',
      items: [
        { key: 'library', label: 'Library', path: '/library', glyph: 'library', shortcut: '2', active: at('library') },
        { key: 'inbox', label: 'Inbox', path: '/inbox', glyph: 'inbox', shortcut: '3', active: page === 'inbox', count: unreadCount, unread: true },
        { key: 'learn', label: 'Learn', path: '/learn', glyph: 'learn', shortcut: '4', active: page === 'learn' },
        ...(user.is_admin
          ? [{ key: 'admin', label: 'Admin', path: '/admin', glyph: 'admin', active: page === 'admin' }]
          : []),
      ],
    },
  ];
}

const TITLES = {
  space: 'Nook',
  paper: 'Paper',
  papers: 'Library',
  room: 'Seminar',
  inbox: 'Inbox',
  admin: 'Admin',
  about: 'About Papol',
  learn: 'Learn',
  join: 'Create account',
  signin: 'Sign in',
  profile: 'Settings',
};

export function desktopTitle(route, user) {
  if (route.page === 'home') return user ? 'My nook' : 'Sign in';
  return TITLES[route.page] || 'Papol';
}

function ItemMark({ item }) {
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
          pending: web.pending + local.pending,
          error: web.error || local.error || local.outbox_error || null,
          conflicts: local.conflicts || 0,
          lastSynced: local.last_synced_at || web.lastSynced,
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
    refreshSyncStatus().then(update).catch(() => {});
    document.getElementById('papol-offline-status')?.remove();
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
    const latest = { ...web, syncing: syncRunning(web) };
    if (failure) latest.error = failure;
    if (nativeDataActive()) {
      try {
        const local = await nativeRepository.syncStatus();
        latest.syncing = syncRunning(web, local);
        latest.pending += local.pending;
        latest.error ||= local.error || local.outbox_error;
        latest.conflicts = local.conflicts || 0;
        latest.lastSynced = local.last_synced_at || latest.lastSynced;
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
        title={status.offline ? OFFLINE_MODE_MESSAGE : (status.error || 'Send and receive changes now')}
      >
        <span className={status.syncing ? 'desktop-sync-mark spinning' : 'desktop-sync-mark'} aria-hidden="true">↻</span>
        <span>{status.offline ? 'Offline — Sync' : 'Sync'}</span>
      </button>
    </section>
  );
}

export function DesktopSidebar({ groups, user, profileActive, onFeedback, onManageNook, onMovePaper, onNavigate, onReportableError, onSync, notice }) {
  const [dropKey, setDropKey] = useState(null);
  const openPath = (path) => onNavigate ? onNavigate(path) : window.location.assign(appPath(path));

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
            </div>
          )}
          {group.items.map((item) => (
            <a
              key={item.key}
              href={appPath(item.path)}
              className={`desktop-sidebar-item${item.active ? ' active' : ''}${dropKey === item.key ? ' drop-target' : ''}`}
              aria-current={item.active ? 'page' : undefined}
              title={item.shortcut ? `${item.title || item.label} (${MOD}${item.shortcut})` : item.title}
              draggable="false"
              onContextMenu={contextMenuHandler(() => [
                { label: 'Open', shortcut: item.shortcut ? `${MOD}${item.shortcut}` : undefined, onSelect: () => openPath(item.path) },
                item.shelfUuid != null && onManageNook && { separator: true },
                item.shelfUuid != null && onManageNook && { label: 'Manage Shelves…', onSelect: onManageNook },
              ])}
              {...shelfDropProps(item)}
            >
              <ItemMark item={item} />
              <span className="desktop-sidebar-text">{item.label}</span>
              {item.count > 0 && (
                <span
                  className={`desktop-sidebar-count${item.unread ? ' unread' : ''}`}
                  aria-label={item.unread ? `${item.count} unread` : undefined}
                >
                  {item.count}
                </span>
              )}
            </a>
          ))}
        </nav>
      ))}
      {notice && <p className="desktop-sidebar-notice" role="alert">{notice}</p>}
      <div className="desktop-sidebar-footer">
        <button type="button" className="desktop-sidebar-item" onClick={onFeedback} onContextMenu={contextMenuHandler(() => [
          { label: 'Feedback…', onSelect: onFeedback },
        ])}>
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
              onContextMenu={contextMenuHandler(() => [
                { label: 'Edit Profile…', onSelect: () => openPath('/profile') },
              ])}
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

// ⌘1…⌘4 open the sidebar's numbered rows. Papol has no in-app history to
// walk, so there is no Back or Forward: the sidebar is how a user moves.
export function useDesktopShortcuts({ groups, onNavigate }) {
  const latest = useRef(null);
  latest.current = {
    items: groups.flatMap((group) => group.items).filter((item) => item.shortcut),
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

// A page's toolbar: its title, in the strip that moves the window.
export function DesktopToolbar({ title }) {
  return (
    <header className="desktop-toolbar" data-tauri-drag-region="deep">
      {title && <h1 className="desktop-toolbar-title">{title}</h1>}
    </header>
  );
}
