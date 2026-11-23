// Copie locale (IndexedDB) : bouteilles, réglages et cache des photos.
// Sert de stockage principal en mode local, et de cache hors ligne en mode GitHub.
const DB_NAME = 'ma-cave';
const VERSION = 2;
let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('bottles')) db.createObjectStore('bottles', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos');
      };
      req.onsuccess = () => {
        const db = req.result;
        // Si une nouvelle version de l'app s'ouvre dans un autre onglet, on libère la base et on recharge.
        db.onversionchange = () => { db.close(); location.reload(); };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => {
        const el = document.querySelector('#loading div:last-child');
        if (el) el.textContent = 'Mise à jour en attente : fermez ou rechargez les autres onglets « Ma Cave ».';
      };
    });
  }
  return dbPromise;
}

function run(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req && 'result' in req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

export const db = {
  allBottles: () => run('bottles', 'readonly', s => s.getAll()),
  putBottle: b => run('bottles', 'readwrite', s => s.put(b)),
  deleteBottle: id => run('bottles', 'readwrite', s => s.delete(id)),
  clearBottles: () => run('bottles', 'readwrite', s => s.clear()),
  replaceBottles: list => run('bottles', 'readwrite', s => { s.clear(); for (const b of list) s.put(b); return null; }),
  getSetting: k => run('settings', 'readonly', s => s.get(k)),
  setSetting: (k, v) => run('settings', 'readwrite', s => s.put(v, k)),
  getPhoto: path => run('photos', 'readonly', s => s.get(path)),
  putPhoto: (path, blob) => run('photos', 'readwrite', s => s.put(blob, path)),
};

// Demande au navigateur de ne jamais purger les données de la cave.
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch { /* ignoré */ }
  return false;
}
