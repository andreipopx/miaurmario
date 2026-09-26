'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { api, getAccessToken, setAccessToken, ApiError, NetworkError } from '@/lib/api';
import { CareInfo, ImageView, Item, ItemListResponse, ItemFilter, ItemUsage, WashHistoryEntry, ItemImage } from '@/lib/types';
import { CareDraft } from '@/lib/hooks/use-intake';

/** PATCH body: an item's fields, with care accepted as a draft too. */
export type ItemUpdatePayload = Partial<Omit<Item, 'care'>> & {
  care?: CareDraft | CareInfo | null;
};

// Helper to set token if available (for NextAuth mode)
function useSetTokenIfAvailable() {
  const { data: session } = useSession();
  if (session?.accessToken) {
    setAccessToken(session.accessToken as string);
  }
}

export function useItems(filters: ItemFilter = {}, page = 1, pageSize = 20) {
  const { data: session, status } = useSession();
  useSetTokenIfAvailable();

  return useQuery({
    queryKey: ['items', filters, page, pageSize],
    queryFn: async () => {
      const params: Record<string, string> = {
        page: String(page),
        page_size: String(pageSize),
      };
      if (filters.type) params.type = filters.type;
      if (filters.colors?.length) params.colors = filters.colors.join(',');
      if (filters.search) params.search = filters.search;
      if (filters.favorite !== undefined) params.favorite = String(filters.favorite);
      if (filters.needs_wash !== undefined) params.needs_wash = String(filters.needs_wash);
      if (filters.is_archived !== undefined) params.is_archived = String(filters.is_archived);
      if (filters.sort_by) params.sort_by = filters.sort_by;
      if (filters.sort_order) params.sort_order = filters.sort_order;
      if (filters.ids) params.ids = filters.ids;

      return api.get<ItemListResponse>('/items', { params });
    },
    enabled: status !== 'loading',
    // Poll more frequently when items are processing (every 5 seconds), otherwise every 30 seconds
    refetchInterval: (query) => {
      const data = query.state.data as ItemListResponse | undefined;
      const hasProcessing = data?.items?.some((item) => item.status === 'processing');
      return hasProcessing ? 5000 : 30000;
    },
  });
}

export function useItem(itemId: string) {
  const { status } = useSession();
  useSetTokenIfAvailable();

  return useQuery({
    queryKey: ['item', itemId],
    queryFn: () => api.get<Item>(`/items/${itemId}`),
    enabled: !!itemId && status !== 'loading',
  });
}

export function useCreateItem() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async (formData: FormData) => {
      const token = session?.accessToken || getAccessToken();
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      let response: Response;
      try {
        // Use the Next.js proxy path for client-side requests
        response = await fetch('/api/v1/items', {
          method: 'POST',
          body: formData,
          credentials: 'include',
          headers,
        });
      } catch {
        if (!navigator.onLine) {
          throw new NetworkError('offline');
        }
        throw new NetworkError('unreachable');
      }

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new ApiError(
          data.detail || 'Failed to create item',
          response.status,
          data
        );
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
    },
  });
}

export function useUpdateItem() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    // `care` may carry composition as the text the user typed; the backend
    // parses it the same way it parses what the vision model reads.
    mutationFn: async ({ id, data }: { id: string; data: ItemUpdatePayload }) => {
      if (session?.accessToken) {
        setAccessToken(session.accessToken as string);
      }
      return api.patch<Item>(`/items/${id}`, data);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['item', variables.id] });
      // The price and the per-garment setting both feed the usage panel.
      queryClient.invalidateQueries({ queryKey: ['item-usage', variables.id] });
    },
  });
}

export function useRemoveBackground() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async ({ id, bg_color }: { id: string; bg_color?: string }) => {
      if (session?.accessToken) {
        setAccessToken(session.accessToken as string);
      }
      return api.post<Item>(`/items/${id}/remove-background`, { bg_color: bg_color ?? '#FFFFFF' });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['item', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['outfits'] });
      queryClient.invalidateQueries({ queryKey: ['calendarOutfits'] });
    },
  });
}

