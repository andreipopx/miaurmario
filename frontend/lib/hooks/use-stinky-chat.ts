'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { api, setAccessToken } from '@/lib/api';
import type {
  ChatOutfitCard,
  ConversationDetail,
  ConversationSummary,
} from '@/lib/stinky-chat';

function useToken() {
  const { data: session, status } = useSession();
  if (session?.accessToken) {
    setAccessToken(session.accessToken as string);
  }
  return status;
}

export const STINKY_CONVERSATIONS_KEY = ['stinky-conversations'] as const;

export function useStinkyConversations(enabled = true) {
  const status = useToken();
  return useQuery({
    queryKey: STINKY_CONVERSATIONS_KEY,
    queryFn: () =>
      api.get<{ conversations: ConversationSummary[] }>('/stinky/conversations'),
    enabled: enabled && status === 'authenticated',
    staleTime: 30 * 1000,
  });
}

export function useStinkyConversation(id: string | null) {
  const status = useToken();
  return useQuery({
    queryKey: ['stinky-conversation', id],
    queryFn: () => api.get<ConversationDetail>(`/stinky/conversations/${id}`),
    enabled: !!id && status === 'authenticated',
    // The page keeps its own live copy while streaming; never clobber it on focus.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    meta: { silentStatuses: [404] },
  });
}

export function useDeleteStinkyConversation() {
  useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/stinky/conversations/${id}`),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: ['stinky-conversation', id] });
      queryClient.invalidateQueries({ queryKey: STINKY_CONVERSATIONS_KEY });
    },
  });
}

export interface SaveChatOutfitPayload {
  item_ids: string[];
  name?: string | null;
  occasion?: string | null;
  message_id?: string | null;
  card_index?: number | null;
}

export function useSaveStinkyOutfit() {
  useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: SaveChatOutfitPayload) =>
      api.post<{ card: ChatOutfitCard }>('/stinky/outfits', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['outfits'] });
    },
  });
}
