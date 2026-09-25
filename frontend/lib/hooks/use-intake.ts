'use client';

import { useMutation } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { api, getAccessToken, setAccessToken, ApiError, NetworkError } from '@/lib/api';
import { CareComposition, CareInfo } from '@/lib/types';

/**
 * Care data on its way to the backend. `composition` may be the raw text the
 * user typed ("60% algodón, 40% poliéster"): the backend parses it with the
 * same rules it applies to what the vision model reads, so there is only one
 * implementation of that parsing.
 */
export type CareDraft = Omit<CareInfo, 'composition' | 'source'> & {
  composition?: string | CareComposition[];
  source?: 'ai' | 'manual';
};

/** What the backend read off a pasted shop link. Nothing is saved yet. */
export interface LinkPreview {
  source_url: string;
  extracted: boolean;
  reason?: string | null;
  name?: string | null;
  brand?: string | null;
  price?: string | number | null;
  currency?: string | null;
  primary_color?: string | null;
  description?: string | null;
  site_name?: string | null;
  image?: {
    data_url: string;
    content_type: string;
    size_bytes: number;
  } | null;
}

export interface CareLabelRead {
  care: CareInfo;
  hints: string[];
  suggested_material?: string | null;
  read: boolean;
}

function useSetTokenIfAvailable() {
  const { data: session } = useSession();
  if (session?.accessToken) {
    setAccessToken(session.accessToken as string);
  }
}

/** Paste a shop link: the page is read server-side, never in the browser. */
export function useLinkPreview() {
  useSetTokenIfAvailable();

  return useMutation({
    mutationFn: (url: string) => api.post<LinkPreview>('/items/link-preview', { url }),
  });
}

/** Send a photo of a washing label and get structured care data back. */
export function useCareLabel() {
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async (file: File) => {
      const token = session?.accessToken || getAccessToken();
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const formData = new FormData();
      formData.append('image', file);

      let response: Response;
      try {
        response = await fetch('/api/v1/items/care-label', {
          method: 'POST',
          body: formData,
          credentials: 'include',
          headers,
        });
      } catch {
        throw new NetworkError('unreachable');
      }

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new ApiError(
          data?.detail?.message || data?.detail || 'Failed to read the care label',
          response.status,
          data
        );
      }

      return (await response.json()) as CareLabelRead;
    },
  });
}

/** Turn the inlined product photo into a File the normal upload path accepts. */
export async function dataUrlToFile(dataUrl: string, filename: string): Promise<File> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const extension = blob.type === 'image/png' ? 'png' : 'jpg';
  return new File([blob], `${filename}.${extension}`, { type: blob.type || 'image/jpeg' });
}