/**
 * "Borra lo que sobra" on a garment already in the wardrobe.
 *
 * The mask goes to the server rather than the finished image: the stored alpha is
 * what every screen reads, and the server owns where the cut-out sits inside the
 * photo it was trimmed out of. `space` says which picture the strokes were painted
 * on — the visible cut-out, or the whole stored photo.
 *
 * `imageId` picks the photo. Omitted, the strokes land on the garment's own photo;
 * given, on that one extra photo and on nothing else — which is what makes touching
 * up a back shot safe, since a garment can have a cut-out back and a white-backed
 * front and each is fixed on its own.
 */
export function useBrushCutout() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async ({
      id,
      mask,
      space = 'cutout',
      imageId = null,
    }: {
      id: string;
      mask: Blob;
      space?: 'cutout' | 'original';
      imageId?: string | null;
    }) => {
      const token = session?.accessToken || getAccessToken();
      const formData = new FormData();
      formData.append('mask', mask, 'mask.png');
      formData.append('space', space);

      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const url = imageId
        ? `/api/v1/items/${id}/images/${imageId}/cutout-mask`
        : `/api/v1/items/${id}/cutout-mask`;
      const response = await fetch(url, {
        method: 'POST',
        body: formData,
        credentials: 'include',
        headers,
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new ApiError(data.detail || 'Failed to edit the cut-out', response.status, data);
      }

      return response.json() as Promise<Item | ItemImage>;
    },
    onSuccess: (_, variables) => invalidateGarmentImage(queryClient, variables.id),
  });
}

/**
 * Throw the user's strokes away and go back to what the model decided — for the
 * garment's own photo, or for one extra photo when `imageId` says so.
 */
export function useResetCutout() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async ({ id, imageId = null }: { id: string; imageId?: string | null }) => {
      if (session?.accessToken) setAccessToken(session.accessToken as string);
      return imageId
        ? api.delete<ItemImage>(`/items/${id}/images/${imageId}/cutout-mask`)
        : api.delete<Item>(`/items/${id}/cutout-mask`);
    },
    onSuccess: (_, variables) => invalidateGarmentImage(queryClient, variables.id),
  });
}

/**
 * Every list that shows a garment's picture, after that picture changed on disk.
 *
 * The signed URL changes on every read, so the only way a screen picks up a new
 * cut-out is a refetch — and a garment appears in the wardrobe, in looks, and on
 * the calendar, so all three have to be told.
 */
function invalidateGarmentImage(queryClient: ReturnType<typeof useQueryClient>, id: string) {
  queryClient.invalidateQueries({ queryKey: ['items'] });
  queryClient.invalidateQueries({ queryKey: ['item', id] });
  queryClient.invalidateQueries({ queryKey: ['outfits'] });
  queryClient.invalidateQueries({ queryKey: ['calendarOutfits'] });
}

export function useRestoreOriginal() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async (id: string) => {
      if (session?.accessToken) {
        setAccessToken(session.accessToken as string);
      }
      return api.post<Item>(`/items/${id}/restore-original`);
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['item', id] });
      queryClient.invalidateQueries({ queryKey: ['outfits'] });
      queryClient.invalidateQueries({ queryKey: ['calendarOutfits'] });
    },
  });
}

export function useReplaceItemImage() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async ({ itemId, file }: { itemId: string; file: File }) => {
      const token = session?.accessToken || getAccessToken();
      const formData = new FormData();
      formData.append('image', file);

      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`/api/v1/items/${itemId}/image`, {
        method: 'PUT',
        body: formData,
        credentials: 'include',
        headers,
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new ApiError(data.detail || 'Failed to replace image', response.status, data);
      }

      return response.json() as Promise<Item>;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['item', variables.itemId] });
      queryClient.invalidateQueries({ queryKey: ['outfits'] });
      queryClient.invalidateQueries({ queryKey: ['calendarOutfits'] });
    },
  });
}

