import React from 'react';
import BoardPage from './BoardPage.jsx';
import { applicationStyles } from '../../shared/applicationStyles.js';
import CompatibilityBar from '../../shared/ui/CompatibilityBar.jsx';
import MacHandoffBar from '../../shared/ui/MacHandoffBar.jsx';
import { getToken } from '../../shared/api/account.js';
import { closeDesktopDocumentWindow } from '../../shared/desktopShell.js';
import { homePath } from '../../shared/appUrls.js';

function route() {
  const match = window.location.pathname.match(/\/(?:demo\/)?boards\/([^/]+)\/?$/);
  return match && match[1] !== 'index.html'
    ? decodeURIComponent(match[1])
    : new URLSearchParams(window.location.search).get('board');
}

const papolHome = () => homePath({
  demo: window.location.pathname.includes('/demo/boards/'),
});

function goHome() {
  if (closeDesktopDocumentWindow()) return;
  window.location.assign(papolHome());
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
    <MacHandoffBar />
    {boardUuid
      ? <BoardPage boardUuid={boardUuid} onHome={goHome} homeHref={papolHome} />
      : <main className="empty-state"><h1>No board given</h1><p>Open a board from Papol.</p></main>}
  </>;
}
