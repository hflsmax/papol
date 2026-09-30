import React, { useCallback, useState, useEffect, useLayoutEffect, useRef } from 'react';
import { Working } from '../../shared/ui/Waiting.js';
import {
  getMe, getToken, logout, pendingLocalChanges,
  refreshStartupUser,
} from '../../shared/api/account.js';
import { getNotifications, getPendingAdminMessages } from '../../shared/api/notifications.js';
import { updatePaper } from '../../shared/api/papers.js';
import AuthPage from './components/AuthPage';
import ErrorBoundary from '../../shared/ui/ErrorBoundary.jsx';
import Nook from './components/Nook';
import { forgetLastMember, lastMember, rememberLastMember } from './lastMember';
import BoardJacket from './components/BoardJacket';
import PaperJacket from './components/PaperJacket';
import { storeCredential } from '../../shared/credentials.js';
import ProfilePage from './components/ProfilePage';
import PapersPage from './components/PapersPage';
import InboxPage from './components/InboxPage';
import AdminPage from './components/AdminPage';
import HomePage from './components/HomePage';
import AboutPage from './components/AboutPage';
import LearnPage from './components/LearnPage';
import ProjectsPage from './components/ProjectsPage';
import YouPage from './components/YouPage';
import ProjectPage from './components/ProjectPage';
import InvitationPage from './components/InvitationPage';
import { listProjects } from '../../shared/api/projects.js';
import { BAZAAR, WayBar, WayFoot, WayShown } from './components/Way';
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
import SyncAttention from './components/SyncAttention';
import { appPath, stripAppBase } from './base';
import { parseRoute } from './routes';
import {
  originAfterMove, jacketBackTarget, readJacketOrigin, writeJacketOrigin,
} from './jacketOrigin';
import { paperName } from '../../shared/paperName.js';
import { subscribeUnauthenticated } from '../../shared/httpClient.js';
import { DESKTOP, openDesktopDocumentWindow } from '../../shared/desktopShell';
import { confirmAction } from '../../shared/confirmAction';
import DeskFileDropFeedback from '../../shared/ui/FileDropFeedback.jsx';
import { handOverDroppedPdfs, takeDroppedPdfs } from '../../shared/droppedPapers.js';
import { carriesFiles, isPdfFile, deskFileDragState } from '../../shared/fileDrop.js';
import { droppedFolder, severalPdfs } from './agentFolder.js';
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

// Where a member works inside one project.
export const PROJECT_PAGES = new Set(['project']);

const SIGN_IN_PAGES = new Set([
  'nook', 'shelf', 'papers', 'inbox', 'admin', 'profile',
  'projects', 'project', 'invitation',
]);

// The macOS application is signed, notarized, and attached to this project's
// GitHub releases by .github/workflows/desktop-macos.yml.
const MACOS_DOWNLOAD_URL = 'https://github.com/hflsmax/papol/releases';

// Closing this is one of the things a browser remembers about a user, so it
// is named in shared/featureStates.js rather than here, and Admin can bring
// the banner back without knowing anything about this file.
const macosBannerWasDismissed = () => isFeatureStateSet(MACOS_DOWNLOAD_BANNER_DISMISSED);

// A path as the address bar spells it: under the base the app is served from.
const mountedPath = (path) => appPath(path);

// Told of a move to a path no page answers; App offers the report.
let reportUnknownPage = () => {};

function navigate(path, { replace = false } = {}) {
  const mountedDestination = mountedPath(path);
  // A move to nowhere is the app's own bug: it is reported, and the page
  // stays where it is rather than showing another in its place.
  const destination = parseRoute(new URL(mountedDestination, window.location.origin).pathname);
  if (destination.page === 'unknown') {
    reportUnknownPage(destination.path);
    return;
  }
  // Don't push a history entry when already there; otherwise Back appears
  // to do nothing.
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
    // Back returns to this page as it was left, scrolled where it was.
    window.history.replaceState({ ...(window.history.state || {}), papolScroll: window.scrollY }, '');
    window.history.pushState(
      { papolNavigation: true, papolBackHref: `${window.location.pathname}${window.location.search}` },
      '',
      mountedDestination,
    );
  }
  window.dispatchEvent(new PopStateEvent('popstate'));
  if (!replace) window.scrollTo(0, 0);
}

// A board row opens the board's jacket, as a paper row opens a paper's: the
// The Desk shows what it holds, and opening the work itself is the next step.
function openBoard(uuid) {
  navigate(`/board/${uuid}`);
}

