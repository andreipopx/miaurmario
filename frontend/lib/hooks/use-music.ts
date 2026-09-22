'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { api, setAccessToken } from '@/lib/api';
import type {
  MusicOverview,
  MusicRange,
  MusicSearchResponse,
  MusicSettings,
  MusicSource,
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
  errors?: Partial<Record<MusicSource, string>>;
  last_synced_at: string | null;
}

/**
 * Pull the latest plays (Spotify and/or Last.fm) once when the Música tab opens (the backend
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
      if (data.errors?.lastfm) qc.invalidateQueries({ queryKey: ['lastfm', 'status'] });
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
      api.get<{ connected: boolean; source: MusicSource | null; track: NowPlaying | null }>(
        '/music/now-playing',
      ),
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

export function useMusicSettings(enabled = true) {
  useSetTokenIfAvailable();
  return useQuery({
    queryKey: ['music', 'settings'],
    queryFn: () => api.get<MusicSettings>('/music/settings'),
    enabled,
    staleTime: 60_000,
  });
}

/** "Deja que Stinky contraste tu música" (off by default). */
export function useUpdateMusicContrast() {
  const qc = useQueryClient();
  useSetTokenIfAvailable();
  return useMutation({
    mutationFn: (contrast: boolean) => api.patch<MusicSettings>('/music/settings', { contrast }),
    onSuccess: (data) => qc.setQueryData(['music', 'settings'], data),
  });
}

/** Delete every stored play and daily mood (connections stay). */
export function useDeleteMusicHistory() {
  const qc = useQueryClient();
  useSetTokenIfAvailable();
  return useMutation({
    mutationFn: () =>
      api.delete<{ deleted: { events: number; moods: number } }>('/music/history'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['music'] });
    },
  });
}
