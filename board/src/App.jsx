import React from 'react';
import BoardPage from './BoardPage.jsx';
import { styles } from '../../frontend/src/App.jsx';
import { getToken } from '../../frontend/src/api.js';

function route() {
  const match = window.location.pathname.match(/\/(?:demo\/)?boards\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function returnToPapol() {
  const pathname = window.location.pathname;
  const marker = pathname.includes('/demo/boards/') ? '/demo/boards/' : '/boards/';
  const base = pathname.slice(0, pathname.indexOf(marker));
  const home = pathname.includes('/demo/boards/') ? `${base}/demo` : `${base}/`;
  const saved = window.sessionStorage.getItem('papol.boardReturn');
  window.sessionStorage.removeItem('papol.boardReturn');
  const returnPath = saved?.startsWith(`${base}/`) && !saved.includes('/boards/')
    ? saved
    : home;
  window.location.assign(returnPath);
}

export default function App() {
  const boardId = route();
  const inDemo = window.location.pathname.includes('/demo/boards/');
  if (!inDemo && !getToken()) {
    const marker = '/boards/';
    const base = window.location.pathname.slice(0, window.location.pathname.indexOf(marker));
    const next = window.location.pathname.slice(base.length);
    window.location.replace(`${base}/signin?next=${encodeURIComponent(next)}`);
    return null;
  }
  return <>
    <style>{styles}</style>
    {boardId
      ? <BoardPage boardId={boardId} onBack={returnToPapol} />
      : <main className="empty-state"><h1>No board given</h1><p>Open a board from Papol.</p></main>}
  </>;
}
