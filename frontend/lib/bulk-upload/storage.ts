/**
 * Where a batch of photos waits while it uploads.
 *
 * React state is not enough: a batch of thirty photos takes a minute or two, and
 * if the user backgrounds the PWA or reloads, a `File` handle is dead — only the
 * bytes survive. So every queued photo is written to IndexedDB before the upload
 * starts and deleted once its garment exists, which is what makes the queue
 * resumable rather than merely retryable.
 *
 * Every call swallows its errors. In a private window, or with site data blocked,
 * IndexedDB throws or silently comes back empty; the upload must still work, just
 * without surviving a reload.
 */

const DB_NAME = 'miaurmario-uploads';
const DB_VERSION = 1;
const STORE = 'queue';

/** A batch older than this is abandoned, not resumed. */
export const BATCH_TTL_MS = 24 * 60 * 60 * 1000;

export interface StoredPhoto {
  /** Stable id of the queue row, not of the garment. */
  id: string;
  batchId: string;
  name: string;
  /** The bytes, so a reload can carry on where the queue stopped. */
  blob: Blob;
  addedAt: number;
  /** Whether the user asked for AI tagging to be skipped for this batch. */
  skipAi: boolean;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('batchId', 'batchId');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    return await new Promise<T | null>((resolve) => {
      let request: IDBRequest<T>;
      try {
        request = run(db.transaction(STORE, mode).objectStore(STORE));
      } catch {
        resolve(null);
        return;
      }
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
  } finally {
    db.close();
  }
}

export async function savePhoto(photo: StoredPhoto): Promise<void> {
  await withStore('readwrite', (store) => store.put(photo) as IDBRequest<IDBValidKey>);
}

export async function deletePhoto(id: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(id) as unknown as IDBRequest<undefined>);
}

/** Every photo still waiting, newest batch last, with stale batches dropped. */
export async function loadPendingPhotos(now = Date.now()): Promise<StoredPhoto[]> {
  const all = await withStore<StoredPhoto[]>('readonly', (store) => store.getAll());
  if (!all) return [];
  const fresh: StoredPhoto[] = [];
  for (const photo of all) {
    if (now - photo.addedAt > BATCH_TTL_MS) {
      void deletePhoto(photo.id);
    } else {
      fresh.push(photo);
    }
  }
  return fresh.sort((a, b) => a.addedAt - b.addedAt);
}

export async function clearPhotos(ids: readonly string[]): Promise<void> {
  await Promise.all(ids.map((id) => deletePhoto(id)));
}