export function useDeleteItem() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async (id: string) => {
      if (session?.accessToken) {
        setAccessToken(session.accessToken as string);
      }
      return api.delete(`/items/${id}`);
    },
    onMutate: async (deletedId) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['items'] });

      // Snapshot previous value
      const previousData = queryClient.getQueriesData({ queryKey: ['items'] });

      // Optimistically remove from all item queries
      queryClient.setQueriesData({ queryKey: ['items'] }, (old: ItemListResponse | undefined) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items.filter((item) => item.id !== deletedId),
          total: old.total - 1,
        };
      });

      return { previousData };
    },
    onError: (_err, _id, context) => {
      // Rollback on error
      if (context?.previousData) {
        context.previousData.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
    },
    onSettled: () => {
      // Refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['item-types'] });
    },
  });
}

export function useArchiveItem() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      if (session?.accessToken) {
        setAccessToken(session.accessToken as string);
      }
      return api.post<Item>(`/items/${id}/archive`, { reason });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
    },
  });
}

export function useLogWear() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async ({
      id,
      worn_at,
      occasion,
    }: {
      id: string;
      worn_at?: string;
      occasion?: string;
    }) => {
      if (session?.accessToken) {
        setAccessToken(session.accessToken as string);
      }
      return api.post<Item>(`/items/${id}/wear`, { worn_at, occasion });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['item', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['item-usage', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['wear-stats', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
    },
  });
}

export function useLogWash() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async ({
      id,
      washed_at,
      method,
      notes,
    }: {
      id: string;
      washed_at?: string;
      method?: string;
      notes?: string;
    }) => {
      if (session?.accessToken) {
        setAccessToken(session.accessToken as string);
      }
      return api.post<Item>(`/items/${id}/wash`, { washed_at, method, notes });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['item', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['wash-history', variables.id] });
    },
  });
}

export function useWashHistory(itemId: string) {
  const { status } = useSession();
  useSetTokenIfAvailable();

  return useQuery({
    queryKey: ['wash-history', itemId],
    queryFn: () => api.get<WashHistoryEntry[]>(`/items/${itemId}/wash-history`),
    enabled: !!itemId && status !== 'loading',
  });
}

export interface WearStats {
  total_wears: number;
  days_since_last_worn: number | null;
  average_wears_per_month: number;
  wear_by_month: Record<string, number>;
  wear_by_day_of_week: Record<string, number>;
  most_common_occasion: string | null;
}

export function useItemWearStats(itemId: string) {
  const { status } = useSession();
  useSetTokenIfAvailable();

  return useQuery({
    queryKey: ['wear-stats', itemId],
    queryFn: () => api.get<WearStats>(`/items/${itemId}/wear-stats`),
    enabled: !!itemId && status !== 'loading',
  });
}

/**
 * Veces puesta, última vez, coste por uso y con qué suele combinarse.
 *
 * Kept separate from `useItemWearStats` (the months/weekdays chart) because this
 * one is read every time the detail opens and is cheap enough to be.
 */
export function useItemUsage(itemId: string) {
  const { status } = useSession();
  useSetTokenIfAvailable();

  return useQuery({
    queryKey: ['item-usage', itemId],
    queryFn: () => api.get<ItemUsage>(`/items/${itemId}/usage`),
    enabled: !!itemId && status !== 'loading',
  });
}

export interface WearHistoryEntry {
  id: string;
  worn_at: string;
  occasion?: string;
  notes?: string;
  outfit?: {
    id: string;
    occasion: string;
    items: Array<{
      id: string;
      type: string;
      name?: string;
      thumbnail_url?: string;
    }>;
  };
}

export function useItemWearHistory(itemId: string, limit = 10) {
  const { status } = useSession();
  useSetTokenIfAvailable();

  return useQuery({
    queryKey: ['wear-history', itemId],
    queryFn: () => api.get<WearHistoryEntry[]>(`/items/${itemId}/history?limit=${limit}`),
    enabled: !!itemId && status !== 'loading',
  });
}

