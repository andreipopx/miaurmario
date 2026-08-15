'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type FriendshipStatus = 'pending' | 'accepted' | 'blocked';
export type FriendshipDirection = 'outgoing' | 'incoming';

export interface FriendUser {
  id: string;
  username: string | null;
  display_name: string;
  avatar_url: string | null;
}

export interface Friendship {
  id: string;
  status: FriendshipStatus;
  direction: FriendshipDirection;
  other: FriendUser;
}

export interface FeedOutfit {
  id: string;
  occasion: string;
  scheduled_for: string | null;
  name: string | null;
  reasoning: string | null;
  style_notes: string | null;
  visibility: 'private' | 'friends' | 'public';
  created_at: string;
  author: FriendUser;
}

export interface FeedPage {
  items: FeedOutfit[];
  next_cursor: string | null;
}

export function useFriends(status?: FriendshipStatus) {
  return useQuery({
    queryKey: ['friends', status ?? 'all'],
    queryFn: () => api.get<Friendship[]>('/friends', status ? { params: { status } } : undefined),
  });
}

export function usePendingIncomingCount() {
  return useQuery({
    queryKey: ['friends', 'pending', 'incoming', 'count'],
    queryFn: async () => {
      const list = await api.get<Friendship[]>('/friends', { params: { status: 'pending' } });
      return list.filter((f) => f.direction === 'incoming').length;
    },
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

export function useRequestFriend() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (username: string) =>
      api.post<Friendship>('/friends/request', { username: username.toLowerCase() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friends'] }),
  });
}

export function useAcceptFriend() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (friendshipId: string) => api.post<Friendship>(`/friends/${friendshipId}/accept`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friends'] }),
  });
}

export function useDeclineFriend() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (friendshipId: string) => api.post<void>(`/friends/${friendshipId}/decline`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friends'] }),
  });
}

export function useFeedToday() {
  return useInfiniteQuery({
    queryKey: ['feed', 'today'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.get<FeedPage>('/feed/today', pageParam ? { params: { cursor: pageParam } } : undefined),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
}

export function useRateOutfit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      outfitId,
      rating,
      comment,
    }: {
      outfitId: string;
      rating: number;
      comment?: string;
    }) => api.post(`/outfits/${outfitId}/rate`, { rating, comment: comment ?? null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feed'] }),
  });
}
