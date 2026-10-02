import { describe, expect, it, vi } from 'vitest';

// jsdom has no IndexedDB; the module only checks it exists (idb-keyval is mocked).
vi.hoisted(() => {
  (globalThis as { indexedDB?: unknown }).indexedDB = {};
});

const store = vi.hoisted(() => ({
  set: vi.fn(() => Promise.resolve()),
  del: vi.fn(() => Promise.resolve()),
  get: vi.fn(() => Promise.resolve(undefined)),
}));
vi.mock('idb-keyval', () => ({
  createStore: () => ({}),
  set: store.set,
  del: store.del,
  get: store.get,
}));

import { clearOfflineData, createOfflinePersister } from '@/lib/offline/persist';

describe('the offline copy', () => {
  it('is written while signed in', async () => {
    const persister = createOfflinePersister();
    await persister.persistClient({
      timestamp: Date.now(),
      buster: 'v1',
      clientState: { queries: [], mutations: [] },
    });
    await new Promise((r) => setTimeout(r, 2100)); // past the throttle
    expect(store.set).toHaveBeenCalled();
  });

  it('is wiped on sign-out and nothing fetched afterwards writes it back', async () => {
    const persister = createOfflinePersister();
    store.set.mockClear();
    await clearOfflineData();
    expect(store.del).toHaveBeenCalledWith('react-query', expect.anything());
    // A screen still on display re-fetches while NextAuth signs out.
    await persister.persistClient({
      timestamp: Date.now(),
      buster: 'v1',
      clientState: { queries: [], mutations: [] },
    });
    await new Promise((r) => setTimeout(r, 2100));
    expect(store.set).not.toHaveBeenCalled();
  });
});
