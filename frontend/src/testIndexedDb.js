// A deliberately small IndexedDB implementation for transport tests. It
// implements the one-request transactions used by shared/offlineStore.js and
// keeps the production dependency tree free of a browser emulator.

function requestResult(transaction, action) {
  const request = {};
  queueMicrotask(() => {
    try {
      request.result = action();
      request.onsuccess?.({ target: request });
      transaction.oncomplete?.({ target: transaction });
    } catch (error) {
      request.error = error;
      transaction.error = error;
      request.onerror?.({ target: request });
      transaction.onerror?.({ target: transaction });
    }
  });
  return request;
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

export function createTestIndexedDb() {
  const databases = new Map();

  return {
    open(name) {
      const request = {};
      queueMicrotask(() => {
        let database = databases.get(name);
        const fresh = !database;
        if (!database) {
          const stores = new Map();
          database = {
            objectStoreNames: { contains: (storeName) => stores.has(storeName) },
            createObjectStore(storeName, options = {}) {
              stores.set(storeName, { options, records: new Map(), nextKey: 1 });
            },
            transaction(storeName) {
              const transaction = {
                objectStore() {
                  const store = stores.get(storeName);
                  if (!store) throw new Error(`Unknown object store: ${storeName}`);
                  const keyFor = (value, suppliedKey) => {
                    if (suppliedKey !== undefined) return suppliedKey;
                    if (store.options.keyPath && value?.[store.options.keyPath] !== undefined) {
                      return value[store.options.keyPath];
                    }
                    if (store.options.autoIncrement) return store.nextKey++;
                    throw new Error(`A key is required for ${storeName}`);
                  };
                  return {
                    get: (key) => requestResult(transaction, () => clone(store.records.get(key))),
                    getAll: () => requestResult(transaction, () =>
                      [...store.records.values()].map(clone)),
                    put: (value, suppliedKey) => requestResult(transaction, () => {
                      const key = keyFor(value, suppliedKey);
                      const saved = clone(value);
                      if (store.options.keyPath && saved[store.options.keyPath] === undefined) {
                        saved[store.options.keyPath] = key;
                      }
                      store.records.set(key, saved);
                      return key;
                    }),
                    add: (value) => requestResult(transaction, () => {
                      const key = keyFor(value);
                      if (store.records.has(key)) throw new Error(`Duplicate key: ${key}`);
                      const saved = clone(value);
                      if (store.options.keyPath && saved[store.options.keyPath] === undefined) {
                        saved[store.options.keyPath] = key;
                      }
                      store.records.set(key, saved);
                      return key;
                    }),
                    delete: (key) => requestResult(transaction, () => store.records.delete(key)),
                  };
                },
              };
              return transaction;
            },
            close() {},
          };
          databases.set(name, database);
        }
        request.result = database;
        if (fresh) request.onupgradeneeded?.({ target: request });
        request.onsuccess?.({ target: request });
      });
      return request;
    },
    deleteDatabase(name) {
      databases.delete(name);
    },
  };
}
