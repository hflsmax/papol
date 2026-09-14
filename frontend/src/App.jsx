import React, { useState, useEffect, useRef } from 'react';
import {
  getMe, getStartupUser, getToken, setToken, logout, pendingLocalChanges,
  refreshStartupUser,
} from '../../shared/api/account.js';
import { getNotifications } from '../../shared/api/notifications.js';
import { updatePaper } from '../../shared/api/papers.js';
import AuthPage from './components/AuthPage';
import Space from './components/Space';
import PaperDetail from './components/PaperDetail';
import { demoActive, enterDemo, exitDemo } from '../../shared/demo.js';
import ProfilePage from './components/ProfilePage';
import PapersPage from './components/PapersPage';
import RoomPage from './components/RoomPage';
import InboxPage from './components/InboxPage';
import AdminPage from './components/AdminPage';
import HomePage from './components/HomePage';
import LearnPage from './components/LearnPage';
import Avatar from './components/Avatar';
import FeedbackDialog from './components/FeedbackDialog';
import {
  DesktopSidebar, DesktopToolbar, desktopNavigation, desktopTitle,
  useDesktopShortcuts,
} from './components/DesktopChrome';
import { DesktopBrowser, useNookSpace } from './components/DesktopLibrary';
import { isBrowsing, lastShownSource, rememberSource, resolveSource } from './desktopSources';
import { applicationStyles } from '../../shared/applicationStyles.js';
import NookManager from './components/NookManager';
import { appPath, stripAppBase } from './base';
import { DESKTOP, openDesktopDocumentWindow } from '../../shared/desktopShell';
import { confirmAction } from '../../shared/confirmAction';
import { carriesFiles, isPdfFile, libraryFileDragState } from '../../shared/fileDrop.js';
import { openDroppedPdf, subscribeShowPaperRequests, subscribeSignInRequests } from '../../shared/nativeData.js';

function parseRoute() {
  const rawPath = stripAppBase(window.location.pathname || '/');
  const demo = rawPath === '/demo' || rawPath.startsWith('/demo/');
  const path = demo
    ? rawPath === '/demo' ? '/' : rawPath.slice('/demo'.length)
    : rawPath;
  const routed = (route) => (demo ? { ...route, demo: true } : route);
  // Readers, papers and seminars are addressed by their UUID, and only by it.
  const UUID_PATTERN = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
  const at = (pattern) => path.match(new RegExp(`^${pattern}/?$`, 'i'))?.[1].toLowerCase();
  let uuid;
  if ((uuid = at(`/u/${UUID_PATTERN}/boards`))) return routed({ page: 'space', uuid, section: 'boards' });
  if ((uuid = at(`/u/${UUID_PATTERN}`))) return routed({ page: 'space', uuid });
  if ((uuid = at(`/paper/${UUID_PATTERN}`))) return routed({ page: 'paper', uuid });
  if ((uuid = at(`/room/${UUID_PATTERN}`))) return routed({ page: 'room', uuid });
  if (path === '/profile') return routed({ page: 'profile' });
  if (path === '/join') return routed({ page: 'join' });
  if (path === '/about') return routed({ page: 'about' });
  if (path === '/learn') return routed({ page: 'learn' });
  if (path === '/signin') return routed({ page: 'signin' });
  if (path === '/library' || path === '/papers') return routed({ page: 'papers' });
  if (path === '/village' || path === '/readers') return routed({ page: 'papers' });
  if (path === '/inbox') return routed({ page: 'inbox' });
  if (path === '/admin') return routed({ page: 'admin' });
  return routed({ page: 'home' });
}

const demoPath = (path) => {
  if (path === '/') return '/demo';
  return path.startsWith('/') ? `/demo${path}` : path;
};

const SIGN_IN_PAGES = new Set([
  'space', 'papers', 'room', 'inbox', 'admin', 'profile',
]);

