'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { SavedLocation } from '@/lib/geo';

/** Who asked for this reading — it decides what the backend may change. */
export type LocationTrigger =
  /** The user tapped "Usar mi ubicación": saves, unless it looks like a trip. */
  | 'button'
  /** A silent check on app open: only ever reports a trip, at most once a day. */
  | 'open'
  /** "Sí, actualízalo" on the travel prompt: saves. */
  | 'confirm';

export interface DetectedPlace {
  name: string;
  label: string;
  latitude: number;
  longitude: number;
  timezone?: string | null;
}

export interface DeviceLocationResult {
  status: 'saved' | 'travel_suspected' | 'unchanged';
  detected?: DetectedPlace | null;
  /** The city still on file, for "No, sigue con Madrid". */
  current_city?: string | null;
  distance_km?: number | null;
  timezone?: string | null;
  timezone_source?: string | null;
}

export interface DeviceLocationInput {
  latitude: number;
  longitude: number;
  lang: 'es' | 'en';
  trigger: LocationTrigger;
}

export function detectedToSavedLocation(place: DetectedPlace): SavedLocation {
  return {
    name: place.label,
    lat: place.latitude,
    lon: place.longitude,
    timezone: place.timezone ?? null,
  };
}

/**
 * Turn a (already city-rounded) device reading into a city, server-side.
 *
 * The backend decides whether to save or to ask; see
 * `backend/app/api/location.py`. Nothing here changes the city on its own.
 */
export function useDeviceLocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: DeviceLocationInput) =>
      api.post<DeviceLocationResult>('/users/me/location/device', input),
    onSuccess: (result) => {
      if (result.status === 'saved') invalidateProfile(queryClient);
    },
  });
}

/** "Borrar mi ubicación": forget the city, keep the timezone. */
export function useDeleteLocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<unknown>('/users/me/location'),
    onSuccess: () => {
      invalidateProfile(queryClient);
      // Weather is location-derived; drop it so the UI degrades right away.
      queryClient.invalidateQueries({ queryKey: ['weather'] });
    },
  });
}

export interface AutoTimezoneResult {
  timezone: string;
  timezone_source: string;
  updated: boolean;
}

/**
 * Offer the device's zone. The backend keeps a manual choice, so this is safe
 * to fire on every first load.
 */
export function useAutoTimezone() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (timezone: string) =>
      api.post<AutoTimezoneResult>('/users/me/timezone/auto', { timezone }),
    onSuccess: (result) => {
      if (result.updated) invalidateProfile(queryClient);
    },
  });
}

function invalidateProfile(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['user-profile'] });
  queryClient.invalidateQueries({ queryKey: ['auth-user'] });
}
