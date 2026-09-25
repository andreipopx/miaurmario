'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';

import { api, setAccessToken } from '@/lib/api';
import type { Item } from '@/lib/types';

/**
 * How full the wardrobe is, as the suggestion engine counts it.
 *
 * `usable` is the number that matters and the one a nudge must quote: an item
 * whose type is still "unknown" is invisible to the stylist, so a wardrobe of raw
 * photos is a wardrobe of nothing. The thresholds come from the server so the copy
 * can never drift from the engine.
 */
export interface WardrobeStats {
  total: number;
  usable: number;
  untyped: number;
  processing: number;
  min_for_looks: number;
  variety_target: number;
  max_batch: number;
}

export const WARDROBE_STATS_KEY = ['wardrobe-stats'] as const;

export function useWardrobeStats() {
  const { data: session, status } = useSession();
  if (session?.accessToken) setAccessToken(session.accessToken as string);

  return useQuery({
    queryKey: WARDROBE_STATS_KEY,
    queryFn: () => api.get<WardrobeStats>('/items/stats'),
    enabled: status !== 'loading',
    staleTime: 30_000,
  });
}

/**
 * Exactly the garments a batch created, read back from the server.
 *
 * The review grid must show what the tagging worker actually wrote, not what the
 * upload response happened to contain, and it must not drag in the rest of the
 * wardrobe — hence an explicit id list rather than the paged item list.
 */
export function useBatchItems(itemIds: readonly string[]) {
  const { data: session } = useSession();
  if (session?.accessToken) setAccessToken(session.accessToken as string);
  const ids = itemIds.join(',');

  return useQuery({
    queryKey: ['items', 'batch', ids],
    queryFn: () =>
      api.get<{ items: Item[] }>('/items', { params: { ids, page_size: '100' } }),
    enabled: ids.length > 0,
    refetchInterval: (query) => {
      const items = (query.state.data as { items: Item[] } | undefined)?.items;
      return items?.some((item) => item.status === 'processing') ? 3000 : false;
    },
  });
}

/**
 * Garments the tagger never got to, whoever the user is.
 *
 * Without AI every upload lands here; with AI it is whatever the worker failed on.
 * Either way these are the items the stylist cannot use, so the quick pass can be
 * pointed at them directly and not only at the batch just uploaded.
 */
export function useUntaggedItems(enabled: boolean) {
  const { data: session } = useSession();
  if (session?.accessToken) setAccessToken(session.accessToken as string);

  return useQuery({
    queryKey: ['items', 'untagged'],
    queryFn: () =>
      api.get<{ items: Item[] }>('/items', {
        params: { tagging_status: 'pending', page_size: '100', sort_by: 'created_at' },
      }),
    enabled,
  });
}

export interface BatchTagEntry {
  item_id: string;
  type?: string | null;
  primary_color?: string | null;
  /**
   * The shade sampled off the garment, `#rrggbb`. Explicit `null` clears it — the
   * user picked a family off the swatches, so the old shade no longer describes
   * the garment. Omitted leaves whatever is stored alone.
   */
  primary_color_hex?: string | null;
  style?: string[] | null;
  formality?: string | null;
  season?: string[] | null;
}

export interface BatchTagResponse {
  updated: number;
  failed: number;
  errors: string[];
}

/** The quick review pass: type, colour, style and formality for a handful of garments in one call. */
export function useBatchTagItems() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  if (session?.accessToken) setAccessToken(session.accessToken as string);

  return useMutation({
    mutationFn: (items: BatchTagEntry[]) =>
      api.post<BatchTagResponse>('/items/bulk/tag', { items }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: WARDROBE_STATS_KEY });
    },
  });
}