export function useAddItemImage() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async ({ itemId, file }: { itemId: string; file: File }) => {
      const token = session?.accessToken || getAccessToken();
      const formData = new FormData();
      formData.append('image', file);

      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`/api/v1/items/${itemId}/images`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
        headers,
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new ApiError(data.detail || 'Failed to upload image', response.status, data);
      }

      return response.json() as Promise<ItemImage>;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['item', variables.itemId] });
    },
  });
}

export function useDeleteItemImage() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async ({ itemId, imageId }: { itemId: string; imageId: string }) => {
      if (session?.accessToken) {
        setAccessToken(session.accessToken as string);
      }
      return api.delete(`/items/${itemId}/images/${imageId}`);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['item', variables.itemId] });
    },
  });
}

/**
 * Relabel one extra photo — "esta es la espalda", "esto es un detalle".
 *
 * Saved on the spot rather than batched into an edit: a label is a fact about the
 * photo, and the item detail offers it outside the edit mode for that reason.
 */
export function useSetItemImageView() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async ({
      itemId,
      imageId,
      view,
    }: {
      itemId: string;
      imageId: string;
      view: ImageView;
    }) => {
      if (session?.accessToken) {
        setAccessToken(session.accessToken as string);
      }
      return api.patch<ItemImage>(`/items/${itemId}/images/${imageId}/view`, {
        image_view: view,
      });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['item', variables.itemId] });
      // A back photo changes what a look can show, so the looks have to hear it.
      queryClient.invalidateQueries({ queryKey: ['outfits'] });
    },
  });
}

/** What the merge did, so the UI can say it rather than guess. */
export interface MergeItemResult {
  item: Item;
  /** False when there was nothing left to fold in — a retry of a merge that worked. */
  merged: boolean;
  moved_images: number;
}

/**
 * «Esta es la espalda de aquella»: move one garment's photos onto another, and let
 * the now-empty garment go.
 *
 * Only the user ever asks for this — nothing guesses that two photos are one
 * garment, because a front and a back shot of the same jumper look nothing alike.
 *
 * The garment kept keeps all of its own data; only the photos move. The API refuses
 * outright when the garment being folded in has a history of its own, rather than
 * writing it onto the keeper or throwing it away.
 */
export function useMergeItemInto() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async ({
      itemId,
      sourceItemId,
      view = 'back',
    }: {
      /** The garment we keep, which the photos move onto. */
      itemId: string;
      /** The garment whose photos move, and which is then deleted. */
      sourceItemId: string;
      view?: 'back' | 'detail';
    }) => {
      if (session?.accessToken) {
        setAccessToken(session.accessToken as string);
      }
      return api.post<MergeItemResult>(`/items/${itemId}/merge-from`, {
        item_id: sourceItemId,
        image_view: view,
      });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['item', variables.itemId] });
      queryClient.invalidateQueries({ queryKey: ['item', variables.sourceItemId] });
      queryClient.invalidateQueries({ queryKey: ['wardrobe-stats'] });
      // A garment gaining a back changes what a look can show.
      queryClient.invalidateQueries({ queryKey: ['outfits'] });
    },
  });
}

/** Put one extra photo's untouched original back — only that photo's. */
export function useRestoreItemImageOriginal() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async ({ itemId, imageId }: { itemId: string; imageId: string }) => {
      if (session?.accessToken) {
        setAccessToken(session.accessToken as string);
      }
      return api.post<ItemImage>(`/items/${itemId}/images/${imageId}/restore-original`);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['item', variables.itemId] });
    },
  });
}

/** Cut the garment out of one extra photo — only that photo. */
export function useRemoveItemImageBackground() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async ({ itemId, imageId }: { itemId: string; imageId: string }) => {
      if (session?.accessToken) {
        setAccessToken(session.accessToken as string);
      }
      return api.post<ItemImage>(`/items/${itemId}/images/${imageId}/remove-background`);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['item', variables.itemId] });
      queryClient.invalidateQueries({ queryKey: ['outfits'] });
    },
  });
}

