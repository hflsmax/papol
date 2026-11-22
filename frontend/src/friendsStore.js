import { useEffect, useState } from 'react';
import {
  acceptFriend, askFriend, declineFriend, endFriend, getFriends, relationTo,
} from '../../shared/api/friends.js';

// What the member's pages know of their friends, read once and shared: a
// button on a nook, a row in the Lounge and the list on their own
// page all say the same thing, and a press on one is seen by the others.
let known = null;
let asking = null;
const listeners = new Set();

function tell(next) {
  known = next;
  listeners.forEach((listener) => listener(next));
}

export function loadFriends() {
  asking = asking ?? getFriends().then((next) => { tell(next); return next; }).finally(() => { asking = null; });
  return asking;
}

// At sign-out, or when another member signs in.
export function forgetFriends() {
  tell(null);
}

// Each act answers with the whole of it again.
const acting = (call) => async (...given) => { const next = await call(...given); tell(next); return next; };
export const friendActs = {
  ask: acting(askFriend),
  accept: acting(acceptFriend),
  decline: acting(declineFriend),
  end: acting(endFriend),
  set: tell,
};

// The member's friends, null until read. `on` false asks for nothing: a
// visitor has none.
export function useFriends(on = true) {
  const [friends, setFriends] = useState(known);
  useEffect(() => {
    if (!on) return undefined;
    listeners.add(setFriends);
    setFriends(known);
    if (!known) loadFriends().catch(() => {});
    return () => { listeners.delete(setFriends); };
  }, [on]);
  return friends;
}

export { relationTo };