// Paths served by the board canvas and the PDF viewer, not by this app.
const OTHER_APPLICATIONS = ['/boards/', '/viewer/'];

// On the web every thing has one path (frontend/DESIGN.md, Navigation), and
// a signed-in member sees these ones inside their nook, beside its rail.
const NOOK_PAGES = new Set(['home', 'shelf', 'board', 'project', 'paper']);

// Where a PDF dropped on the window is taken in: on the web the member's
// own nook, whose papers it joins, straight into its upload; the Mac app's
// Library holds the one upload box it has.
const DROP_PLACE = DESKTOP ? '/library' : '/';

// Links from before things had paths: /?shelf=…&paper=… and the like.
function nookPathFromQuery(search) {
  const query = new URLSearchParams(search);
  const [shelf, board, project, paper] = ['shelf', 'board', 'project', 'paper'].map((key) => query.get(key));
  if (project) return `/project/${project}`;
  const place = board ? `/board/${board}` : shelf ? `/shelf/${shelf}` : '';
  if (paper) return `${place}/paper/${paper}`;
  return place || null;
}

// The way in, from the jacket. The canvas is a separate application, so this
// leaves the Desk — on the desktop into a document window beside it, on
// the web by going there.
function openBoardCanvas(uuid) {
  const path = appPath(`/boards/${uuid}`);
  if (DESKTOP) {
    openDesktopDocumentWindow(path, 'popup,width=1200,height=820');
    return;
  }
  window.location.assign(path);
}

