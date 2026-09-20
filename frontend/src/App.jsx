import React, { useCallback, useState, useEffect, useRef } from 'react';
import {
  getMe, getStartupUser, getToken, logout, pendingLocalChanges,
  refreshStartupUser,
} from '../../shared/api/account.js';
import { getNotifications, getPendingAdminMessages } from '../../shared/api/notifications.js';
import { updatePaper } from '../../shared/api/papers.js';
import AuthPage from './components/AuthPage';
import ErrorBoundary from '../../shared/ui/ErrorBoundary.jsx';
import Nook from './components/Nook';
import BoardJacket from './components/BoardJacket';
import PaperJacket from './components/PaperJacket';
import { resetDemo } from '../../shared/demo.js';
import { inDemo } from '../../shared/appUrls.js';
import { storeCredential } from '../../shared/credentials.js';
import ProfilePage from './components/ProfilePage';
import PapersPage from './components/PapersPage';
import RoomPage from './components/RoomPage';
import InboxPage from './components/InboxPage';
import AdminPage from './components/AdminPage';
import HomePage from './components/HomePage';
import LearnPage from './components/LearnPage';
import Avatar from './components/Avatar';
import FeedbackDialog from '../../shared/ui/FeedbackDialog.jsx';
import { submitFeedback } from '../../shared/api/feedback.js';
import AdminMessageDialog from './components/AdminMessageDialog';
import CompatibilityGate from '../../shared/ui/CompatibilityGate.jsx';
import {
  DesktopSidebar, DesktopToolbar, desktopNavigation, desktopTitle,
  useDesktopShortcuts,
} from './components/DesktopChrome';
import { DesktopBrowser, useNook } from './components/DesktopDesk';
import { isBrowsing, lastShownListing, rememberListing, resolveListing } from './desktopListings';
import { applicationStyles } from '../../shared/applicationStyles.js';
import {
  MACOS_DOWNLOAD_BANNER_DISMISSED, isFeatureStateSet, setFeatureState,
} from '../../shared/featureStates.js';
import NookManager from './components/NookManager';
import { appPath, modePath, modeRoute, stripAppBase } from './base';
import { parseRoute } from './routes';
import {
  originAfterMove, jacketBackTarget, readJacketOrigin, writeJacketOrigin,
} from './jacketOrigin';
import { paperName } from '../../shared/paperName.js';
import { subscribeUnauthenticated } from '../../shared/httpClient.js';
import { DESKTOP, openDesktopDocumentWindow } from '../../shared/desktopShell';
import { confirmAction } from '../../shared/confirmAction';
import { carriesFiles, isPdfFile, deskFileDragState } from '../../shared/fileDrop.js';
import {
  nativeCompatibilityVerdict, openDroppedPdf, recordDiagnosticEvent,
  setNativeAccount, subscribeNativeData, subscribeShowPaperRequests, subscribeSignInRequests,
  subscribeNativeHandoffs, scheduleAutomaticNativeSync,
  REPORTABLE_NATIVE_ERROR_EVENT,
} from '../../shared/nativeData.js';
import {
  checkClientCompatibility, setClientCompatibility,
} from '../../shared/clientCompatibility.js';
import { unexpectedDesktopErrorReport } from '../../shared/errorReport.js';
import { useModalDialog } from '../../shared/useModalDialog.js';

const SIGN_IN_PAGES = new Set([
  'nook', 'papers', 'room', 'inbox', 'admin', 'profile',
]);

// The macOS application is signed, notarized, and attached to this project's
// GitHub releases by .github/workflows/desktop-macos.yml.
const MACOS_DOWNLOAD_URL = 'https://github.com/hflsmax/papol/releases';

// Closing this is one of the things a browser remembers about a user, so it
// is named in shared/featureStates.js rather than here, and Admin can bring
// the banner back without knowing anything about this file.
const macosBannerWasDismissed = () => isFeatureStateSet(MACOS_DOWNLOAD_BANNER_DISMISSED);

// A path as the address bar spells it: under /demo while the demo is on,
// and under the base the app is served from.
const mountedPath = (path) => modePath(path, { demo: inDemo() });

