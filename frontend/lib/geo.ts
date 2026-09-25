import { api } from '@/lib/api';
import { roundCityCoord } from '@/lib/location-detect';

/** A place from the backend geocoding proxy (/geo/search, /geo/reverse). */
export interface Place {
  name: string;
  admin1?: string | null;
  country?: string | null;
  country_code?: string | null;
  latitude: number;
  longitude: number;
  timezone?: string | null;
  /** "Madrid, Comunidad de Madrid, España" */
  label: string;
}

/** What the user profile stores for "where am I". */
export interface SavedLocation {
  name: string;
  lat: number | null;
  lon: number | null;
  /** IANA zone of the chosen place, when known. */
  timezone?: string | null;
}

/** users.location_name is VARCHAR(100). */
export const LOCATION_NAME_MAX = 100;

export const MIN_PLACE_QUERY = 2;

export function geoLang(locale: string): 'es' | 'en' {
  return locale.startsWith('en') ? 'en' : 'es';
}

export async function searchPlaces(query: string, locale: string): Promise<Place[]> {
  const q = query.trim();
  if (q.length < MIN_PLACE_QUERY) return [];
  const data = await api.get<{ results: Place[] }>('/geo/search', {
    params: { q, lang: geoLang(locale) },
  });
  return data.results;
}

// A device reading is turned into a city by POST /users/me/location/device
// (lib/hooks/use-location.ts), which rounds, reverse-geocodes and decides
// whether to save or to ask about a trip. The plain GET /geo/reverse endpoint
// still exists on the backend; nothing in the app calls it directly.

export function placeToLocation(place: Place): SavedLocation {
  return {
    name: place.label.slice(0, LOCATION_NAME_MAX),
    // City centre, at the same ~1 km granularity we store everywhere else.
    lat: roundCityCoord(place.latitude),
    lon: roundCityCoord(place.longitude),
    timezone: place.timezone ?? null,
  };
}

/** Secondary line under a result: "Comunidad de Madrid, España". */
export function placeSubtitle(place: Place): string {
  return [place.admin1, place.country]
    .filter((part, i, all): part is string => !!part && part !== place.name && all.indexOf(part) === i)
    .join(', ');
}
