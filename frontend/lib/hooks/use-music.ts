'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { api, setAccessToken } from '@/lib/api';
import type {
  MusicOverview,
  MusicRange,
  MusicSearchResponse,
  NowPlaying,
} from '@/lib/music';

function useSetTokenIfAvailable() {
  const { data: session } = useSession();
  if (session?.accessToken) {
    setAccessToken(session.accessToken as string);
  }
}

export function useMusicOverview(range: MusicRange) {
  useSetTokenIfAvailable();
  return useQuery({
    queryKey: ['music', 'overview', range],
    queryFn: () => api.get<MusicOverview>('/music/overview', { params: { range } }),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

interface SyncResponse {
  connected: boolean;
  skipped: boolean;
  inserted: number;
  error?: string;
  last_synced_at: string | null;
}

/**
 * Pull the latest Spotify plays once when the Música tab opens (the backend
 * throttles real syncs to one every couple of minutes).
 */
export function useMusicSyncOnMount(enabled = true) {
  const qc = useQueryClient();
  useSetTokenIfAvailable();
  const started = useRef(false);
  const mutation = useMutation({
    mutationFn: () => api.post<SyncResponse>('/music/sync'),
    onSuccess: (data) => {
      if (data.inserted > 0) qc.invalidateQueries({ queryKey: ['music', 'overview'] });
    },
  });
  const { mutate } = mutation;
  useEffect(() => {
    if (!enabled || started.current) return;
    started.current = true;
    mutate();
  }, [enabled, mutate]);
  return mutation;
}

export function useNowPlaying(enabled = true) {
  useSetTokenIfAvailable();
  return useQuery({
    queryKey: ['music', 'now-playing'],
    queryFn: () =>
      api.get<{ connected: boolean; track: NowPlaying | null }>('/music/now-playing'),
    enabled,
    staleTime: 20_000,
    retry: false,
  });
}

/** Debounce a value (autocomplete). */
export function useDebounced<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

export function useMusicSearch(query: string, enabled = true) {
  useSetTokenIfAvailable();
  const q = useDebounced(query.trim(), 250);
  return useQuery({
    queryKey: ['music', 'search', q.toLowerCase()],
    queryFn: () => api.get<MusicSearchResponse>('/music/search', { params: { q } }),
    enabled: enabled && q.length >= 2,
    staleTime: 5 * 60_000,
    retry: false,
  });
}