function navigate(path, { replace = false } = {}) {
  const destination = inDemo() && !['/signin', '/join'].includes(path)
    && !path.startsWith('/demo')
    ? modeRoute(path, { demo: true })
    : path;
  // Don't push a history entry when already there; otherwise Back appears
  // to do nothing.
  const mountedDestination = appPath(destination);
  if (`${window.location.pathname}${window.location.search}` === mountedDestination) return;
  // A jacket's Back leads to the nook or Desk it was opened from,
  // and this is the one door every in-app move goes through.
  writeJacketOrigin(originAfterMove(readJacketOrigin(), window.location.pathname, mountedDestination));
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

// A board row opens the board's jacket, as a paper row opens a paper's: the
// The Desk shows what it holds, and opening the work itself is the next step.
function openBoard(uuid) {
  navigate(`/board/${uuid}`);
}

// The way in, from the jacket. The canvas is a separate application, so this
// leaves the Desk — on the desktop into a document window beside it, on
// the web by going there.
function openBoardCanvas(uuid) {
  const path = modePath(`/boards/${uuid}`, { demo: inDemo() });
  if (DESKTOP) {
    openDesktopDocumentWindow(path, 'popup,width=1200,height=820');
    return;
  }
  window.location.assign(path);
}

function DeskFileDropFeedback({ state, message, opensViewer = false }) {
  return <>
    {state && (
      <div className={`desk-file-drop-overlay${state === 'reject' ? ' reject' : ''}`} role="status">
        <div className="desk-file-drop-card">
          <strong>{state === 'reject'
            ? 'PDF files only'
            : opensViewer ? 'Drop PDF to open' : 'Drop PDF to import'}</strong>
          <span>{state === 'reject'
            ? 'Papol’s Desk only supports PDF files.'
            : opensViewer
              ? 'The paper will open in Papol’s PDF viewer.'
              : 'The paper will open for metadata review.'}</span>
        </div>
      </div>
    )}
    {message && <div className="desk-file-drop-notice" role="alert">{message}</div>}
  </>;
}

export default function App({ startupUser = null, startupError = null }) {
  const [user, setUser] = useState(startupUser);
  // Desktop hydrates its trusted local account before React mounts. On the
  // web, a visitor with no token is already known to be a guest. Only a web
  // credential or a first desktop sign-in still needs to gate the shell.
  const [authChecked, setAuthChecked] = useState(() => DESKTOP || Boolean(startupUser) || !getToken());
  const [route, setRoute] = useState(parseRoute());
  const [demoError, setDemoError] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [adminMessages, setAdminMessages] = useState([]);
  const [feedbackRequest, setFeedbackRequest] = useState(null);
  const [deskFileDrag, setDeskFileDrag] = useState(null);
  const [deskDropNotice, setDeskDropNotice] = useState(null);
  const [incomingPaperFile, setIncomingPaperFile] = useState(null);
  const deskDragDepth = useRef(0);
  const deskDropNoticeTimer = useRef(null);
  const offeredErrorReports = useRef(new Set());
  // The welcome modal greets every fresh demo visit. Returning from its
  // viewer is still the same visit, so consume the viewer's one-shot marker
  // rather than greeting the user again after the full-page transition.
  const [demoIntroSeen, setDemoIntroSeen] = useState(() => {
    const returnedFromViewer = window.sessionStorage.getItem('papol.viewerReturn') === '1';
    window.sessionStorage.removeItem('papol.viewerReturn');
    return returnedFromViewer;
  });
  const [showMacosDownloadBanner, setShowMacosDownloadBanner] = useState(
    () => !DESKTOP && !macosBannerWasDismissed(),
  );

  // State-machine precedence is deliberate: an explicit demo URL wins;
  // otherwise a real authenticated user wins; guest is only the public
  // fallback when neither of those primary modes applies.
  const mode = route.demo ? 'demo' : user ? 'signed-in' : 'guest';

  const offerErrorReport = useCallback((error, area) => {
    const report = unexpectedDesktopErrorReport(error, area, {
      runtime: DESKTOP ? 'desktop' : 'web',
      surface: window.__PAPOL_ENV__?.surface,
      platform: navigator.platform,
    });
    if (offeredErrorReports.current.has(report.signature)) return;
    offeredErrorReports.current.add(report.signature);
    void recordDiagnosticEvent({
      level: 'error', component: 'frontend', event: 'unexpected_error',
      message: error?.message || String(error),
      fields: { error_type: error?.name || typeof error, operation: area },
    });
    setFeedbackRequest((current) => current || ({
      key: `error:${report.signature}`,
      content: report.content,
      reportError: true,
    }));
  }, []);

  // Every runtime offers to report an unexpected error: an error nobody
  // hears about is an error that stays.
  useEffect(() => {
    const onError = (event) => offerErrorReport(event.error || event.message, 'JavaScript runtime');
    const onRejection = (event) => offerErrorReport(event.reason, 'unhandled promise');
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, [offerErrorReport]);

  useEffect(() => {
    if (!DESKTOP) return undefined;
    if (startupError) offerErrorReport(startupError, 'desktop startup');
    void recordDiagnosticEvent({
      component: 'frontend', event: 'mounted', fields: { surface: 'desk' },
    });
    // What the synchronizer already learned comes first, so a window opened
    // without a network still carries yesterday's answer; then ask, because
    // the user may have just installed the version that fixes it.
    void (async () => {
      const remembered = await nativeCompatibilityVerdict();
      if (remembered) setClientCompatibility({ verdict: remembered });
      await checkClientCompatibility();
    })();
    const onNativeError = (event) => offerErrorReport(
      event.detail?.error || 'Unknown native command error',
      event.detail?.area || 'native command',
    );
    window.addEventListener(REPORTABLE_NATIVE_ERROR_EVENT, onNativeError);
    return () => {
      window.removeEventListener(REPORTABLE_NATIVE_ERROR_EVENT, onNativeError);
    };
  }, [offerErrorReport, startupError]);

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
      await storeCredential(null);
      setUser(null);
    }
  };

  useEffect(() => {
    const importIntoDesk = mode === 'signed-in';
    const openInViewer = DESKTOP && mode === 'guest';
    if (!importIntoDesk && !openInViewer) return undefined;
    const resetDrag = () => {
      deskDragDepth.current = 0;
      setDeskFileDrag(null);
    };
    const showNotice = (message) => {
      setDeskDropNotice(message);
      window.clearTimeout(deskDropNoticeTimer.current);
      deskDropNoticeTimer.current = window.setTimeout(
        () => setDeskDropNotice(null), 4000,
      );
    };
    const dragEnter = (event) => {
      if (!carriesFiles(event.dataTransfer) || event.defaultPrevented) return;
      event.preventDefault();
      deskDragDepth.current += 1;
      setDeskFileDrag(deskFileDragState(event.dataTransfer));
    };
    const dragOver = (event) => {
      if (!carriesFiles(event.dataTransfer) || event.defaultPrevented) return;
      event.preventDefault();
      const state = deskFileDragState(event.dataTransfer);
      event.dataTransfer.dropEffect = state === 'reject' ? 'none' : 'copy';
      setDeskFileDrag(state);
    };
    const dragLeave = (event) => {
      if (!carriesFiles(event.dataTransfer)) return;
      deskDragDepth.current = Math.max(0, deskDragDepth.current - 1);
      if (deskDragDepth.current === 0) setDeskFileDrag(null);
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
        showNotice('Papol’s Desk only supports PDF files.');
        return;
      }
      setDeskDropNotice(null);
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
      window.clearTimeout(deskDropNoticeTimer.current);
    };
  }, [mode]);

  const dismissDemoIntro = () => setDemoIntroSeen(true);

  const demoIntroVisible = mode === 'demo' && Boolean(user) && !demoIntroSeen;
  const demoDialogRef = useModalDialog(demoIntroVisible, dismissDemoIntro);

  useEffect(() => {
    const onRouteChange = async () => {
      const next = parseRoute();
      setRoute(next);
      if (next.demo && !route.demo) {
        resetDemo();
        setDemoError(null);
        setUser(null);
        try {
          const demoUser = await getMe();
          if (inDemo()) setUser(demoUser);
        } catch (error) {
          if (inDemo()) setDemoError(error.message);
        }
      } else if (!next.demo && route.demo) {
        resetDemo();
        await restoreRealUser();
      }
    };
    window.addEventListener('popstate', onRouteChange);
    return () => window.removeEventListener('popstate', onRouteChange);
  }, [route.demo]);

  useEffect(() => {
    // A canonical paper URL is public and real. Do not route a signed-out
    // recipient into the fictional demo before that paper is opened.
    const initialRoute = parseRoute();
    if (initialRoute.demo) {
      resetDemo();
      getMe().then((demoUser) => { if (inDemo()) setUser(demoUser); })
        .catch((error) => { if (inDemo()) setDemoError(error.message); })
        .finally(() => setAuthChecked(true));
      return;
    }
    resetDemo();
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
        getMe().then(setUser).catch(() => storeCredential(null)).finally(() => setAuthChecked(true));
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
        await storeCredential(null);
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
      .then((d) => setUnreadCount(d.notifications.filter((n) => !n.read).length))
      .catch(() => {});
  }, [user, route]);

  useEffect(() => {
    let cancelled = false;
    if (mode !== 'signed-in' || !getToken()) {
      setAdminMessages([]);
      return undefined;
    }
    getPendingAdminMessages()
      .then((messages) => {
        if (!cancelled) setAdminMessages(messages);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [user?.uuid, mode]);

  // The server refused a request for want of a session: a visitor opened a
  // link to something that needs one, or a session this Papol still held
  // has ended. Either way the answer is the sign-in page, not an error where
  // the page should be, and it leads back here once they have signed in.
  useEffect(() => subscribeUnauthenticated(() => {
    if (inDemo()) return;
    void storeCredential(null);
    // The desktop keeps the owner's local identity and work through a
    // rejected credential; only network access is gone until they sign in.
    if (!DESKTOP) setUser(null);
    const { page } = parseRoute();
    if (page === 'signin' || page === 'join') return;
    const here = `${stripAppBase(window.location.pathname)}${window.location.search}`;
    navigate(here === '/' ? '/signin' : `/signin?next=${encodeURIComponent(here)}`);
  }), []);

  // A document window asked for an account: a PDF opened from disk is being
  // added to a nook. Signing in happens here, in the Desk window.
  const signedInUser = useRef(user);
  signedInUser.current = user;
  useEffect(() => subscribeSignInRequests((request) => {
    if (!signedInUser.current || inDemo()) navigate(request?.register ? '/join' : '/signin');
  }), []);

  // Viewer and board windows have separate WebKit storage. Adopt an account
  // signed in there so the permanent Desk reflects it immediately.
  useEffect(() => subscribeNativeData((payload) => {
    if (inDemo() || !payload?.accountUuid || !payload.profile) return;
    setNativeAccount(payload.accountUuid);
    setUser(payload.profile);
    setAuthChecked(true);
  }), []);

  // A browser handoff is also a freshness boundary: reconcile account data
  // while the handed-off PDF is being opened.
  useEffect(() => subscribeNativeHandoffs(() => {
    void scheduleAutomaticNativeSync();
  }), []);

  // A document user can reveal its paper in the permanent Desk window.
  // Use the complete nook rather than whichever shelf or tag happened to be
  // open, so the selected row is always present in the list.
  useEffect(() => subscribeShowPaperRequests((paperSha256) => {
    rememberListing('all');
    const path = `/paper/${paperName(paperSha256)}`;
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
  // The desktop sidebar lists the user's shelves and tags, so the desktop
  // app keeps their nook loaded beside whatever is open.
  const nookState = useNook(DESKTOP && user ? user.uuid : null, route);
  const desktopListing = resolveListing(route, user, {
    search: window.location.search,
    lastShown: lastShownListing(),
  });
  const desktopGroups = desktopNavigation({
    user, route, unreadCount, nook: nookState.nook, listing: desktopListing,
  });
  useDesktopShortcuts({ groups: desktopGroups, onNavigate: navigate });

  const handleAuth = ({ token, user }) => {
    const requestedPage = new URLSearchParams(window.location.search).get('next');
    const currentPath = stripAppBase(window.location.pathname || '/');
    const candidate = requestedPage || currentPath;
    // Only our own pages, and only ones worth being returned to. A
    // visitor who signed in to keep a paper somebody shared with them is
    // brought back to the link they were reading, where the paper is
    // still theirs to add.
    const returnTo = candidate.startsWith('/paper/')
      || candidate.startsWith('/boards/')
      || candidate.startsWith('/viewer/')
      ? candidate
      : '/';
    resetDemo();
    // login/register already persisted the credential for this account.
    setUser(user);
    // Surfaces of their own, built and served separately from this one:
    // reaching them is a navigation, not a route change.
    if (returnTo.startsWith('/boards/') || returnTo.startsWith('/viewer/')) {
      window.location.replace(appPath(returnTo));
      return;
    }
    navigate(returnTo);
  };

  const handleBackToAccount = async () => {
    window.history.replaceState(null, '', appPath('/'));
    setRoute(parseRoute());
    resetDemo();
    await restoreRealUser();
  };

  const handleDemo = () => {
    navigate('/demo');
  };

  const handleLogout = async () => {
    if (inDemo()) {
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
    // In the browser there is nothing local to lose: no downloaded papers, no
    // offline changes. Only the desktop app, which keeps both on the machine,
    // has to ask before throwing them away.
    if (DESKTOP) {
      let pending = null;
      try { pending = await pendingLocalChanges(); } catch { /* still allow sign-out */ }
      const warning = pending > 0
        ? `Signing out deletes this account's downloaded data and local changes from this Mac. ` +
          `${pending} unsynced ${pending === 1 ? 'change will' : 'changes will'} be permanently lost. Sign out?`
        : `Signing out deletes this account's downloaded data and local changes from this Mac. ` +
          'Any unsynced changes will be permanently lost. Sign out?';
      const leave = await confirmAction(warning, { confirmLabel: 'Sign out' });
      if (!leave) return;
    }
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
    resetDemo();
    setUser(null);
    navigate('/');
  };

  if (route.demo && demoError) {
    return (
      <>
        <style>{applicationStyles}</style>
        <div className="loading" role="alert">
          <p>{demoError}</p>
          <a href={appPath('/')}>Back to Papol</a>
        </div>
      </>
    );
  }

  if (!authChecked || (route.demo && !user)) {
    return (
      <>
        <style>{applicationStyles}</style>
        <div className="loading" role="status" aria-live="polite">Loading…</div>
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

  // A jacket always has a Back, and it always leads to a place works
  // are kept: the nook or Desk this one was opened from, or — for a link
  // someone was sent, with no such place behind it — the user's own nook,
  // and the Desk for a visitor. It used to be hidden whenever the page
  // was not reached by an in-app click, which includes every return from
  // the viewer: the most travelled road onto this page had no way off it.
  const jacketBack = jacketBackTarget({ origin: readJacketOrigin(), userUuid: user?.uuid });
  const goBackFromJacket = () => {
    // When that place is the entry just behind this one, step back onto it
    // rather than stacking a second copy of it on top.
    if (window.history.state?.papolBackHref === mountedPath(jacketBack.path)) window.history.back();
    else navigate(jacketBack.path);
  };

  const guestNeedsSignIn = mode === 'guest' && SIGN_IN_PAGES.has(route.page);

  const routeAppLinks = (event) => {
    const anchor = event.target.closest?.('a[href^="/"]');
    const href = anchor?.getAttribute('href');
    // A control inside a link (the × that leaves a seminar cohort sits on the
    // user's chip) is its own action. This runs on the way down, before
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
      <div ref={demoDialogRef} className="modal-box" role="dialog" aria-modal="true" aria-labelledby="demo-intro-title" tabIndex="-1" onClick={(e) => e.stopPropagation()}>
        <div className="panel demo-intro">
          <h3 id="demo-intro-title">Welcome to Papol</h3>
          <p>
            Papol is your paper reading companion. Stay close to the ideas
            that matter, and the people thinking about them.
          </p>
          <p>
            You are looking at the demo: you play as SpongeBob among
            fictional users. Changes last only for this temporary visit.
            Some features are not supported in the demo.
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

  const demoBanner = user && inDemo() && (
    <div className="demo-banner">
      <span>
        Demo mode — everything here is fictional and happens in your
        browser. Nothing is saved.
      </span>
      {getToken() ? (
        <a className="demo-banner-button" href={appPath('/')} onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
          event.preventDefault();
          handleBackToAccount();
        }}>
          Back to my account
        </a>
      ) : (
        <span className="demo-banner-actions">
          <button
            className="demo-banner-button"
            onClick={() => navigate('/join')}
          >
            Create a real account
          </button>
          <button
            className="link-button demo-banner-link"
            onClick={() => navigate('/signin')}
          >
            Sign in
          </button>
        </span>
      )}
    </div>
  );

  const macosDownloadBanner = showMacosDownloadBanner && (
    <div className="macos-download-banner" role="status">
      <span>Papol is now available as a Mac app.</span>
      <a href={MACOS_DOWNLOAD_URL} target="_blank" rel="noreferrer">
        Download for macOS
      </a>
      <button
        type="button"
        className="dismiss-button macos-download-banner-dismiss"
        aria-label="Dismiss macOS app announcement"
        onClick={() => {
          // The banner can still be dismissed for this visit when storage
          // is unavailable, which is what a refused write reports.
          setFeatureState(MACOS_DOWNLOAD_BANNER_DISMISSED, true);
          setShowMacosDownloadBanner(false);
        }}
      >
        ×
      </button>
    </div>
  );

  const feedbackDialog = feedbackRequest && (
    <FeedbackDialog
      key={feedbackRequest.key}
      submit={submitFeedback}
      initialContent={feedbackRequest.content}
      reportError={feedbackRequest.reportError}
      onClose={() => setFeedbackRequest(null)}
    />
  );

  const adminMessageDialog = adminMessages.length > 0 && (
    <AdminMessageDialog
      key={adminMessages[0].uuid}
      message={adminMessages[0]}
      onDismissed={(uuid) => {
        setAdminMessages((messages) => messages.filter((message) => message.uuid !== uuid));
      }}
    />
  );

  // Keyed by world and identity: leaving or entering the demo, or changing
  // real accounts, remounts every page so no nook or private paper state can
  // survive an identity boundary.
  // The boundary is keyed by the route, so a crash stays on the page that
  // raised it and leaving that page starts clean.
  const pages = (
    <ErrorBoundary
      key={`${route.page}:${route.uuid ?? ''}`}
      area={`the ${route.page} page`}
    >
    <main className="main-content" key={`${mode}:${user?.uuid ?? 'none'}`}>
      {guestNeedsSignIn ? (
        <AuthPage onAuth={handleAuth} initialMode="login" />
      ) : (
      <>
      {route.page === 'home' &&
        (user ? (
          <Nook
            userUuid={user.uuid}
            currentUser={user}
            onSelectPaper={(sha256) => navigate(`/paper/${paperName(sha256)}`)}
            onSelectBoard={openBoard}
          />
        ) : DESKTOP ? (
          // The desktop app opens on signing in, not on a pitch for Papol.
          <AuthPage onAuth={handleAuth} initialMode="login" />
        ) : (
          <HomePage
            currentUser={user}
            onDemo={inDemo() ? undefined : handleDemo}
          />
        ))}
      {route.page === 'nook' && (
        <Nook
          onReportableError={offerErrorReport}
          userUuid={route.uuid}
          currentUser={user}
          onSelectPaper={(sha256) => navigate(`/paper/${paperName(sha256)}`)}
          onSelectBoard={openBoard}
          initialSection={route.section}
          onBack={goBack}
          backHref={backHref}
        />
      )}
      {route.page === 'paper' && (
        <PaperJacket
          paperSha256={route.uuid}
          currentUser={user}
          onRead={DESKTOP ? (href) => openDesktopDocumentWindow(href, 'popup,width=1100,height=820') : undefined}
          onBack={goBackFromJacket}
          backHref={mountedPath(jacketBack.path)}
          backLabel={jacketBack.label}
          onSelectPaper={(sha256) => navigate(`/paper/${paperName(sha256)}`)}
          onReportableError={offerErrorReport}
        />
      )}
      {route.page === 'board' && (
        <BoardJacket
          boardUuid={route.uuid}
          currentUser={user}
          onOpen={openBoardCanvas}
          onBack={goBackFromJacket}
          backHref={mountedPath(jacketBack.path)}
          backLabel={jacketBack.label}
        />
      )}
      {route.page === 'papers' && (
        <PapersPage
          onReportableError={offerErrorReport}
          currentUser={user}
          onSelectPaper={(sha256) => navigate(`/paper/${paperName(sha256)}`)}
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
          onDemo={inDemo() ? undefined : handleDemo}
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
              nookState.reload();
              setSyncRefresh((revision) => revision + 1);
            }}
          />
        ) : null)}
      </>
      )}
    </main>
    </ErrorBoundary>
  );

  // Papol macOS: a sidebar of listings in place of the website masthead.
  // Reading happens in a three-pane browser — listing, list, paper — and every
  // other page fills the space beside the sidebar.
  if (DESKTOP) {
    const movePaperToShelf = async (paperSha256, shelfUuid) => {
      try {
        await updatePaper(paperSha256, { shelf_uuid: shelfUuid });
      } catch (err) {
        setDesktopNotice(err.message);
        window.setTimeout(() => setDesktopNotice(null), 5000);
      }
      nookState.reload();
    };
    return (
      <>
        <style>{applicationStyles}</style>
        <DeskFileDropFeedback
          state={deskFileDrag}
          message={deskDropNotice}
          opensViewer={mode === 'guest'}
        />
        {demoIntro}
        <CompatibilityGate />
        {adminMessageDialog}
        {feedbackDialog}
        {managingNook && nookState.nook && (
          <NookManager
            nook={nookState.nook}
            setNook={nookState.setNook}
            onChanged={nookState.reload}
            onClose={() => setManagingNook(false)}
            onTagDeleted={(tagUuid) => { if (desktopListing === `tag:${tagUuid}`) navigate('/'); }}
          />
        )}
        <div className="desktop-app" onClickCapture={routeAppLinks}>
          <DesktopSidebar
            groups={desktopGroups}
            user={user}
            profileActive={route.page === 'profile'}
            onFeedback={() => setFeedbackRequest({ key: `manual:${Date.now()}`, content: '', reportError: false })}
            onManageNook={nookState.nook ? () => setManagingNook(true) : undefined}
            onMovePaper={nookState.nook ? movePaperToShelf : undefined}
            onNavigate={navigate}
            onReportableError={(report) => setFeedbackRequest((current) => current || ({
              key: `error:${report.signature}`,
              content: report.content,
              reportError: true,
            }))}
            onSync={() => {
              nookState.reload();
              setSyncRefresh((revision) => revision + 1);
            }}
            notice={desktopNotice}
          />
          {isBrowsing(route, user) ? (
            <DesktopBrowser
              key={`${mode}:${user.uuid}`}
              listing={desktopListing}
              route={route}
              currentUser={user}
              nookState={nookState}
              onNavigate={navigate}
              onOpenBoard={openBoard}
              onSyncRefresh={syncRefresh}
              banner={demoBanner}
              incomingPaperFile={incomingPaperFile}
              onIncomingPaperFileHandled={() => setIncomingPaperFile(null)}
              onReportableError={offerErrorReport}
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
      <DeskFileDropFeedback state={deskFileDrag} message={deskDropNotice} />
      {demoIntro}
      {adminMessageDialog}
      {macosDownloadBanner}
      {demoBanner}
      <button
        type="button"
        className="feedback-button"
        onClick={() => setFeedbackRequest({ key: `manual:${Date.now()}`, content: '', reportError: false })}
        title="Report a bug or ask for a feature"
      >
        Feedback
      </button>
      {feedbackDialog}
      {/* Which page this URL opened, said out loud. The browser smoke
          test and the health probe read it to tell a link that arrived
          from one that quietly fell through to the home page. */}
      <div className="app" data-page={route.page} onClickCapture={routeAppLinks}>
        <header className="topnav">
          <a className="brand" href={appPath('/')}>Papol</a>
          <nav>
            {user ? (
              <a
                href={appPath('/')}
                className={
                  route.page === 'home' || route.page === 'board' ||
                  (route.page === 'nook' && route.uuid === user.uuid)
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
            <a
              className="macos-download-link"
              href={MACOS_DOWNLOAD_URL}
              target="_blank"
              rel="noreferrer"
              aria-label="Download Papol macOS"
              title="Download Papol macOS"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <path d="M8 2.5v7m0 0 3-3m-3 3-3-3M3 11.5v2h10v-2" />
              </svg>
              Mac app
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
                  <span className="badge inbox-badge">{unreadCount}</span>
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
