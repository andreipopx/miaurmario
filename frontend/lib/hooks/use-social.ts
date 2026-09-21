import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Outfit } from '@/lib/hooks/use-outfits';

// -- Types (mirror backend/app/api/social.py) -----------------------------------

export type Relation = 'none' | 'friends' | 'outgoing' | 'incoming' | 'blocked';
export type OutfitVisibility = 'private' | 'friends' | 'public';

/** The only fields of another user the API ever returns. */
export interface PublicUser {
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
}

export interface Friendship {
  id: string;
  relation: Relation;
  user: PublicUser;
  created_at: string;
  accepted_at: string | null;
}

export interface FriendsOverview {
  friends: Friendship[];
  incoming: Friendship[];
  outgoing: Friendship[];
  blocked: Friendship[];
}

export interface SearchResult {
  user: PublicUser;
  relation: Relation;
  friendship_id: string | null;
}

export interface SocialSummary {
  pending_requests: number;
  new_reactions: number;
  total: number;
}

export interface SocialOutfitItem {
  id: string;
  type: string;
  subtype: string | null;
  name: string | null;
  primary_color: string | null;
  position: number;
  pos_x: number | null;
  pos_y: number | null;
  scale: number;
  rotation: number;
  z_index: number;
  image_url: string | null;
  thumbnail_url: string | null;
}

export interface MyReaction {
  rating: number;
  comment: string | null;
}

export interface SocialOutfit {
  id: string;
  author: PublicUser;
  is_mine: boolean;
  name: string | null;
  occasion: string;
  scheduled_for: string | null;
  visibility: OutfitVisibility;
  shared_at: string | null;
  day: string | null;
  worn_order_at: string | null;
  items: SocialOutfitItem[];
  reaction_count: number;
  comment_count: number;
  my_reaction: MyReaction | null;
}

export interface FeedDayGroup {
  author: PublicUser;
  day: string;
  last_shared_at: string;
  outfits: SocialOutfit[];
}

export interface FeedPage {
  groups: FeedDayGroup[];
  next_cursor: string | null;
}

export interface SocialOutfitPage {
  items: SocialOutfit[];
  next_cursor: string | null;
}

export interface Profile {
  user: PublicUser;
  relation: Relation;
  friendship_id: string | null;
  is_me: boolean;
  friend_count: number | null;
}

