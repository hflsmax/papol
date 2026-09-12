// One value that components can follow (with useSyncExternalStore) without
// their parent re-rendering them: set it, and only the subscribers that ask
// for it again hear of the change.
export function createValueStore(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return;
      value = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