export function useSetPrimaryImage() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async ({ itemId, imageId }: { itemId: string; imageId: string }) => {
      if (session?.accessToken) {
        setAccessToken(session.accessToken as string);
      }
      return api.post<Item>(`/items/${itemId}/images/${imageId}/set-primary`);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['item', variables.itemId] });
    },
  });
}

export function useRotateImage() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async ({
      id,
      direction,
      quarters = 1,
      imageId = null,
    }: {
      id: string;
      direction: 'cw' | 'ccw';
      /**
       * How many 90° steps, 1-3. Several taps on the button collapse into one
       * request and one re-encode, which is most of what made rotating a batch
       * feel like waiting.
       */
      quarters?: number;
      /**
       * Which photo to turn: the garment's own when omitted, one extra photo when
       * given. A back shot arrives sideways as often as a front one.
       */
      imageId?: string | null;
    }) => {
      if (session?.accessToken) {
        setAccessToken(session.accessToken as string);
      }
      const path = imageId ? `/items/${id}/images/${imageId}/rotate` : `/items/${id}/rotate`;
      return api.post<Item | ItemImage>(`${path}?direction=${direction}&quarters=${quarters}`);
    },
    onSuccess: (_, variables) => invalidateGarmentImage(queryClient, variables.id),
  });
}

export function useItemTypes() {
  const { status } = useSession();
  useSetTokenIfAvailable();

  return useQuery({
    queryKey: ['item-types'],
    queryFn: () => api.get<Array<{ type: string; count: number }>>('/items/types'),
    enabled: status !== 'loading',
  });
}

export function useColorDistribution() {
  const { status } = useSession();
  useSetTokenIfAvailable();

  return useQuery({
    queryKey: ['color-distribution'],
    queryFn: () => api.get<Array<{ color: string; count: number }>>('/items/colors'),
    enabled: status !== 'loading',
  });
}

export function useReanalyzeItem() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async (id: string) => {
      if (session?.accessToken) {
        setAccessToken(session.accessToken as string);
      }
      return api.post<{ job_id: string; status: string }>(`/items/${id}/analyze`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
    },
  });
}

export function useCancelAnalysis() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async (id: string) => {
      if (session?.accessToken) {
        setAccessToken(session.accessToken as string);
      }
      return api.post<Item>(`/items/${id}/cancel-analysis`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
    },
  });
}

export interface BulkUploadResult {
  filename: string;
  success: boolean;
  /** What the queue row shows. A duplicate is not a failure the user caused. */
  state: 'created' | 'duplicate' | 'error';
  item?: Item;
  /** too_big | invalid_format | duplicate | failed — the UI turns this into a sentence. */
  error_code?: string;
  error?: string;
  /** Whether a worker is now tagging it, or it landed ready and untagged. */
  tagging?: 'queued' | 'skipped';
  background_removed?: boolean;
}

export interface BulkUploadResponse {
  total: number;
  successful: number;
  failed: number;
  results: BulkUploadResult[];
}

export interface BulkDeleteResponse {
  deleted: number;
  failed: number;
  errors: string[];
}

export interface BulkOperationParams {
  // Either provide explicit item_ids, or use select_all with excluded_ids
  item_ids?: string[];
  select_all?: boolean;
  excluded_ids?: string[];
  // Filters to apply when using select_all (to match the current view)
  filters?: {
    type?: string;
    search?: string;
    needs_wash?: boolean;
    favorite?: boolean;
    is_archived?: boolean;
  };
}

