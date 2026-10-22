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

/** A photo the backend fetched and re-encoded itself, inlined for the review screen. */
export interface InlineImage {
  data_url: string;
  content_type: string;
  size_bytes: number;
}

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
  image?: InlineImage | null;
  /** Every photo the shop has, the garment alone first (image is images[0]). */
  images?: InlineImage[];
  /** The garment type the shop's category gives away. */
  type?: string | null;
  primary_color_hex?: string | null;
}

/** One garment read off a screenshot, with photos to choose from. */
export interface ScreenshotGarment {
  type: string;
  subtype?: string | null;
  primary_color?: string | null;
  primary_color_hex?: string | null;
  colors: string[];
  pattern?: string | null;
  material?: string | null;
  name?: string | null;
  brand?: string | null;
  price?: string | number | null;
  currency?: string | null;
  source_url?: string | null;
  /** True when the photos came from the shop's catalogue, not the screenshot. */
  from_shop: boolean;
  images: InlineImage[];
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

/** POST one image as multipart to an /items endpoint and read the JSON answer. */
async function postImage<T>(path: string, file: File, token: string | undefined | null, fallback: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const formData = new FormData();
  formData.append('image', file);

  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
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
    throw new ApiError(data?.detail?.message || data?.detail || fallback, response.status, data);
  }

  return (await response.json()) as T;
}

/** Send a photo of a washing label and get structured care data back. */
export function useCareLabel() {
  const { data: session } = useSession();

  return useMutation({
    mutationFn: (file: File) =>
      postImage<CareLabelRead>(
        '/items/care-label',
        file,
        (session?.accessToken as string | undefined) || getAccessToken(),
        'Failed to read the care label'
      ),
  });
}

/**
 * «Desde una captura»: the garments in a screenshot. The screenshot is read in
 * memory on the server and never stored; nothing is added until the user says so.
 */
export function useScreenshotRead() {
  const { data: session } = useSession();

  return useMutation({
    mutationFn: (file: File) =>
      postImage<{ garments: ScreenshotGarment[] }>(
        '/items/screenshot',
        file,
        (session?.accessToken as string | undefined) || getAccessToken(),
        'Failed to read the screenshot'
      ),
  });
}

/**
 * Turn an inlined photo (a data: URL the server sent) into a File the normal
 * upload path accepts. Decoded by hand: the app's CSP does not allow fetch() on
 * data: URLs, which is what silently broke saving a garment from a shop link.
 */
export async function dataUrlToFile(dataUrl: string, filename: string): Promise<File> {
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(dataUrl);
  if (!match) throw new Error('not a data URL');
  const type = match[1] || 'image/jpeg';
  const payload = match[3];
  let bytes: Uint8Array<ArrayBuffer>;
  if (match[2]) {
    const binary = atob(payload);
    bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  } else {
    bytes = new Uint8Array(new TextEncoder().encode(decodeURIComponent(payload)));
  }
  const extension = type === 'image/png' ? 'png' : 'jpg';
  return new File([bytes], `${filename}.${extension}`, { type });
}
