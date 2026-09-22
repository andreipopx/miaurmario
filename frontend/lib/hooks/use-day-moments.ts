'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { api, setAccessToken } from '@/lib/api';
import type { DayPlan, MomentSuggestBody, MomentSuggestResult } from '@/lib/day-moments';

function useSetTokenIfAvailable() {
  const { data: session } = useSession();
  if (session?.accessToken) {
    setAccessToken(session.accessToken as string);
  }
}

export const dayPlanKey = (day: string) => ['dayPlan', day] as const;

function invalidateOutfitViews(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ['outfits'] });
  queryClient.invalidateQueries({ queryKey: ['calendarOutfits'] });
  queryClient.invalidateQueries({ queryKey: ['pendingOutfits'] });
  queryClient.invalidateQueries({ queryKey: ['analytics'] });
}

/** The moments of a day ("today" or YYYY-MM-DD) with their current look. */
export function useDayPlan(day = 'today') {
  const { status } = useSession();
  useSetTokenIfAvailable();
  return useQuery({
    queryKey: dayPlanKey(day),
    queryFn: () => api.get<DayPlan>(`/days/${day}`),
    enabled: status !== 'loading',
  });
}

/** Add a moment (no `order`) or ask for another idea for one (`order`). */
export function useSuggestMoment(day = 'today') {
  useSetTokenIfAvailable();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: MomentSuggestBody) => api.post<MomentSuggestResult>(`/days/${day}/moments`, body),
    onSuccess: (result) => {
      queryClient.setQueryData(dayPlanKey(day), result.day);
      invalidateOutfitViews(queryClient);
    },
  });
}

export function useDeleteMoment(day = 'today') {
  useSetTokenIfAvailable();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (order: number) => api.delete<void>(`/days/${day}/moments/${order}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dayPlanKey(day) });
      invalidateOutfitViews(queryClient);
    },
  });
}

/** "Me lo pongo" for one moment: accept the look and log it as worn today. */
export function useWearMomentLook(day = 'today') {
  useSetTokenIfAvailable();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (outfitId: string) =>
      api.post<unknown>(`/outfits/${outfitId}/feedback`, { accepted: true, worn: true }),
    onSuccess: (_, outfitId) => {
      queryClient.invalidateQueries({ queryKey: dayPlanKey(day) });
      queryClient.invalidateQueries({ queryKey: ['outfit', outfitId] });
      invalidateOutfitViews(queryClient);
    },
  });
}