export default function App({ startupUser = null, startupError = null }) {
  // A member coming back on the web opens the app as they left it, while
  // the sign-in is checked in the background.
  const [returning] = useState(() => (!DESKTOP && !startupUser && getToken() ? lastMember() : null));
  const [user, setUser] = useState(startupUser ?? returning);
  // Desktop hydrates its trusted local account before React mounts. On the
  // web, a visitor with no token is already known to be a guest. Only a web
  // credential or a first desktop sign-in still needs to gate the shell.
  const [authChecked, setAuthChecked] = useState(() => DESKTOP || Boolean(startupUser || returning) || !getToken());
  const [route, setRoute] = useState(parseRoute());
  const [unreadCount, setUnreadCount] = useState(0);
  const [projectsRevision, setProjectsRevision] = useState(0);
  const [myProjects, setMyProjects] = useState([]);
  const [adminMessages, setAdminMessages] = useState([]);
  const [feedbackRequest, setFeedbackRequest] = useState(null);
  const [deskFileDrag, setDeskFileDrag] = useState(null);
  const [deskDropNotice, setDeskDropNotice] = useState(null);
  const [incomingPaperFile, setIncomingPaperFile] = useState(null);
  const [incomingPaperFolder, setIncomingPaperFolder] = useState(null);
  const deskDragDepth = useRef(0);
  const deskDropNoticeTimer = useRef(null);
  const offeredErrorReports = useRef(new Set());
  const [showMacosDownloadBanner, setShowMacosDownloadBanner] = useState(
    () => !DESKTOP && !macosBannerWasDismissed(),
  );

  // An authenticated user is signed in; guest is the public fallback.
  const mode = user ? 'signed-in' : 'guest';

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

  // A path no page answers, moved to in the app or arrived at from outside,
  // is offered as a report.
  useEffect(() => {
    reportUnknownPage = (path) => offerErrorReport(new Error(`No page at ${path}`), 'navigation');
    return () => { reportUnknownPage = () => {}; };
  }, [offerErrorReport]);

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

  useEffect(() => {
    const importIntoDesk = mode === 'signed-in';
    const openInViewer = DESKTOP && mode === 'guest';
    // A visitor on the web: the PDFs are kept for the nook they are about
    // to sign in to, and its upload takes them once they have.
    const keepForSignIn = !DESKTOP && mode === 'guest';
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
      // A folder is one an agent gathered (USER_STORIES.md §2c): it opens
      // the folder's review. Its entry is read now, while the drop lasts.
      if (keepForSignIn) {
        const pdfs = Array.from(event.dataTransfer.files || []).filter(isPdfFile);
        if (!pdfs.length) {
          showNotice('Papol’s Desk only supports PDF files.');
          return;
        }
        if (await handOverDroppedPdfs(pdfs)) navigate('/signin');
        else showNotice('Sign in to add papers.');
        return;
      }
      const folder = droppedFolder(event.dataTransfer);
      if (folder) {
        if (openInViewer) {
          showNotice('Sign in to add a folder of papers.');
          return;
        }
        setDeskDropNotice(null);
        setIncomingPaperFolder({ uuid: globalThis.crypto.randomUUID(), entry: folder });
        navigate(DROP_PLACE);
        return;
      }
      const files = Array.from(event.dataTransfer.files || []);
      // Several PDFs are a batch: the folder's review takes them, as it
      // takes a folder with no manifest.
      const several = severalPdfs(files);
      if (several.length) {
        if (openInViewer) {
          showNotice('Sign in to add several papers at once.');
          return;
        }
        setDeskDropNotice(null);
        setIncomingPaperFolder({ uuid: globalThis.crypto.randomUUID(), files: several });
        navigate(DROP_PLACE);
        return;
      }
      if (files.length !== 1) {
        showNotice(files.length ? 'Papol’s Desk only supports PDF files.' : 'Drop a PDF to import.');
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
      navigate(DROP_PLACE);
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

  // PDFs dropped in the viewer, handed over on the way here: the nook's
  // upload takes them as if they had been dropped on it.
  useEffect(() => {
    if (DESKTOP || mode !== 'signed-in') return;
    void takeDroppedPdfs().then((files) => {
      if (!files.length) return;
      const uuid = globalThis.crypto.randomUUID();
      if (files.length > 1) setIncomingPaperFolder({ uuid, files });
      else setIncomingPaperFile({ uuid, file: files[0] });
      navigate('/', { replace: true });
    });
  }, [mode]);

  // Back and Forward return a page scrolled where it was left; a move
  // within the app (navigate) starts the next page at its top.
  const restoreScroll = useRef(null);
  useEffect(() => {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
    const onRouteChange = (event) => {
      restoreScroll.current = event.isTrusted ? window.history.state?.papolScroll ?? 0 : null;
      setRoute(parseRoute());
    };
    window.addEventListener('popstate', onRouteChange);
    return () => window.removeEventListener('popstate', onRouteChange);
  }, []);
  useLayoutEffect(() => {
    if (restoreScroll.current == null) return;
    window.scrollTo(0, restoreScroll.current);
    restoreScroll.current = null;
  }, [route]);
  // One arrived at leaves for the nook, whose path replaces it; this runs
  // after the Back listener above is in place, so the move is heard.
  useEffect(() => {
    if (route.page !== 'unknown') return;
    reportUnknownPage(route.path);
    navigate('/', { replace: true });
  }, [route]);
  useEffect(() => {
    if (route.page !== 'home') return;
    const path = nookPathFromQuery(window.location.search);
    if (path) navigate(path, { replace: true });
  }, [route]);

  useEffect(() => {
    const initialRoute = parseRoute();
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
        getMe().then(setUser).catch(() => { forgetLastMember(); setUser(null); return storeCredential(null); }).finally(() => setAuthChecked(true));
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
        // A stale session becomes an ordinary guest session, and what was
        // kept of the member goes with it.
        forgetLastMember();
        await storeCredential(null);
        setUser(null);
      })
      .finally(() => setAuthChecked(true));
  }, []);

  useEffect(() => {
    if (user && !DESKTOP) rememberLastMember(user);
  }, [user]);

  useEffect(() => {
    if (!user) {
      setUnreadCount(0);
      return;
    }
    getNotifications()
      .then((d) => setUnreadCount(d.notifications.filter((n) => !n.read).length))
      .catch(() => {});
  }, [user, route]);

  // The projects I am in, for the Mac app's sidebar.
  useEffect(() => {
    if (!user) {
      setMyProjects([]);
      return;
    }
    listProjects()
      .then((projects) => {
        const mine = projects.filter((project) => project.is_member);
        setMyProjects(mine);
      })
      .catch(() => {});
  }, [user, route, projectsRevision]);

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
  //
  // The desktop's synchronizer hears the same refusal on its own requests;
  // it is answered the same way, from the sync prompt below.
  const askToSignIn = useCallback(() => {
    void storeCredential(null);
    // The desktop keeps the owner's local identity and work through a
    // rejected credential; only network access is gone until they sign in.
    if (!DESKTOP) setUser(null);
    const { page } = parseRoute();
    if (page === 'signin' || page === 'join') return;
    const here = `${stripAppBase(window.location.pathname)}${window.location.search}`;
    navigate(here === '/' ? '/signin' : `/signin?next=${encodeURIComponent(here)}`);
  }, []);
  useEffect(() => subscribeUnauthenticated(askToSignIn), [askToSignIn]);

  // A document window asked for an account: a PDF opened from disk is being
  // added to a nook. Signing in happens here, in the Desk window.
  const signedInUser = useRef(user);
  signedInUser.current = user;
  useEffect(() => subscribeSignInRequests((request) => {
    if (!signedInUser.current) navigate(request?.register ? '/join' : '/signin');
  }), []);

  // Viewer and board windows have separate WebKit storage. Adopt an account
  // signed in there so the permanent Desk reflects it immediately.
  useEffect(() => subscribeNativeData((payload) => {
    if (!payload?.accountUuid || !payload.profile) return;
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
    user, route, unreadCount, projects: myProjects, nook: nookState.nook, listing: desktopListing,
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
    const returnTo = ['/paper/', '/shelf/', '/board/', '/project/', '/boards/', '/viewer/']
      .some((start) => candidate.startsWith(start))
      ? candidate
      : '/';
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

  const handleLogout = async () => {
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
    forgetLastMember();
    setUser(null);
    navigate('/');
  };

  if (!authChecked && !DESKTOP && NOOK_PAGES.has(route.page)) {
    // A member coming back to their nook: the bar alone while the sign-in
    // is checked, as it stays while the nook comes.
    return (
      <>
        <style>{applicationStyles}</style>
        <div className="app has-way" data-page={route.page}>
          <WayBar route={route} />
          <main className="main-content"><div className="nook is-desk" /></main>
          <WayFoot macDownloadUrl={MACOS_DOWNLOAD_URL} />
        </div>
      </>
    );
  }

  if (!authChecked) {
    return (
      <>
        <style>{applicationStyles}</style>
        <div className="loading"><Working label="Loading…" /></div>
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
    // A control inside a link is its own action. This runs on the way down, before
    // that control's handler could stop the click, so it has to step aside.
    const control = event.target.closest?.('button, input, select, textarea');
    if (control && anchor?.contains(control)) return;
    if (
      // Cmd-, Ctrl-, Shift- or middle-click: the browser opens a tab.
      event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
      !href ||
      // A place on this page: the browser scrolls to it.
      href.startsWith('#') ||
      anchor.hasAttribute('download') ||
      anchor.hasAttribute('data-document') ||
      (anchor.target && anchor.target !== '_self')
    ) return;
    const destination = new URL(href, window.location.origin);
    if (destination.origin !== window.location.origin) return;
    const routePath = stripAppBase(destination.pathname);
    // The canvas and the viewer are applications of their own: the browser
    // goes there, as it would from any page.
    if (OTHER_APPLICATIONS.some((prefix) => routePath.startsWith(prefix))) return;
    event.preventDefault();
    navigate(`${routePath}${destination.search}`);
  };

  // The page a visitor lands on offers Papol to try and nothing else: no
  // announcement over it, and no Feedback button over its text.
  const onLanding = route.page === 'home' && !user && !DESKTOP;

  const macosDownloadBanner = showMacosDownloadBanner && !onLanding && (
    <div className="macos-download-banner" role="status">
      <span>Papol for Mac: read your papers offline.</span>
      <a href={MACOS_DOWNLOAD_URL} target="_blank" rel="noreferrer">
        Download
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

  // A signed-in member on the web finds their way by one bar over every
  // page (Way.jsx), which carries each page's way back as well.
  const hasWay = Boolean(user) && !DESKTOP;
  // Those pages all draw the one nook, kept mounted as a member moves
  // through it so its list, filters and scroll are there on the way Back.
  const inNook = hasWay && NOOK_PAGES.has(route.page);

  // Keyed by identity: changing accounts remounts every page so no nook or
  // private paper state can survive an identity boundary.
  // The boundary is keyed by the route, so a crash stays on the page that
  // raised it and leaving that page starts clean.
  const pages = (
    <ErrorBoundary
      key={inNook ? 'nook' : `${route.page}:${route.uuid ?? ''}`}
      area={`the ${route.page} page`}
    >
    <main className="main-content" key={`${mode}:${user?.uuid ?? 'none'}`}>
      {guestNeedsSignIn ? (
        <AuthPage onAuth={handleAuth} initialMode="login" />
      ) : (
      <>
      {inNook ? (
          <Nook
            userUuid={user.uuid}
            currentUser={user}
            onSelectPaper={(sha256) => navigate(`/paper/${paperName(sha256)}`)}
            onSelectBoard={(uuid) => navigate(uuid ? `/board/${uuid}` : '/')}
            shelf={route.page === 'shelf' ? route.uuid : route.shelf ?? null}
            board={route.page === 'board' ? route.uuid : route.board ?? null}
            project={route.page === 'project' ? route.uuid : null}
            paper={route.page === 'paper' ? route.uuid : null}
            renderPaper={(name) => (
              <PaperJacket
                key={name}
                paperSha256={name}
                currentUser={user}
                hideBack
                onSelectPaper={(sha256) => navigate(`/paper/${paperName(sha256)}`)}
                onReportableError={offerErrorReport}
              />
            )}
            renderProject={(uuid) => (
              <ProjectPage
                key={uuid}
                projectUuid={uuid}
                currentUser={user}
                onChanged={() => setProjectsRevision((r) => r + 1)}
                onLeft={() => navigate('/', { replace: true })}
                onOpenBoard={openBoard}
              />
            )}
            onOpenProject={(uuid) => {
              setProjectsRevision((r) => r + 1);
              navigate(`/project/${uuid}`);
            }}
            onOpenCanvas={openBoardCanvas}
            incomingPaperFile={incomingPaperFile}
            onIncomingPaperFileHandled={() => setIncomingPaperFile(null)}
            incomingPaperFolder={incomingPaperFolder}
            onIncomingPaperFolderHandled={() => setIncomingPaperFolder(null)}
          />
      ) : route.page === 'home' &&
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
          <HomePage currentUser={user} />
        ))}
      {route.page === 'nook' && (
        <Nook
          onReportableError={offerErrorReport}
          userUuid={route.uuid}
          currentUser={user}
          onSelectPaper={(sha256) => navigate(`/paper/${paperName(sha256)}`)}
          onSelectBoard={openBoard}
          initialSection={route.section}
          onBack={hasWay ? undefined : goBack}
          backHref={backHref}
        />
      )}
      {!inNook && route.page === 'paper' && (
        <PaperJacket
          paperSha256={route.uuid}
          currentUser={user}
          onRead={DESKTOP ? (href) => openDesktopDocumentWindow(href, 'popup,width=1100,height=820') : undefined}
          hideBack={hasWay}
          onBack={goBackFromJacket}
          backHref={mountedPath(jacketBack.path)}
          backLabel={jacketBack.label}
          onSelectPaper={(sha256) => navigate(`/paper/${paperName(sha256)}`)}
          onReportableError={offerErrorReport}
        />
      )}
      {!inNook && route.page === 'board' && (
        <BoardJacket
          boardUuid={route.uuid}
          onOpen={openBoardCanvas}
          hideBack={hasWay}
          onBack={goBackFromJacket}
          onDeleted={() => navigate(jacketBack.path, { replace: true })}
          backHref={mountedPath(jacketBack.path)}
          backLabel={jacketBack.label}
        />
      )}
      {(route.page === 'papers' || (hasWay && route.page === 'projects')) && (
        <PapersPage
          projects={hasWay && (
            <ProjectsPage
              section
              currentUser={user}
              onOpenProject={(uuid) => navigate(`/project/${uuid}`)}
              onChanged={() => setProjectsRevision((r) => r + 1)}
            />
          )}
          currentUser={user}
          onSelectPaper={(sha256) => navigate(`/paper/${paperName(sha256)}`)}
          onSelectBoard={openBoard}
        />
      )}
      {!hasWay && route.page === 'projects' && (
        <ProjectsPage
          currentUser={user}
          onOpenProject={(uuid) => navigate(`/project/${uuid}`)}
          onChanged={() => setProjectsRevision((r) => r + 1)}
        />
      )}
      {!inNook && route.page === 'project' && (
        <ProjectPage
          key={route.uuid}
          projectUuid={route.uuid}
          currentUser={user}
          onBack={goBack}
          backHref={backHref}
          onChanged={() => setProjectsRevision((r) => r + 1)}
          onLeft={() => navigate('/projects', { replace: true })}
          onOpenBoard={openBoard}
          onRead={DESKTOP ? (href) => openDesktopDocumentWindow(href, 'popup,width=1100,height=820') : undefined}
        />
      )}
      {route.page === 'invitation' && (
        <InvitationPage
          code={route.code}
          currentUser={user}
          onOpenProject={(uuid, options) => navigate(`/project/${uuid}`, options)}
          onChanged={() => setProjectsRevision((r) => r + 1)}
        />
      )}
      {!hasWay && route.page === 'inbox' && (
        <InboxPage onUnread={setUnreadCount} />
      )}
      {route.page === 'admin' &&
        (user && user.is_admin ? (
          <AdminPage />
        ) : (
          <div className="panel">
            <p className="panel-note">Admin access only.</p>
          </div>
        ))}
      {route.page === 'about' && <AboutPage />}
      {route.page === 'learn' && <LearnPage />}
      {route.page === 'join' && (
        <AuthPage onAuth={handleAuth} initialMode="register" />
      )}
      {route.page === 'signin' && (
        <AuthPage onAuth={handleAuth} initialMode="login" />
      )}
      {hasWay && (route.page === 'profile' || route.page === 'inbox') && (
        <YouPage
          key={route.page}
          initialView={route.page === 'inbox' ? 'inbox' : 'activity'}
          user={user}
          unreadCount={unreadCount}
          onUnread={setUnreadCount}
          onUserUpdated={setUser}
          onLogout={handleLogout}
          onSync={() => {
            nookState.reload();
            setSyncRefresh((revision) => revision + 1);
          }}
        />
      )}
      {!hasWay && route.page === 'profile' &&
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
        <CompatibilityGate />
        <SyncAttention onSignedOut={askToSignIn} onDetails={() => navigate('/profile')} />
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
              onOpenBoard={openBoardCanvas}
              onSyncRefresh={syncRefresh}
              incomingPaperFile={incomingPaperFile}
              onIncomingPaperFileHandled={() => setIncomingPaperFile(null)}
              incomingPaperFolder={incomingPaperFolder}
              onIncomingPaperFolderHandled={() => setIncomingPaperFolder(null)}
              onReportableError={offerErrorReport}
            />
          ) : (
            <div className="desktop-pane">
              <DesktopToolbar title={desktopTitle(route, user, myProjects)} />
              <div className="desktop-scroll">
                <div className="desktop-content">{pages}</div>
              </div>
            </div>
          )}
        </div>
      </>
    );
  }

  // The pages inside a project fill the window: a member at work in a
  // project is not browsing Papol.
  const insideProject = user && PROJECT_PAGES.has(route.page) && !inNook;
  // Where a page leads back to on its way home to the nook, unless it
  // says so itself: a jacket to the place it was opened from, a nook of
  // someone else's to the Library their papers are found in.
  const wayTrail = inNook ? [] : (route.page === 'paper' || route.page === 'board') && jacketBack.path !== '/'
    ? [jacketBack.path === '/library' ? { path: '/bazaar', label: BAZAAR } : jacketBack]
    : route.page === 'nook' && route.uuid !== user?.uuid
      ? [{ path: '/bazaar', label: BAZAAR }]
      : [];
  return (
    <>
      <style>{applicationStyles}</style>
      <DeskFileDropFeedback state={deskFileDrag} message={deskDropNotice} folders={mode === 'signed-in'} />
      {adminMessageDialog}
      {macosDownloadBanner}
      {!onLanding && (
        <button
          type="button"
          className="feedback-button"
          onClick={() => setFeedbackRequest({ key: `manual:${Date.now()}`, content: '', reportError: false })}
          title="Report a bug or ask for a feature"
        >
          Feedback
        </button>
      )}
      {feedbackDialog}
      {/* Which page this URL opened, said out loud. The browser smoke
          test and the health probe read it to tell a link that arrived
          from one that quietly fell through to the home page. */}
      <div className={`app${insideProject ? ' is-project' : ''}${hasWay ? ' has-way' : ''}`} data-page={route.page} onClickCapture={routeAppLinks}>
        {hasWay && (
          <WayBar
            user={user}
            route={route}
            trail={wayTrail}
            unreadCount={unreadCount}
          />
        )}
        {!hasWay && <header className="topnav">
          <a className="brand" href={appPath('/')}>Papol</a>
          <nav>
            <a href={appPath('/')} className={route.page === 'home' ? 'active' : ''}>
              Home
            </a>
            <a href={appPath('/bazaar')} className={route.page === 'papers' ? 'active' : ''}>
              Bazaar
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
          {mode === 'guest' && (
            <button className="primary" onClick={() => navigate('/signin')}>
              Sign in
            </button>
          )}
        </header>}
        <WayShown.Provider value={hasWay}>{pages}</WayShown.Provider>
        {hasWay && !insideProject && <WayFoot macDownloadUrl={MACOS_DOWNLOAD_URL} />}
      </div>
    </>
  );
}
