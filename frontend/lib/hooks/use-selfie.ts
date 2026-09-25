'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';

import { api, getAccessToken, setAccessToken, ApiError, NetworkError } from '@/lib/api';
import type { SelfieAnalysis, SelfieItemPayload } from '@/lib/selfie';
import type { Item } from '@/lib/types';

/** Biggest photo we send; the backend refuses more and phones shoot big files. */
export const MAX_SELFIE_BYTES = 15 * 1024 * 1024;

function useSetTokenIfAvailable() {
  const { data: session } = useSession();
  if (session?.accessToken) {
    setAccessToken(session.accessToken as string);
  }
}

function messageOf(data: { detail?: unknown }, fallback: string): string {
  const detail = data?.detail;
  if (typeof detail === 'string') return detail;
  if (detail && typeof detail === 'object' && 'message' in detail) {
    const message = (detail as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return fallback;
}

/**
 * Send the photo for analysis. Multipart, so it goes through raw fetch rather
 * than `lib/api.ts` (which forces a JSON content type). The file is uploaded,
 * analysed and dropped: nothing is stored server-side, and we never keep the
 * File beyond the call here either.
 */
export function useAnalyzeSelfie() {
  const { data: session } = useSession();

  return useMutation({
    // The page renders its own inline message (AI notices included).
    meta: { silentErrors: true },
    mutationFn: async (file: File): Promise<SelfieAnalysis> => {
      const token = session?.accessToken || getAccessToken();
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const formData = new FormData();
      formData.append('image', file);

      let response: Response;
      try {
        response = await fetch('/api/v1/selfie/analyze', {
          method: 'POST',
          body: formData,
          credentials: 'include',
          headers,
        });
      } catch {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          throw new NetworkError('offline');
        }
        throw new NetworkError('unreachable');
      }

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new ApiError(messageOf(data, 'Failed to analyse the photo'), response.status, data);
      }
      return response.json();
    },
  });
}

/** Add one detected garment to the wardrobe (placeholder photo, no crop). */
export function useCreateItemFromSelfie() {
  const queryClient = useQueryClient();
  useSetTokenIfAvailable();

  return useMutation({
    mutationFn: (payload: SelfieItemPayload) => api.post<Item>('/selfie/items', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
    },
  });
}
