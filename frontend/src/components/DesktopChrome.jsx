import React, { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar';
import Glyph from './DesktopGlyph';
import { PAPER_DRAG_TYPE, isBrowsing, sourcePath } from '../desktopSources';
import { appPath } from '../base';
import { DESKTOP, MAC } from '../../../shared/desktopShell';

// The sidebar and toolbar that stand in for the website masthead inside
// Papol Desktop (see DESIGN.md, "Desktop shell"). Destinations are ordinary
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
          key: `shelf:${shelf.id}`,
          label: shelf.name,
          title: `${shelf.name} · ${shelf.is_public ? 'Public' : 'Private'}`,
          path: sourcePath(`shelf:${shelf.id}`),
          shelfId: shelf.id,
          swatch: shelf.color,
          active: at(`shelf:${shelf.id}`),
          count: shelf.paper_count,
        })),
        { key: 'boards', label: 'Boards', path: sourcePath('boards'), glyph: 'boards', active: at('boards'), count: space?.boards?.length },
      ],
    },
    ...(tags.length > 0 ? [{
      label: 'Tags',
      items: tags.map((tag) => ({
        key: `tag:${tag.id}`,
        label: tag.name,
        path: sourcePath(`tag:${tag.id}`),
        hash: true,
        active: at(`tag:${tag.id}`),
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
  profile: 'Profile',
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

export function DesktopSidebar({ groups, user, profileActive, onFeedback, onManageNook, onMovePaper, notice }) {
  const [dropKey, setDropKey] = useState(null);

  // Shelves accept a paper dragged from the list, the way a Finder sidebar
  // accepts files: the shelf lights up under the pointer and takes the paper
  // on release.
  const shelfDropProps = (item) => {
    if (item.shelfId == null || !onMovePaper) return {};
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
        const { id, shelfId } = JSON.parse(event.dataTransfer.getData(PAPER_DRAG_TYPE));
        if (shelfId !== item.shelfId) onMovePaper(id, item.shelfId);
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
        <button type="button" className="desktop-sidebar-item" onClick={onFeedback}>
          <Glyph name="feedback" />
          <span className="desktop-sidebar-text">Send feedback</span>
        </button>
        {user && (
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
        )}
      </div>
    </aside>
  );
}

// ⌘1…⌘4 open the sidebar's numbered rows. Papol has no in-app history to
// walk, so there is no Back or Forward: the sidebar is how a reader moves.
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
