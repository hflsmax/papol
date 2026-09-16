import React from 'react';
import BoardPage from './BoardPage.jsx';
import { applicationStyles } from '../../shared/applicationStyles.js';
import CompatibilityBar from '../../shared/ui/CompatibilityBar.jsx';
import { getToken } from '../../shared/api/account.js';
import { closeDesktopDocumentWindow } from '../../shared/desktopShell.js';
import { boardHomePath } from '../../shared/appUrls.js';

function route() {
  const match = window.location.pathname.match(/\/(?:demo\/)?boards\/([^/]+)\/?$/);
  return match && match[1] !== 'index.html'
    ? decodeURIComponent(match[1])
    : new URLSearchParams(window.location.search).get('board');
}

const boardReturnPath = (board) => boardHomePath(board, {
  demo: window.location.pathname.includes('/demo/boards/'),
});

function returnToPapol(board) {
  if (closeDesktopDocumentWindow()) return;
  window.location.assign(boardReturnPath(board));
}

export default function App() {
  const boardUuid = route();
  const inDemo = window.location.pathname.includes('/demo/boards/') ||
    new URLSearchParams(window.location.search).get('demo') === '1';
  if (!inDemo && !getToken()) {
    const marker = '/boards/';
    const base = window.location.pathname.slice(0, window.location.pathname.indexOf(marker));
    const next = window.location.pathname.slice(base.length);
    window.location.replace(`${base}/signin?next=${encodeURIComponent(next)}`);
    return null;
  }
  return <>
    <style>{applicationStyles}</style>
    <CompatibilityBar />
    {boardUuid
      ? <BoardPage boardUuid={boardUuid} onBack={returnToPapol} backHref={boardReturnPath} />
      : <main className="empty-state"><h1>No board given</h1><p>Open a board from Papol.</p></main>}
  </>;
}