export function useBulkDeleteItems() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async (params: BulkOperationParams) => {
      if (session?.accessToken) {
        setAccessToken(session.accessToken as string);
      }
      return api.post<BulkDeleteResponse>('/items/bulk/delete', params);
    },
    onMutate: async (params) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['items'] });

      // Snapshot previous value
      const previousData = queryClient.getQueriesData({ queryKey: ['items'] });

      // Optimistically update UI
      if (params.select_all) {
        // If select_all, remove all items except excluded ones
        const excludedSet = new Set(params.excluded_ids || []);
        queryClient.setQueriesData({ queryKey: ['items'] }, (old: ItemListResponse | undefined) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.filter((item) => excludedSet.has(item.id)),
            total: excludedSet.size,
          };
        });
      } else if (params.item_ids) {
        // Remove specific items
        const deletedSet = new Set(params.item_ids);
        queryClient.setQueriesData({ queryKey: ['items'] }, (old: ItemListResponse | undefined) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.filter((item) => !deletedSet.has(item.id)),
            total: old.total - params.item_ids!.length,
          };
        });
      }

      return { previousData };
    },
    onError: (_err, _params, context) => {
      // Rollback on error
      if (context?.previousData) {
        context.previousData.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
    },
    onSettled: () => {
      // Refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['item-types'] });
    },
  });
}

export interface BulkAnalyzeResponse {
  queued: number;
  failed: number;
  errors: string[];
}

export function useBulkReanalyzeItems() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async (params: BulkOperationParams) => {
      if (session?.accessToken) {
        setAccessToken(session.accessToken as string);
      }
      return api.post<BulkAnalyzeResponse>('/items/bulk/analyze', params);
    },
    onMutate: async (params) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['items'] });

      // Snapshot previous value
      const previousData = queryClient.getQueriesData({ queryKey: ['items'] });

      // Optimistically set items to processing status
      if (params.select_all) {
        const excludedSet = new Set(params.excluded_ids || []);
        queryClient.setQueriesData({ queryKey: ['items'] }, (old: ItemListResponse | undefined) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.map((item) =>
              !excludedSet.has(item.id) ? { ...item, status: 'processing' as const } : item
            ),
          };
        });
      } else if (params.item_ids) {
        const itemIdSet = new Set(params.item_ids);
        queryClient.setQueriesData({ queryKey: ['items'] }, (old: ItemListResponse | undefined) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.map((item) =>
              itemIdSet.has(item.id) ? { ...item, status: 'processing' as const } : item
            ),
          };
        });
      }

      return { previousData };
    },
    onError: (_err, _params, context) => {
      // Rollback on error
      if (context?.previousData) {
        context.previousData.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
    },
    onSettled: () => {
      // Refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: ['items'] });
    },
  });
}

/**
 * One photo, one request to POST /items/bulk.
 *
 * The endpoint still takes a list — that is how it was and how other callers use
 * it — but the queue sends them one at a time, because that is the only way each
 * row can carry its own upload progress, its own error and its own retry.
 */
export function uploadBulkPhoto(
  blob: Blob,
  name: string,
  options: { skipAi?: boolean; removeBackground?: boolean },
  token: string | null | undefined,
  onProgress: (percent: number) => void,
  register?: (xhr: XMLHttpRequest) => void
): Promise<BulkUploadResult> {
  const formData = new FormData();
  formData.append('images', blob, name);
  formData.append('skip_ai', String(options.skipAi ?? false));
  formData.append('remove_background', String(options.removeBackground ?? true));

  return new Promise<BulkUploadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    register?.(xhr);

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const response = JSON.parse(xhr.responseText) as BulkUploadResponse;
          const result = response.results?.[0];
          if (!result) {
            reject(new ApiError('invalid_response', xhr.status, {}));
            return;
          }
          resolve(result);
        } catch {
          reject(new ApiError('invalid_response', xhr.status, {}));
        }
        return;
      }
      let data: unknown = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* a proxy error page, not JSON */
      }
      reject(new ApiError('upload_failed', xhr.status, data as Record<string, unknown>));
    });

    xhr.addEventListener('error', () => {
      reject(
        new NetworkError(
          typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'unreachable'
        )
      );
    });
    xhr.addEventListener('abort', () => reject(new NetworkError('cancelled')));

    xhr.open('POST', '/api/v1/items/bulk');
    xhr.withCredentials = true;
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.send(formData);
  });
}

