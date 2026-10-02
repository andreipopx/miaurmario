'use client';

/**
 * The offline wardrobe: React Query's cache is copied to IndexedDB so the
 * wardrobe, looks and history open without a connection (the service worker
 * keeps the screens and the photos; see public/sw.js).
 *
 * Only reading is offline. Anything that needs the server (Stinky, suggestions,
 * weather, saving changes) waits for the connection to come back.
 */

import type { Query, QueryClient } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { createStore, del, get, set } from 'idb-keyval';

/** How long a saved copy stays usable, and so how long queries stay in memory. */
export const OFFLINE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Bump to discard every saved copy (e.g. when a response shape changes). */
export const OFFLINE_CACHE_VERSION = 'v1';

const STORE_KEY = 'react-query';
const IMAGE_CACHE = 'miaurmario-images'; // public/sw.js

/** What is worth having offline: the wardrobe, the looks, the history and who you are. */
export const OFFLINE_QUERY_ROOTS: ReadonlySet<string> = new Set([
  'auth-user',
  'user-profile',
  'preferences',
  'features',
  'items',
  'item',
  'item-types',
  'item-usage',
  'outfits',
  'outfit',
  'calendarOutfits',
  'pairings',
  // "Tu look de hoy"; the Hoy card ignores a saved copy from another day.
  'dayPlan',
  'wear-history',
  'wash-history',
  'wear-stats',
  'wardrobe-stats',
]);

export function shouldPersistQuery(query: Pick<Query, 'queryKey' | 'state'>): boolean {
  const root = query.queryKey[0];
  return (
    query.state.status === 'success' &&
    query.state.data !== undefined &&
    typeof root === 'string' &&
    OFFLINE_QUERY_ROOTS.has(root)
  );
}

let store: ReturnType<typeof createStore> | null = null;
function idb() {
  store ??= createStore('miaurmario', 'offline');
  return store;
}

const canUseIndexedDB = () => typeof window !== 'undefined' && typeof indexedDB !== 'undefined';

// Set on sign-out: screens still on display re-fetch while NextAuth signs out,
// and those answers must not be written back after the copy was wiped. Lasts
// until the next page load (signing out ends in one).
let suspended = false;

/** A persister backed by IndexedDB; a no-op on the server or without IndexedDB. */
export function createOfflinePersister() {
  return createAsyncStoragePersister({
    storage: canUseIndexedDB()
      ? {
          getItem: (key: string) => get<string>(key, idb()).then((v) => v ?? null),
          setItem: (key: string, value: string) =>
            suspended ? Promise.resolve() : set(key, value, idb()),
          removeItem: (key: string) => del(key, idb()),
        }
      : undefined,
    key: STORE_KEY,
    throttleTime: 2000,
  });
}

/**
 * Forget everything saved for offline use: on sign-out, so the next person on
 * this phone never sees the previous account's wardrobe.
 */
export async function clearOfflineData(queryClient?: QueryClient): Promise<void> {
  suspended = true;
  queryClient?.clear();
  const jobs: Promise<unknown>[] = [];
  if (canUseIndexedDB()) jobs.push(del(STORE_KEY, idb()));
  if (typeof caches !== 'undefined') jobs.push(caches.delete(IMAGE_CACHE));
  await Promise.allSettled(jobs);
}
