'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { api, setAccessToken } from '@/lib/api';

function useSetTokenIfAvailable() {
  const { data: session } = useSession();
  if (session?.accessToken) {
    setAccessToken(session.accessToken as string);
  }
}

export interface SpotifyStatus {
  configured: boolean;
  lastfm_configured: boolean;
  connected: boolean;
  spotify_user_id: string | null;
  display_name: string | null;
  connected_at: string | null;
  scopes: string | null;
  use_for_mood: boolean;
}

export type SpotifyListening = 'now_playing' | 'recently_played' | 'top_artists';

export interface SpotifyMood {
  source: 'spotify' | 'manual';
  fallback: 'lastfm' | 'musicbrainz';
  reason: 'not_connected' | 'disabled' | 'no_data' | null;
  context: {
    listening: SpotifyListening | null;
    artist: string | null;
    track: string | null;
    label: string;
    genres: string[];
    tags: string[];
    top_artists: string[];
  } | null;
}

export function useSpotifyStatus(enabled = true) {
  useSetTokenIfAvailable();
  return useQuery({
    queryKey: ['spotify', 'status'],
    queryFn: () => api.get<SpotifyStatus>('/integrations/spotify/status'),
    enabled,
  });
}

export function useSpotifyMood(enabled = true) {
  useSetTokenIfAvailable();
  return useQuery({
    queryKey: ['spotify', 'mood'],
    queryFn: () => api.get<SpotifyMood>('/integrations/spotify/mood'),
    enabled,
    retry: false,
    staleTime: 60_000,
  });
}

export function useSpotifyMoodRefresh() {
  const qc = useQueryClient();
  useSetTokenIfAvailable();
  return useMutation({
    mutationFn: () =>
      api.get<SpotifyMood>('/integrations/spotify/mood', { params: { refresh: 'true' } }),
    onSuccess: (data) => qc.setQueryData(['spotify', 'mood'], data),
  });
}

export function useSpotifyConnect() {
  useSetTokenIfAvailable();
  return useMutation({
    mutationFn: async () => {
      const { authorize_url } = await api.get<{ authorize_url: string }>(
        '/integrations/spotify/connect',
      );
      window.location.href = authorize_url;
    },
  });
}

export function useSpotifyUpdateSettings() {
  const qc = useQueryClient();
  useSetTokenIfAvailable();
  return useMutation({
    mutationFn: (useForMood: boolean) =>
      api.patch<SpotifyStatus>('/integrations/spotify/settings', { use_for_mood: useForMood }),
    onSuccess: (data) => {
      qc.setQueryData(['spotify', 'status'], data);
      qc.invalidateQueries({ queryKey: ['spotify', 'mood'] });
    },
  });
}

export function useSpotifyDisconnect() {
  const qc = useQueryClient();
  useSetTokenIfAvailable();
  return useMutation({
    mutationFn: ({ keepHistory = true }: { keepHistory?: boolean } = {}) =>
      api.delete('/integrations/spotify', { params: { keep_history: String(keepHistory) } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['spotify'] });
      qc.invalidateQueries({ queryKey: ['music'] });
    },
  });
}
