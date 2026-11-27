import { useEffect, useState } from 'react';

// What the Lounge is narrowed to, and what it holds, shared between the
// Lounge page and Papol macOS's sidebar. In the Mac app's Lounge mode the
// sidebar carries the Lounge's friends and Show rows in place of the
// page's own rail, so both read and change the one choice here.
//
//   kind     '' for everything, or 'thread', 'paper', 'board', 'project'
//   who      '' for all friends, or one friend's uuid
//   finding  whether Find (someone to ask) is open
//   rows     the Lounge's rows, once read, for the sidebar's counts
const NONE = { kind: '', who: '', finding: false, rows: null };
let state = NONE;
const listeners = new Set();

export function loungeState() {
  return state;
}

export function setLounge(patch) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener(state));
}

// At sign-out, or when another member signs in.
export function forgetLounge() {
  setLounge(NONE);
}

export function useLounge() {
  const [now, setNow] = useState(state);
  useEffect(() => {
    listeners.add(setNow);
    setNow(state);
    return () => { listeners.delete(setNow); };
  }, []);
  return now;
}

// What a row holds, as lines: who did what, and when.
export const linesOf = (row) => row.lines ?? [{ user: row.user, did: 'made', at: row.at }];

// The Lounge narrowed, as the nook is by a shelf: by whose news it is and
// what a row is.
export function narrowed(rows, pick) {
  return rows.filter((row) => (!pick.kind || row.kind === pick.kind)
    && (!pick.who || linesOf(row).some((line) => line.user.uuid === pick.who)));
}

export const KINDS = [['', 'Everything'], ['thread', 'Threads'], ['paper', 'Papers'], ['board', 'Boards'], ['project', 'Projects']];

// The Lounge's rows after a thread was replied in or removed: its row as
// it now stands, with the faces of everyone who spoke, or gone.
export function withThread(rows, uuid, next) {
  return rows.flatMap((row) => {
    if (row.kind !== 'thread' || row.thread.uuid !== uuid) return [row];
    if (!next) return [];
    const lines = [{ user: next.user, did: 'started', at: next.created_at }];
    for (const reply of next.replies) {
      const line = lines.find((l) => l.user.uuid === reply.user.uuid);
      if (!line) lines.push({ user: reply.user, did: 'replied', at: reply.created_at });
      else if (line.did === 'replied') line.at = reply.created_at;
    }
    return [{ ...row, thread: next, lines }];
  });
}
