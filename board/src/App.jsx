import React from 'react';
import BoardPage from './BoardPage.jsx';
import { applicationStyles } from '../../shared/applicationStyles.js';
import CompatibilityGate from '../../shared/ui/CompatibilityGate.jsx';
import MacHandoffBar from '../../shared/ui/MacHandoffBar.jsx';
import { getToken } from '../../shared/api/account.js';
import { closeDesktopDocumentWindow } from '../../shared/desktopShell.js';
import { boardJacketPath } from '../../shared/appUrls.js';
import { homePath } from '../../shared/appUrls.js';

function route() {
  const match = window.location.pathname.match(/\/(?:demo\/)?boards\/([^/]+)\/?$/);
  return match && match[1] !== 'index.html'
    ? decodeURIComponent(match[1])
    : new URLSearchParams(window.location.search).get('board');
}

const inDemoBoards = () => window.location.pathname.includes('/demo/boards/');

/**
 * Where the house leads: out of this board and into where the board is kept,
 * which is its jacket in the Desk. The viewer's house has always worked
 * this way — out of the paper and onto the paper's jacket — and it falls back
 * to Papol itself only for a reading that has no jacket to go to, a shared
 * link or a file opened from disk. A board always has one, because opening
 * its canvas already asked who you are.
 */
const papolHome = (uuid) => (uuid
  ? boardJacketPath(uuid, { demo: inDemoBoards() })
  : homePath({ demo: inDemoBoards() }));

function goHome(uuid) {
  if (closeDesktopDocumentWindow()) return;
  window.location.assign(papolHome(uuid));
}

export default function App() {
  const boardUuid = route();
  const inDemo = inDemoBoards() || new URLSearchParams(window.location.search).get('demo') === '1';
  if (!inDemo && !getToken()) {
    const marker = '/boards/';
    const base = window.location.pathname.slice(0, window.location.pathname.indexOf(marker));
    const next = window.location.pathname.slice(base.length);
    window.location.replace(`${base}/signin?next=${encodeURIComponent(next)}`);
    return null;
  }
  return <>
    <style>{applicationStyles}</style>
    <CompatibilityGate />
    <MacHandoffBar />
    {boardUuid
      ? <BoardPage
          boardUuid={boardUuid}
          onHome={() => goHome(boardUuid)}
          homeHref={() => papolHome(boardUuid)}
        />
      : <main className="empty-state"><h1>No board given</h1><p>Open a board from Papol.</p></main>}
  </>;
}
