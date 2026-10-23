'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { api, setAccessToken } from '@/lib/api';
import type { SelfieAnalysis } from '@/lib/selfie';

function useSetTokenIfAvailable() {
  const { data: session } = useSession();
  if (session?.accessToken) {
    setAccessToken(session.accessToken as string);
  }
}

/** What Stinky made of a board the user shared (null: not shared). */
export interface PinterestBoardStinky {
  status: 'importing' | 'analyzing' | 'ready' | 'no_ai' | 'error';
  summary: string | null;
  is_fashion: boolean | null;
  pin_count: number;
  imported_at: string | null;
}

export interface PinterestBoard {
  id: string;
  name: string;
  privacy?: string;
  pin_count?: number;
  media?: { image_cover_url?: string };
  stinky?: PinterestBoardStinky | null;
}

const READING: PinterestBoardStinky['status'][] = ['importing', 'analyzing'];
export const isReadingBoard = (board: PinterestBoard) =>
  !!board.stinky && READING.includes(board.stinky.status);

export interface PinterestBoardList {
  items: PinterestBoard[];
  bookmark?: string | null;
}

export interface PinterestPin {
  id: string;
  pinterest_pin_id: string;
  board_id: string;
  board_name: string | null;
  image_url: string;
  source_link: string | null;
  description: string | null;
  dominant_color: string | null;
  imported_at: string;
}

export interface PinterestPinList {
  items: PinterestPin[];
  limit: number;
  offset: number;
}

export interface PinterestStatus {
  configured: boolean;
  connected: boolean;
  pinterest_user_id: string | null;
  connected_at: string | null;
  scopes: string | null;
  pin_count: number;
}

export function usePinterestStatus() {
  useSetTokenIfAvailable();
  return useQuery({
    queryKey: ['pinterest', 'status'],
    queryFn: () => api.get<PinterestStatus>('/integrations/pinterest/status'),
  });
}

export function usePinterestBoards(enabled = true) {
  useSetTokenIfAvailable();
  return useInfiniteQuery({
    queryKey: ['pinterest', 'boards'],
    queryFn: ({ pageParam }) =>
      api.get<PinterestBoardList>(
        '/integrations/pinterest/boards',
        pageParam ? { params: { bookmark: pageParam } } : undefined,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.bookmark || null,
    enabled,
    retry: false,
    // While Stinky reads a board, check back until he has written its summary.
    refetchInterval: (query) =>
      query.state.data?.pages.some((p) => p.items.some(isReadingBoard)) ? 3000 : false,
  });
}

export function usePinterestConnect() {
  useSetTokenIfAvailable();
  return useMutation({
    mutationFn: async () => {
      const { authorize_url } = await api.get<{ authorize_url: string }>(
        '/integrations/pinterest/connect',
      );
      window.location.href = authorize_url;
    },
  });
}

export function usePinterestImportBoard() {
  const qc = useQueryClient();
  useSetTokenIfAvailable();
  return useMutation({
    mutationFn: (boardId: string) =>
      api.post<{ job_id: string }>(
        `/integrations/pinterest/boards/${boardId}/import`,
        {},
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pinterest'] }),
  });
}

export function usePinterestRemoveBoard() {
  const qc = useQueryClient();
  useSetTokenIfAvailable();
  return useMutation({
    mutationFn: (boardId: string) => api.delete(`/integrations/pinterest/boards/${boardId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pinterest'] }),
  });
}

export function usePinterestDisconnect() {
  const qc = useQueryClient();
  useSetTokenIfAvailable();
  return useMutation({
    mutationFn: () => api.delete('/integrations/pinterest'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pinterest'] });
    },
  });
}

export function usePinterestPins(limit = 50, offset = 0, boardId?: string, enabled = true) {
  useSetTokenIfAvailable();
  const params: Record<string, string> = {
    limit: String(limit),
    offset: String(offset),
  };
  if (boardId) params.board_id = boardId;
  return useQuery({
    queryKey: ['pinterest', 'pins', limit, offset, boardId ?? null],
    queryFn: () => api.get<PinterestPinList>('/pins', { params }),
    enabled,
  });
}

export function usePinterestPin(pinId: string | null) {
  useSetTokenIfAvailable();
  return useQuery({
    queryKey: ['pinterest', 'pin', pinId],
    queryFn: () => api.get<PinterestPin>(`/pins/${pinId}`),
    enabled: pinId !== null,
  });
}

/** «Recrea este look con mi ropa»: the pin's garments matched to the wardrobe. */
export function useRecreatePin() {
  useSetTokenIfAvailable();
  return useMutation({
    // The screen renders its own inline message (AI notices included).
    meta: { silentErrors: true },
    mutationFn: (pinId: string) => api.post<SelfieAnalysis>(`/pins/${pinId}/recreate`, {}),
  });
}
