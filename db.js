'use strict';

// Ručno uneseni proizvodi spremaju se samo na ovom uređaju (IndexedDB), zajedno s fotografijom.
const LocalDb = (() => {
  const DB_NAME = 'scaner';
  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 3);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('products')) db.createObjectStore('products', { keyPath: 'code' });
          // Verzija 2 imala je spremište za rokove trajanja; funkcija je uklonjena, pa brišemo i spremljene rokove.
          if (db.objectStoreNames.contains('expiry')) db.deleteObjectStore('expiry');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }).catch((err) => { dbPromise = null; throw err; });
    }
    return dbPromise;
  }

  async function run(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  return {
    get: (code) => run('products', 'readonly', (s) => s.get(code)),
    put: (product) => run('products', 'readwrite', (s) => s.put(product)),
    remove: (code) => run('products', 'readwrite', (s) => s.delete(code)),
    all: () => run('products', 'readonly', (s) => s.getAll()),
  };
})();
