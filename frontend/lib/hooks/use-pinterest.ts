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

export interface PinterestBoard {
  id: string;
  name: string;
  pin_count?: number;
  media?: { image_cover_url?: string };
}

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

export function usePinterestBoards(enabled = true) {
  useSetTokenIfAvailable();
  return useQuery({
    queryKey: ['pinterest', 'boards'],
    queryFn: () => api.get<PinterestBoardList>('/integrations/pinterest/boards'),
    enabled,
    retry: false,
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pinterest', 'pins'] }),
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

export function usePinterestPins(limit = 50, offset = 0, boardId?: string) {
  useSetTokenIfAvailable();
  const params: Record<string, string> = {
    limit: String(limit),
    offset: String(offset),
  };
  if (boardId) params.board_id = boardId;
  return useQuery({
    queryKey: ['pinterest', 'pins', limit, offset, boardId ?? null],
    queryFn: () => api.get<PinterestPinList>('/pins', { params }),
  });
}
