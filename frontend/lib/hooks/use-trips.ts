'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';

import { api, setAccessToken } from '@/lib/api';
import type { Item } from '@/lib/types';

function useToken() {
  const { data: session } = useSession();
  if (session?.accessToken) setAccessToken(session.accessToken as string);
}

export type TripStatus = 'planning' | 'ready' | 'error';

export interface TripSummary {
  id: string;
  destination: string;
  country: string | null;
  start_date: string;
  end_date: string;
  status: TripStatus;
  error: string | null;
  days_count: number;
  packed: number;
  to_pack: number;
}

export interface TripWeather {
  temperature: number;
  feels_like: number;
  precipitation_chance: number;
  condition: string;
  condition_code: number;
  condition_label?: string | null;
}

export interface TripDay {
  date: string;
  weather: TripWeather | null;
  item_ids: string[];
  note: string | null;
}

export interface Trip extends TripSummary {
  latitude: number;
  longitude: number;
  plans: string | null;
  engine: 'ai' | 'heuristic' | null;
  days: TripDay[];
  packing: { item_id: string; packed: boolean }[];
  extras: string[];
  items: Item[];
}

export interface TripCreate {
  destination: string;
  country?: string | null;
  latitude: number;
  longitude: number;
  timezone?: string | null;
  start_date: string;
  end_date: string;
  plans?: string | null;
}

const LIST_KEY = ['trips'] as const;
const tripKey = (id: string) => ['trips', id] as const;

export function useTrips() {
  const { status } = useSession();
  useToken();
  return useQuery({
    queryKey: LIST_KEY,
    queryFn: () => api.get<{ upcoming: TripSummary[]; past: TripSummary[] }>('/trips'),
    enabled: status !== 'loading',
  });
}

export function useTrip(id: string | undefined) {
  const { status } = useSession();
  useToken();
  return useQuery({
    queryKey: tripKey(id ?? ''),
    queryFn: () => api.get<Trip>(`/trips/${id}`),
    enabled: status !== 'loading' && !!id,
    // While Stinky packs, check back until the plan is there.
    refetchInterval: (query) => (query.state.data?.status === 'planning' ? 2500 : false),
  });
}

export function useCreateTrip() {
  const queryClient = useQueryClient();
  useToken();
  return useMutation({
    mutationFn: (body: TripCreate) => api.post<Trip>('/trips', body),
    onSuccess: (trip) => {
      queryClient.setQueryData(tripKey(trip.id), trip);
      queryClient.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
}

export function useReplanTrip(id: string) {
  const queryClient = useQueryClient();
  useToken();
  return useMutation({
    mutationFn: () => api.post<Trip>(`/trips/${id}/plan`, {}),
    onSuccess: (trip) => queryClient.setQueryData(tripKey(id), trip),
  });
}

/** Tick a garment in or out of the suitcase (shown at once, put back on failure). */
export function usePackItem(id: string) {
  const queryClient = useQueryClient();
  useToken();
  return useMutation({
    mutationFn: (body: { item_id: string; packed: boolean }) =>
      api.patch<TripSummary>(`/trips/${id}/packing`, body),
    onMutate: async ({ item_id, packed }) => {
      await queryClient.cancelQueries({ queryKey: tripKey(id) });
      const before = queryClient.getQueryData<Trip>(tripKey(id));
      if (before) {
        queryClient.setQueryData<Trip>(tripKey(id), {
          ...before,
          packing: before.packing.map((p) => (p.item_id === item_id ? { ...p, packed } : p)),
        });
      }
      return { before };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.before) queryClient.setQueryData(tripKey(id), ctx.before);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

export function useDeleteTrip() {
  const queryClient = useQueryClient();
  useToken();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/trips/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: LIST_KEY }),
  });
}
