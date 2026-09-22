'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { api, ApiError, setAccessToken } from '@/lib/api';

function useSetTokenIfAvailable() {
  const { data: session } = useSession();
  if (session?.accessToken) {
    setAccessToken(session.accessToken as string);
  }
}

export type LastfmSyncError = 'private' | 'not_found' | 'rate_limited' | 'bad_key' | 'unavailable';

export interface LastfmStatus {
  configured: boolean;
  /** Optional "Iniciar sesión con Last.fm" (server has LASTFM_API_SECRET). */
  auth_available: boolean;
  connected: boolean;
  username: string | null;
  profile_url: string | null;
  authenticated: boolean;
  connected_at: string | null;
  last_sync_at: string | null;
  last_error: LastfmSyncError | string | null;
  use_for_mood: boolean;
}

export type LastfmConnectError =
  | 'lastfm_user_not_found'
  | 'lastfm_private'
  | 'lastfm_rate_limited'
  | 'lastfm_unavailable'
  | 'lastfm_not_configured';

/** Machine code of a failed connect (`detail.code`), or null. */
export function lastfmErrorCode(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const detail = (error.data as { detail?: unknown } | null)?.detail;
  if (detail && typeof detail === 'object' && 'code' in detail) {
    const code = (detail as { code?: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

/** Last.fm usernames: 2–64 chars, letter/digit first, then letters, digits, _ . - */
export const LASTFM_USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{1,63}$/;

export function normaliseLastfmUsername(raw: string): string {
  let value = raw.trim();
  // Accept a pasted profile URL: https://www.last.fm/user/<name>
  const match = value.match(/last\.fm\/(?:[a-z]{2}\/)?user\/([^/?#\s]+)/i);
  if (match) value = decodeURIComponent(match[1]);
  return value.replace(/^@/, '');
}

export function useLastfmStatus(enabled = true) {
  useSetTokenIfAvailable();
  return useQuery({
    queryKey: ['lastfm', 'status'],
    queryFn: () => api.get<LastfmStatus>('/integrations/lastfm/status'),
    enabled,
  });
}

function useInvalidateMusic() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['music'] });
    qc.invalidateQueries({ queryKey: ['spotify', 'mood'] });
  };
}

export function useLastfmConnect() {
  const qc = useQueryClient();
  const invalidateMusic = useInvalidateMusic();
  useSetTokenIfAvailable();
  return useMutation({
    mutationFn: (username: string) =>
      api.post<LastfmStatus>('/integrations/lastfm/connect', { username }),
    onSuccess: (data) => {
      qc.setQueryData(['lastfm', 'status'], data);
      invalidateMusic();
    },
  });
}

export function useLastfmWebAuth() {
  useSetTokenIfAvailable();
  return useMutation({
    mutationFn: async () => {
      const { authorize_url } = await api.get<{ authorize_url: string }>(
        '/integrations/lastfm/auth-url',
      );
      window.location.href = authorize_url;
    },
  });
}

export function useLastfmUpdateSettings() {
  const qc = useQueryClient();
  const invalidateMusic = useInvalidateMusic();
  useSetTokenIfAvailable();
  return useMutation({
    mutationFn: (useForMood: boolean) =>
      api.patch<LastfmStatus>('/integrations/lastfm/settings', { use_for_mood: useForMood }),
    onSuccess: (data) => {
      qc.setQueryData(['lastfm', 'status'], data);
      invalidateMusic();
    },
  });
}

export function useLastfmDisconnect() {
  const qc = useQueryClient();
  const invalidateMusic = useInvalidateMusic();
  useSetTokenIfAvailable();
  return useMutation({
    mutationFn: ({ keepHistory }: { keepHistory: boolean }) =>
      api.delete('/integrations/lastfm', { params: { keep_history: String(keepHistory) } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lastfm'] });
      invalidateMusic();
    },
  });
}