function navigate(path, { replace = false } = {}) {
  const destination = demoActive() && !['/signin', '/join'].includes(path)
    && !path.startsWith('/demo')
    ? demoPath(path)
    : path;
  // Don't push a history entry when already there; otherwise Back appears
  // to do nothing.
  const mountedDestination = appPath(destination);
  if (`${window.location.pathname}${window.location.search}` === mountedDestination) return;
  if (replace) {
    // Moving a selection through a list is not a step worth a Back.
    window.history.replaceState(
      { ...(window.history.state || {}), papolNavigation: true },
      '',
      mountedDestination,
    );
  } else {
    window.history.pushState(
      { ...(window.history.state || {}), papolNavigation: true, papolBackHref: `${window.location.pathname}${window.location.search}` },
      '',
      mountedDestination,
    );
  }
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function openBoard(uuid) {
  const path = demoActive() ? `/demo/boards/${uuid}` : `/boards/${uuid}`;
  if (DESKTOP) {
    openDesktopDocumentWindow(appPath(path), 'popup,width=1200,height=820');
    return;
  }
  window.sessionStorage.setItem(
    'papol.boardReturn',
    `${window.location.pathname}${window.location.search}`,
  );
  window.location.assign(appPath(path));
}

function LibraryFileDropFeedback({ state, message, opensViewer = false }) {
  return <>
    {state && (
      <div className={`library-file-drop-overlay${state === 'reject' ? ' reject' : ''}`} role="status">
        <div className="library-file-drop-card">
          <strong>{state === 'reject'
            ? 'PDF files only'
            : opensViewer ? 'Drop PDF to open' : 'Drop PDF to import'}</strong>
          <span>{state === 'reject'
            ? 'Papol’s library only supports PDF files.'
            : opensViewer
              ? 'The paper will open in Papol’s PDF viewer.'
              : 'The paper will open for metadata review.'}</span>
        </div>
      </div>
    )}
    {message && <div className="library-file-drop-notice" role="alert">{message}</div>}
  </>;
}

export default function App({ startupUser = null }) {
  const [user, setUser] = useState(startupUser);
  // Desktop hydrates its trusted local account before React mounts. On the
  // web, a visitor with no token is already known to be a guest. Only a web
  // credential or a first desktop sign-in still needs to gate the shell.
  const [authChecked, setAuthChecked] = useState(() => Boolean(startupUser) || !getToken());
  const [route, setRoute] = useState(parseRoute());
  const [unreadCount, setUnreadCount] = useState(0);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [libraryFileDrag, setLibraryFileDrag] = useState(null);
  const [libraryDropNotice, setLibraryDropNotice] = useState(null);
  const [incomingPaperFile, setIncomingPaperFile] = useState(null);
  const libraryDragDepth = useRef(0);
  const libraryDropNoticeTimer = useRef(null);
  // The welcome modal greets every fresh demo visit. Returning from its
  // viewer is still the same visit, so consume the viewer's one-shot marker
  // rather than greeting the reader again after the full-page transition.
  const [demoIntroSeen, setDemoIntroSeen] = useState(() => {
    const returnedFromViewer = window.sessionStorage.getItem('papol.viewerReturn') === '1';
    window.sessionStorage.removeItem('papol.viewerReturn');
    return returnedFromViewer;
  });

  // State-machine precedence is deliberate: an explicit demo URL wins;
  // otherwise a real authenticated reader wins; guest is only the public
  // fallback when neither of those primary modes applies.
  const mode = route.demo ? 'demo' : user ? 'signed-in' : 'guest';

  const restoreRealUser = async () => {
    const localUser = await getStartupUser().catch(() => null);
    if (localUser) {
      setUser(localUser);
      if (getToken()) {
        refreshStartupUser(localUser).then(setUser).catch(() => {});
      }
      return;
    }
    if (!getToken()) {
      setUser(null);
      return;
    }
    try {
      setUser(await getMe());
    } catch {
      await setToken(null);
      setUser(null);
    }
  };

  useEffect(() => {
    const importIntoLibrary = mode === 'signed-in';
    const openInViewer = DESKTOP && mode === 'guest';
    if (!importIntoLibrary && !openInViewer) return undefined;
    const resetDrag = () => {
      libraryDragDepth.current = 0;
      setLibraryFileDrag(null);
    };
    const showNotice = (message) => {
      setLibraryDropNotice(message);
      window.clearTimeout(libraryDropNoticeTimer.current);
      libraryDropNoticeTimer.current = window.setTimeout(
        () => setLibraryDropNotice(null), 4000,
      );
    };
    const dragEnter = (event) => {
      if (!carriesFiles(event.dataTransfer) || event.defaultPrevented) return;
      event.preventDefault();
      libraryDragDepth.current += 1;
      setLibraryFileDrag(libraryFileDragState(event.dataTransfer));
    };
    const dragOver = (event) => {
      if (!carriesFiles(event.dataTransfer) || event.defaultPrevented) return;
      event.preventDefault();
      const state = libraryFileDragState(event.dataTransfer);
      event.dataTransfer.dropEffect = state === 'reject' ? 'none' : 'copy';
      setLibraryFileDrag(state);
    };
    const dragLeave = (event) => {
      if (!carriesFiles(event.dataTransfer)) return;
      libraryDragDepth.current = Math.max(0, libraryDragDepth.current - 1);
      if (libraryDragDepth.current === 0) setLibraryFileDrag(null);
    };
    const drop = async (event) => {
      if (!carriesFiles(event.dataTransfer)) return;
      resetDrag();
      if (event.defaultPrevented) return;
      event.preventDefault();
      const files = Array.from(event.dataTransfer.files || []);
      if (files.length !== 1) {
        showNotice('Import one PDF at a time.');
        return;
      }
      if (!isPdfFile(files[0])) {
        showNotice('Papol’s library only supports PDF files.');
        return;
      }
      setLibraryDropNotice(null);
      if (openInViewer) {
        try {
          await openDroppedPdf(files[0]);
        } catch (error) {
          showNotice(error instanceof Error ? error.message : String(error));
        }
        return;
      }
      setIncomingPaperFile({ uuid: globalThis.crypto.randomUUID(), file: files[0] });
      navigate('/library');
    };
    window.addEventListener('dragenter', dragEnter);
    window.addEventListener('dragover', dragOver);
    window.addEventListener('dragleave', dragLeave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', dragEnter);
      window.removeEventListener('dragover', dragOver);
      window.removeEventListener('dragleave', dragLeave);
      window.removeEventListener('drop', drop);
      window.clearTimeout(libraryDropNoticeTimer.current);
    };
  }, [mode]);

  const dismissDemoIntro = () => setDemoIntroSeen(true);

  const demoIntroVisible = mode === 'demo' && Boolean(user) && !demoIntroSeen;

  useEffect(() => {
    if (!demoIntroVisible) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setDemoIntroSeen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [demoIntroVisible]);

  useEffect(() => {
    const onRouteChange = async () => {
      const next = parseRoute();
      if (next.demo && !route.demo) {
        enterDemo();
        setUser(await getMe());
      } else if (!next.demo && route.demo) {
        exitDemo();
        await restoreRealUser();
      }
      setRoute(next);
    };
    window.addEventListener('popstate', onRouteChange);
    return () => window.removeEventListener('popstate', onRouteChange);
  }, [route.demo]);

  useEffect(() => {
    // A canonical paper URL is public and real. Do not route a signed-out
    // recipient into the fictional demo before that paper is opened.
    const initialRoute = parseRoute();
    if (initialRoute.demo) {
      enterDemo();
      getMe().then(setUser).finally(() => setAuthChecked(true));
      return;
    }
    exitDemo();
    if (startupUser) {
      // The local desktop identity is already on screen. Server auth now
      // refreshes network capability and profile data in the background.
      if (getToken()) {
        refreshStartupUser(startupUser).then(setUser).catch(() => {});
      }
      return;
    }
    if (initialRoute.page === 'paper') {
      if (getToken()) {
        getMe().then(setUser).catch(() => setToken(null)).finally(() => setAuthChecked(true));
      } else {
        setAuthChecked(true);
      }
      return;
    }
    if (!getToken()) {
      setUser(null);
      setAuthChecked(true);
      return;
    }
    getMe()
      .then(setUser)
      .catch(async () => {
        // A stale session becomes an ordinary guest session. Demo is only
        // entered by a URL that explicitly contains /demo.
        await setToken(null);
        setUser(null);
      })
      .finally(() => setAuthChecked(true));
  }, []);

  useEffect(() => {
    if (!user) {
      setUnreadCount(0);
      return;
    }
    getNotifications()
      .then((d) => setUnreadCount(d.unread_count))
      .catch(() => {});
  }, [user, route]);

  // A document window asked for an account: a PDF opened from disk is being
  // added to a nook. Signing in happens here, in the library window.
  const signedInUser = useRef(user);
  signedInUser.current = user;
  useEffect(() => subscribeSignInRequests((request) => {
    if (!signedInUser.current || demoActive()) navigate(request?.register ? '/join' : '/signin');
  }), []);

  // A document reader can reveal its paper in the permanent library window.
  // Use the complete nook rather than whichever shelf or tag happened to be
  // open, so the selected row is always present in the list.
  useEffect(() => subscribeShowPaperRequests((paperUuid) => {
    rememberSource('all');
    const path = `/paper/${paperUuid}`;
    const mountedPath = appPath(path);
    if (`${window.location.pathname}${window.location.search}` === mountedPath) {
      setRoute(parseRoute());
    } else {
      navigate(path);
    }
  }), []);

  const [managingNook, setManagingNook] = useState(false);
  const [desktopNotice, setDesktopNotice] = useState(null);
  const [syncRefresh, setSyncRefresh] = useState(0);
  // The desktop sidebar lists the reader's shelves and tags, so the desktop
  // app keeps their nook loaded beside whatever is open.
  const nook = useNookSpace(DESKTOP && user ? user.uuid : null, route);
  const desktopSource = resolveSource(route, user, {
    search: window.location.search,
    lastShown: lastShownSource(),
  });
  const desktopGroups = desktopNavigation({
    user, route, unreadCount, space: nook.space, source: desktopSource,
  });
  useDesktopShortcuts({ groups: desktopGroups, onNavigate: navigate });

  const handleAuth = ({ token, user }) => {
    const requestedPage = new URLSearchParams(window.location.search).get('next');
    const currentPath = stripAppBase(window.location.pathname || '/');
    const candidate = requestedPage || currentPath;
    const returnTo = candidate.startsWith('/paper/') || candidate.startsWith('/boards/')
      ? candidate
      : '/';
    exitDemo();
    // login/register already persisted the credential for this account.
    setUser(user);
    if (returnTo.startsWith('/boards/')) {
      window.location.replace(appPath(returnTo));
      return;
    }
    navigate(returnTo);
  };

  const handleBackToAccount = async () => {
    window.history.replaceState(null, '', appPath('/'));
    setRoute(parseRoute());
    exitDemo();
    await restoreRealUser();
  };

  const handleDemo = () => {
    navigate('/demo');
  };

  const handleLogout = async () => {
    if (demoActive()) {
      // Leaving the demo is a navigation, not a state teardown — the demo
      // stays alive underneath so Back returns into it. Signing in for
      // real (handleAuth) is what actually ends the demo.
      const leave = await confirmAction(
        'This leaves the demo and takes you to the sign-in page of the ' +
          'real Papol. Continue?',
        { confirmLabel: 'Leave demo' },
      );
      if (!leave) return;
      navigate('/signin');
      return;
    }
    let pending = null;
    try { pending = await pendingLocalChanges(); } catch { /* still allow sign-out */ }
    const warning = pending > 0
      ? `Signing out deletes this account's downloaded data and local changes from this Mac. ` +
        `${pending} unsynced ${pending === 1 ? 'change will' : 'changes will'} be permanently lost. Sign out?`
      : `Signing out deletes this account's downloaded data and local changes from this Mac. ` +
        'Any unsynced changes will be permanently lost. Sign out?';
    const leave = await confirmAction(warning, { confirmLabel: 'Sign out' });
    if (!leave) return;
    try {
      await logout(user?.uuid);
    } catch (error) {
      const message = `Could not delete local account data: ${error.message}`;
      if (DESKTOP) {
        setDesktopNotice(message);
        window.setTimeout(() => setDesktopNotice(null), 5000);
      } else {
        window.alert(message);
      }
      return;
    }
    exitDemo();
    setUser(null);
    navigate('/');
  };

  if (!authChecked) {
    return (
      <>
        <style>{applicationStyles}</style>
        <div className="loading">Loading…</div>
      </>
    );
  }

  const goBack = () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      navigate('/');
    }
  };
  const backHref = window.history.state?.papolBackHref || appPath('/');

  const guestNeedsSignIn = mode === 'guest' && SIGN_IN_PAGES.has(route.page);

  const routeAppLinks = (event) => {
    const anchor = event.target.closest?.('a[href^="/"]');
    const href = anchor?.getAttribute('href');
    // A control inside a link (the × that leaves a seminar cohort sits on the
    // reader's chip) is its own action. This runs on the way down, before
    // that control's handler could stop the click, so it has to step aside.
    const control = event.target.closest?.('button, input, select, textarea');
    if (control && anchor?.contains(control)) return;
    if (
      !href ||
      anchor.hasAttribute('download') ||
      anchor.hasAttribute('data-document') ||
      (anchor.target && anchor.target !== '_self')
    ) return;
    const destination = new URL(href, window.location.origin);
    if (destination.origin !== window.location.origin) return;
    const routePath = stripAppBase(destination.pathname);
    event.preventDefault();
    navigate(`${routePath}${destination.search}`);
  };

  const demoIntro = demoIntroVisible && (
    <div className="modal-overlay" onClick={dismissDemoIntro}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="panel demo-intro">
          <h3>Welcome to Papol</h3>
          <p>
            Papol is your paper reading companion. Stay close to the ideas
            that matter, and the people thinking about them.
          </p>
          <p>
            You are looking at the demo: you play as SpongeBob among
            fictional readers. Everything happens in your browser and
            nothing is saved.
          </p>
          <p>
            Register an account to have your own nook
            and keep your papers and notes.
          </p>
          <div className="form-actions">
            <button
              className="primary"
              onClick={() => {
                dismissDemoIntro();
                navigate('/join');
              }}
            >
              Register
            </button>
            <button
              onClick={() => {
                dismissDemoIntro();
                navigate('/signin');
              }}
            >
              Sign in
            </button>
            <button onClick={dismissDemoIntro}>Explore the demo</button>
          </div>
        </div>
      </div>
    </div>
  );

  const demoBanner = user && demoActive() && (
    <div className="demo-banner">
      <span>
        Demo mode — everything here is fictional and happens in your
        browser. Nothing is saved.
      </span>
      {getToken() ? (
        <a className="demo-banner-btn" href={appPath('/')} onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
          event.preventDefault();
          handleBackToAccount();
        }}>
          Back to my account
        </a>
      ) : (
        <span className="demo-banner-actions">
          <button
            className="demo-banner-btn"
            onClick={() => navigate('/join')}
          >
            Create a real account
          </button>
          <button
            className="link-btn demo-banner-link"
            onClick={() => navigate('/signin')}
          >
            Sign in
          </button>
        </span>
      )}
    </div>
  );

  const feedbackDialog = feedbackOpen && (
    <FeedbackDialog
      // A demo visitor with no real token is a stranger to the backend,
      // so the dialog asks them for an address to reply to.
      currentUser={getToken() ? user : null}
      onClose={() => setFeedbackOpen(false)}
    />
  );

  // Keyed by world and identity: leaving or entering the demo, or changing
  // real accounts, remounts every page so no nook or private paper state can
  // survive an identity boundary.
  const pages = (
    <main className="main-content" key={`${mode}:${user?.uuid ?? 'none'}`}>
      {guestNeedsSignIn ? (
        <AuthPage onAuth={handleAuth} initialMode="login" />
      ) : (
      <>
      {route.page === 'home' &&
        (user ? (
          <Space
            userUuid={user.uuid}
            currentUser={user}
            onSelectPaper={(uuid) => navigate(`/paper/${uuid}`)}
            onSelectBoard={openBoard}
          />
        ) : DESKTOP ? (
          // The desktop app opens on signing in, not on a pitch for Papol.
          <AuthPage onAuth={handleAuth} initialMode="login" />
        ) : (
          <HomePage
            currentUser={user}
            onDemo={demoActive() ? undefined : handleDemo}
          />
        ))}
      {route.page === 'space' && (
        <Space
          userUuid={route.uuid}
          currentUser={user}
          onSelectPaper={(uuid) => navigate(`/paper/${uuid}`)}
          onSelectBoard={openBoard}
          initialSection={route.section}
          onBack={goBack}
          backHref={backHref}
        />
      )}
      {route.page === 'paper' && (
        <PaperDetail
          paperUuid={route.uuid}
          currentUser={user}
          onRead={DESKTOP ? (href) => openDesktopDocumentWindow(href, 'popup,width=1100,height=820') : undefined}
          onBack={goBack}
          backHref={backHref}
          hideBack={
            mode !== 'demo' &&
            !window.history.state?.papolNavigation
          }
          onSelectPaper={(uuid) => navigate(`/paper/${uuid}`)}
        />
      )}
      {route.page === 'papers' && (
        <PapersPage
          currentUser={user}
          onSelectPaper={(uuid) => navigate(`/paper/${uuid}`)}
          onSelectBoard={openBoard}
          incomingPaperFile={incomingPaperFile}
          onIncomingPaperFileHandled={() => setIncomingPaperFile(null)}
        />
      )}
      {route.page === 'room' && (
        <RoomPage roomUuid={route.uuid} currentUser={user} onBack={goBack} backHref={backHref} />
      )}
      {route.page === 'inbox' && (
        <InboxPage
          onOpenRoom={(uuid) => navigate(`/room/${uuid}`)}
          onUnread={setUnreadCount}
        />
      )}
      {route.page === 'admin' &&
        (user && user.is_admin ? (
          <AdminPage />
        ) : (
          <div className="panel">
            <p className="panel-note">Admin access only.</p>
          </div>
        ))}
      {route.page === 'about' && (
        <HomePage
          currentUser={user}
          onDemo={demoActive() ? undefined : handleDemo}
        />
      )}
      {route.page === 'learn' && <LearnPage />}
      {route.page === 'join' && (
        <AuthPage onAuth={handleAuth} initialMode="register" />
      )}
      {route.page === 'signin' && (
        <AuthPage onAuth={handleAuth} initialMode="login" />
      )}
      {route.page === 'profile' &&
        (user ? (
          <ProfilePage
            user={user}
            onUserUpdated={setUser}
            onLogout={handleLogout}
            onSync={() => {
              nook.reload();
              setSyncRefresh((revision) => revision + 1);
            }}
          />
        ) : null)}
      </>
      )}
    </main>
  );

  // Papol Desktop: a source-list sidebar in place of the website masthead.
  // Reading happens in a three-pane browser — source, list, paper — and every
  // other page fills the space beside the sidebar.
  if (DESKTOP) {
    const movePaperToShelf = async (paperUuid, shelfUuid) => {
      try {
        await updatePaper(paperUuid, { shelf_uuid: shelfUuid });
      } catch (err) {
        setDesktopNotice(err.message);
        window.setTimeout(() => setDesktopNotice(null), 5000);
      }
      nook.reload();
    };
    return (
      <>
        <style>{applicationStyles}</style>
        <LibraryFileDropFeedback
          state={libraryFileDrag}
          message={libraryDropNotice}
          opensViewer={mode === 'guest'}
        />
        {demoIntro}
        {feedbackDialog}
        {managingNook && nook.space && (
          <NookManager
            space={nook.space}
            setSpace={nook.setSpace}
            onChanged={nook.reload}
            onClose={() => setManagingNook(false)}
            onTagDeleted={(tagUuid) => { if (desktopSource === `tag:${tagUuid}`) navigate('/'); }}
          />
        )}
        <div className="desktop-app" onClickCapture={routeAppLinks}>
          <DesktopSidebar
            groups={desktopGroups}
            user={user}
            profileActive={route.page === 'profile'}
            onFeedback={() => setFeedbackOpen(true)}
            onManageNook={nook.space ? () => setManagingNook(true) : undefined}
            onMovePaper={nook.space ? movePaperToShelf : undefined}
            onNavigate={navigate}
            onSync={() => {
              nook.reload();
              setSyncRefresh((revision) => revision + 1);
            }}
            notice={desktopNotice}
          />
          {isBrowsing(route, user) ? (
            <DesktopBrowser
              key={`${mode}:${user.uuid}`}
              source={desktopSource}
              route={route}
              currentUser={user}
              nook={nook}
              onNavigate={navigate}
              onOpenBoard={openBoard}
              onSyncRefresh={syncRefresh}
              banner={demoBanner}
              incomingPaperFile={incomingPaperFile}
              onIncomingPaperFileHandled={() => setIncomingPaperFile(null)}
            />
          ) : (
            <div className="desktop-pane">
              <DesktopToolbar title={desktopTitle(route, user)} />
              {demoBanner}
              <div className="desktop-scroll">
                <div className="desktop-content">{pages}</div>
              </div>
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <style>{applicationStyles}</style>
      <LibraryFileDropFeedback state={libraryFileDrag} message={libraryDropNotice} />
      {demoIntro}
      {demoBanner}
      <button
        type="button"
        className="feedback-fab"
        onClick={() => setFeedbackOpen(true)}
        title="Report a bug or ask for a feature"
      >
        Feedback
      </button>
      {feedbackDialog}
      <div className="app" onClickCapture={routeAppLinks}>
        <header className="topnav">
          <a className="brand" href={appPath('/')}>Papol</a>
          <nav>
            {user ? (
              <a
                href={appPath('/')}
                className={
                  route.page === 'home' || route.page === 'board' ||
                  (route.page === 'space' && route.uuid === user.uuid)
                    ? 'active'
                    : ''
                }
              >
                My nook
              </a>
            ) : (
              <a href={appPath('/')} className={route.page === 'home' ? 'active' : ''}>
                Home
              </a>
            )}
            <a href={appPath('/library')} className={route.page === 'papers' ? 'active' : ''}>
              Library
            </a>
            <a href={appPath('/about')} className={route.page === 'about' ? 'active' : ''}>
              About
            </a>
            <a href={appPath('/learn')} className={route.page === 'learn' ? 'active' : ''}>
              Learn
            </a>
          </nav>
          <span className="spacer" />
          {user ? (
            <>
              <a
                href={appPath('/inbox')}
                className={
                  route.page === 'inbox' ? 'inbox-link active' : 'inbox-link'
                }
              >
                Inbox
                {unreadCount > 0 && (
                  <span className="inbox-badge">{unreadCount}</span>
                )}
              </a>
              <a
                className={route.page === 'profile' ? 'whoami whoami-link active' : 'whoami whoami-link'}
                href={appPath('/profile')}
                title="Edit profile"
              >
                <Avatar user={user} className="nav-avatar" />
                <span className="whoami-name">
                  {user.display_name.split(' ')[0]}
                </span>
              </a>
              {user.is_admin && (
                <a
                  href={appPath('/admin')}
                  className={
                    route.page === 'admin' ? 'inbox-link active' : 'inbox-link'
                  }
                >
                  Admin
                </a>
              )}
            </>
          ) : mode === 'guest' ? (
            <button className="primary" onClick={() => navigate('/signin')}>
              Sign in
            </button>
          ) : null}
        </header>
        {pages}
      </div>
    </>
  );
}