export interface Reaction {
  id: string;
  user: PublicUser;
  rating: number;
  comment: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface Activity {
  id: string;
  outfit_id: string;
  outfit_name: string | null;
  outfit_occasion: string;
  outfit_thumbnail_url: string | null;
  user: PublicUser;
  rating: number;
  comment: string | null;
  updated_at: string | null;
  is_new: boolean;
}

// -- Helpers --------------------------------------------------------------------------

export const SOCIAL_KEYS = {
  overview: ['friends'] as const,
  summary: ['friends', 'summary'] as const,
  search: (q: string) => ['friends', 'search', q] as const,
  feed: ['social', 'feed'] as const,
  profile: (username: string) => ['social', 'profile', username] as const,
  profileOutfits: (username: string) => ['social', 'profile', username, 'outfits'] as const,
  reactions: (outfitId: string) => ['social', 'reactions', outfitId] as const,
  activity: ['social', 'activity'] as const,
};

/** The share link for /u/{username}, on whatever origin the app is served from. */
export function profileShareUrl(username: string, origin?: string): string {
  const base = origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}/u/${encodeURIComponent(username)}`;
}

/** Username prefix accepted by the search endpoint (strip "@", lowercase, [a-z0-9_]). */
export function normalizeUsernameQuery(raw: string): string {
  return raw.trim().replace(/^@+/, '').toLowerCase().replace(/[^a-z0-9_]/g, '');
}

// -- Queries --------------------------------------------------------------------------

/** Badge counts: pending requests + new reactions. Polls every 60s. */
export function useSocialSummary(enabled = true) {
  return useQuery({
    queryKey: SOCIAL_KEYS.summary,
    queryFn: () => api.get<SocialSummary>('/friends/summary'),
    enabled,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function useFriendsOverview() {
  return useQuery({
    queryKey: SOCIAL_KEYS.overview,
    queryFn: () => api.get<FriendsOverview>('/friends'),
  });
}

export function useUserSearch(query: string) {
  const q = normalizeUsernameQuery(query);
  return useQuery({
    queryKey: SOCIAL_KEYS.search(q),
    queryFn: () => api.get<SearchResult[]>('/friends/search', { params: { q } }),
    enabled: q.length >= 2,
    staleTime: 30_000,
    retry: false,
  });
}

export function useFriendsFeed() {
  return useInfiniteQuery({
    queryKey: SOCIAL_KEYS.feed,
    queryFn: ({ pageParam }) =>
      api.get<FeedPage>('/social/feed', {
        params: pageParam ? { cursor: pageParam } : undefined,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
  });
}

export function useProfile(username: string | undefined) {
  return useQuery({
    queryKey: SOCIAL_KEYS.profile(username ?? ''),
    queryFn: () => api.get<Profile>(`/social/users/${encodeURIComponent(username!)}`),
    enabled: !!username,
    retry: false,
  });
}

export function useProfileOutfits(username: string | undefined, enabled = true) {
  return useInfiniteQuery({
    queryKey: SOCIAL_KEYS.profileOutfits(username ?? ''),
    queryFn: ({ pageParam }) =>
      api.get<SocialOutfitPage>(`/social/users/${encodeURIComponent(username!)}/outfits`, {
        params: pageParam ? { cursor: pageParam } : undefined,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    enabled: !!username && enabled,
  });
}

export function useOutfitReactions(outfitId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: SOCIAL_KEYS.reactions(outfitId ?? ''),
    queryFn: () => api.get<Reaction[]>(`/social/outfits/${outfitId}/reactions`),
    enabled: !!outfitId && enabled,
  });
}

export function useSocialActivity() {
  return useQuery({
    queryKey: SOCIAL_KEYS.activity,
    queryFn: () => api.get<Activity[]>('/social/activity'),
  });
}

// -- Mutations ---------------------------------------------------------------------------

function useInvalidateFriends() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['friends'] });
    qc.invalidateQueries({ queryKey: ['social'] });
  };
}

export function useSendFriendRequest() {
  const invalidate = useInvalidateFriends();
  return useMutation({
    mutationFn: (username: string) => api.post<Friendship>('/friends/requests', { username }),
    onSuccess: invalidate,
  });
}

export function useAcceptFriend() {
  const invalidate = useInvalidateFriends();
  return useMutation({
    mutationFn: (friendshipId: string) => api.post<Friendship>(`/friends/${friendshipId}/accept`),
    onSuccess: invalidate,
  });
}

/** Decline, cancel, unfriend or unblock — the backend decides from the relation. */
export function useRemoveFriendship() {
  const invalidate = useInvalidateFriends();
  return useMutation({
    mutationFn: (friendshipId: string) => api.delete<void>(`/friends/${friendshipId}`),
    onSuccess: invalidate,
  });
}

export function useBlockUser() {
  const invalidate = useInvalidateFriends();
  return useMutation({
    mutationFn: (username: string) => api.post<void>('/friends/block', { username }),
    onSuccess: invalidate,
  });
}

function patchOutfitInCaches(qc: ReturnType<typeof useQueryClient>, updated: SocialOutfit) {
  const patch = (o: SocialOutfit) => (o.id === updated.id ? updated : o);
  qc.setQueriesData<{ pages: FeedPage[]; pageParams: unknown[] }>({ queryKey: SOCIAL_KEYS.feed }, (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((p) => ({
            ...p,
            groups: p.groups.map((g) => ({ ...g, outfits: g.outfits.map(patch) })),
          })),
        }
      : data
  );
  qc.setQueriesData<{ pages: SocialOutfitPage[]; pageParams: unknown[] }>(
    { queryKey: ['social', 'profile'] },
    (data) =>
      data && Array.isArray((data as { pages?: unknown }).pages)
        ? { ...data, pages: data.pages.map((p) => ({ ...p, items: (p.items ?? []).map(patch) })) }
        : data
  );
}

export function useReact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ outfitId, comment, rating = 5 }: { outfitId: string; comment?: string | null; rating?: number }) =>
      api.put<SocialOutfit>(`/social/outfits/${outfitId}/reaction`, { rating, comment: comment ?? null }),
    onSuccess: (updated) => patchOutfitInCaches(qc, updated),
  });
}

export function useRemoveReaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (outfitId: string) => api.delete<SocialOutfit>(`/social/outfits/${outfitId}/reaction`),
    onSuccess: (updated) => patchOutfitInCaches(qc, updated),
  });
}

export function useMarkActivitySeen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<void>('/social/activity/seen'),
    onSuccess: () => qc.invalidateQueries({ queryKey: SOCIAL_KEYS.summary }),
  });
}

function useInvalidateOutfit() {
  const qc = useQueryClient();
  return (outfit: Outfit) => {
    qc.setQueryData(['outfit', outfit.id], outfit);
    qc.invalidateQueries({ queryKey: ['outfits'] });
    qc.invalidateQueries({ queryKey: ['social'] });
  };
}

export function useSetOutfitVisibility() {
  const onDone = useInvalidateOutfit();
  return useMutation({
    mutationFn: ({ outfitId, visibility }: { outfitId: string; visibility: OutfitVisibility }) =>
      api.patch<Outfit>(`/outfits/${outfitId}/visibility`, { visibility }),
    onSuccess: onDone,
  });
}

/** "Compartir con tus amigos": private → friends (public stays public). */
export function useShareOutfit() {
  const onDone = useInvalidateOutfit();
  return useMutation({
    mutationFn: (outfitId: string) => api.post<Outfit>(`/outfits/${outfitId}/share`),
    onSuccess: onDone,
  });
}

export function useUnshareOutfit() {
  const onDone = useInvalidateOutfit();
  return useMutation({
    mutationFn: (outfitId: string) => api.delete<Outfit>(`/outfits/${outfitId}/share`),
    onSuccess: onDone,
  });
}
