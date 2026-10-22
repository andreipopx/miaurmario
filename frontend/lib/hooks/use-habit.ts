'use client';

import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { api, setAccessToken } from '@/lib/api';
import type { StinkyAccessory } from '@/components/stinky/stinky-accessory';
import type { UserProfile } from '@/lib/hooks/use-user';

/** Stinky's meals, level, weekly streak and wardrobe (GET /habit). */
export interface Habit {
  today: string;
  fed_today: boolean;
  meals: number;
  level: number;
  level_starts_at: number;
  next_level_at: number | null;
  week_days: string[];
  weekly_goal: number;
  week_met: boolean;
  streak_weeks: number;
  best_streak_weeks: number;
  frozen_weeks: string[];
  comodin_left_this_month: boolean;
  unlocked: StinkyAccessory[];
  accessories: Record<StinkyAccessory, number>;
  accessory: StinkyAccessory | null;
  last_meal: string | null;
  welcome_back: boolean;
  levels: number[];
}

export const HABIT_KEY = ['habit'] as const;

export function useHabit(enabled = true) {
  const { data: session, status } = useSession();
  if (session?.accessToken) setAccessToken(session.accessToken as string);
  return useQuery({
    queryKey: HABIT_KEY,
    queryFn: () => api.get<Habit>('/habit'),
    enabled: enabled && status !== 'loading',
    staleTime: 30_000,
  });
}

/**
 * Any look logged anywhere (Hoy, Qué llevo, the history, the lookbook) feeds
 * Stinky, so the habit is refreshed after every successful change rather than
 * each of those mutations having to remember it.
 */
export function useHabitFollowsChanges() {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      queryClient.getMutationCache().subscribe((event) => {
        if (event.type === 'updated' && event.action.type === 'success') {
          void queryClient.invalidateQueries({ queryKey: HABIT_KEY });
        }
      }),
    [queryClient]
  );
}

export function useUpdateHabit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { weekly_goal?: number; accessory?: StinkyAccessory | '' }) =>
      api.patch<Habit>('/habit', body),
    onSuccess: (habit) => {
      queryClient.setQueryData(HABIT_KEY, habit);
      // The accessory is part of the persona every Stinky on screen reads.
      queryClient.setQueryData<UserProfile>(['auth-user'], (profile) =>
        profile ? { ...profile, stinky_accessory: habit.accessory } : profile
      );
    },
  });
}
