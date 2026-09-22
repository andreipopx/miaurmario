'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/hooks/use-auth';
import type { UserProfile } from '@/lib/hooks/use-user';
import { mergeSeen, unsyncedKeys } from '@/lib/onboarding/first-run';

const STORAGE_PREFIX = 'mm-seen-tips-v1:';
/** User whose unsynced keys were already re-sent in this page load (shared by every hook instance). */
let resyncedFor: string | null = null;

export function readLocalSeen(userId: string | undefined): string[] {
  if (!userId || typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + userId);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

function writeLocalSeen(userId: string, keys: string[]) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + userId, JSON.stringify(keys));
  } catch {
    /* private mode / quota: the server copy still applies */
  }
}

/**
 * Seen-state of the first-run guidance. Marking is optimistic (the cached user
 * and localStorage update at once) and the PATCH is fire-and-forget: if it
 * fails the UI is never blocked, this device remembers, and the keys are
 * re-sent on the next load.
 */
export function useSeenTips() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id;
  const [local, setLocal] = useState<string[]>(() => readLocalSeen(userId));

  useEffect(() => {
    setLocal(readLocalSeen(userId));
  }, [userId]);

  const send = useCallback(
    (body: { add?: string[]; remove?: string[] }) =>
      api
        .patch<{ seen_tips: string[] }>('/users/me/seen-tips', body)
        .then((res) => {
          queryClient.setQueryData<UserProfile>(['auth-user'], (u) => (u ? { ...u, seen_tips: res.seen_tips } : u));
        })
        .catch(() => {
          /* offline / old backend: localStorage keeps it on this device */
        }),
    [queryClient]
  );

  // Retry keys a previous PATCH failed to store (once per user and load).
  useEffect(() => {
    if (!userId || !Array.isArray(user?.seen_tips) || resyncedFor === userId) return;
    resyncedFor = userId;
    const pending = unsyncedKeys(user.seen_tips, readLocalSeen(userId));
    if (pending.length) void send({ add: pending.slice(0, 20) });
  }, [userId, user?.seen_tips, send]);

  const markSeen = useCallback(
    (keys: string[]) => {
      if (!userId || keys.length === 0) return;
      const next = mergeSeen(readLocalSeen(userId), keys);
      writeLocalSeen(userId, next);
      setLocal(next);
      queryClient.setQueryData<UserProfile>(['auth-user'], (u) =>
        u ? { ...u, seen_tips: mergeSeen(u.seen_tips ?? [], keys) } : u
      );
      void send({ add: keys });
    },
    [userId, queryClient, send]
  );

  return { user, local, seen: mergeSeen(user?.seen_tips ?? [], local), markSeen };
}

// ---- "Cómo funciona": open the tour from anywhere (profile menu) --------------

let tourRequested = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Re-open the welcome tour (profile menu → "Cómo funciona"). */
export function openFeatureTour() {
  tourRequested += 1;
  listeners.forEach((l) => l());
}

/** Increments every time someone asks to open the tour. */
export function useTourRequests(): number {
  return useSyncExternalStore(
    subscribe,
    () => tourRequested,
    () => 0
  );
}
