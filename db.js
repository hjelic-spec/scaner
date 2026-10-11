'use strict';

// Ručno uneseni proizvodi spremaju se samo na ovom uređaju (IndexedDB), zajedno s fotografijom.
const LocalDb = (() => {
  const DB_NAME = 'scaner';
  const STORE = 'products';
  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'code' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }).catch((err) => { dbPromise = null; throw err; });
    }
    return dbPromise;
  }

  async function run(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  return {
    get: (code) => run('readonly', (s) => s.get(code)),
    put: (product) => run('readwrite', (s) => s.put(product)),
    remove: (code) => run('readwrite', (s) => s.delete(code)),
    all: () => run('readonly', (s) => s.getAll()),
  };
})();
