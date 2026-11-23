// What a device keeps until Papol has it: one record per thing, each under
// its own storage key, so two windows never write over each other, and any
// window can send what another left behind — closed before it could, or
// offline at the time. Used for reading time (activity.js) and for the
// small things a user's devices share (userState.js).
//
// A record carries the account it belongs to (accountMark), so what was
// kept before signing out is never sent as someone else's.

// One outbox in `storage`, its records under `prefix`.
export function deviceOutbox(storage, prefix) {
  const entries = () => {
    const found = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key?.startsWith(prefix)) continue;
      const text = storage.getItem(key);
      try { found.push({ key, text, record: JSON.parse(text) }); }
      catch { found.push({ key, text, record: null }); }
    }
    return found;
  };
  // Only if no window has changed it since it was read.
  const drop = (entry) => {
    if (storage.getItem(entry.key) === entry.text) storage.removeItem(entry.key);
  };

  return {
    save(id, record) {
      try { storage.setItem(prefix + id, JSON.stringify(record)); return true; }
      catch { return false; /* storage full or refused: kept for this window only */ }
    },

    // The record kept under `id`, if it is this account's.
    pending(id, account) {
      try {
        const record = JSON.parse(storage.getItem(prefix + id));
        return record?.account === account ? record : null;
      } catch { return null; }
    },

    // Send up to `limit` of this account's records, as `wire(record)`, with
    // `send`. Records that cannot be true or are too old for Papol to take
    // (`expired`) are forgotten unsent. Once sent, a record is forgotten if
    // it is `finished` and no window has changed it meanwhile. Offline, or
    // Papol unwell: all are kept for next time. Refused outright: keeping
    // them would only be refused again.
    async flush(account, send, { limit, wire, expired = () => false, finished = () => true }) {
      const mine = [];
      for (const entry of entries()) {
        if (!entry.record || expired(entry.record)) drop(entry);
        else if (entry.record.account === account) mine.push(entry);
      }
      const batch = mine.slice(0, limit);
      if (!batch.length) return 0;
      try {
        await send(batch.map((entry) => wire(entry.record)));
      } catch (failure) {
        if (failure?.status !== 400 && failure?.status !== 422) return 0;
      }
      for (const entry of batch) if (finished(entry.record)) drop(entry);
      return batch.length;
    },
  };
}
