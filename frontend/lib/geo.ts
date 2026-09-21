import { api } from '@/lib/api';

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

export async function reverseGeocode(lat: number, lon: number, locale: string): Promise<Place> {
  return api.get<Place>('/geo/reverse', {
    params: { lat: lat.toFixed(5), lon: lon.toFixed(5), lang: geoLang(locale) },
  });
}

export function placeToLocation(place: Place): SavedLocation {
  return {
    name: place.label.slice(0, LOCATION_NAME_MAX),
    lat: Number(place.latitude.toFixed(6)),
    lon: Number(place.longitude.toFixed(6)),
    timezone: place.timezone ?? null,
  };
}

/** Secondary line under a result: "Comunidad de Madrid, España". */
export function placeSubtitle(place: Place): string {
  return [place.admin1, place.country]
    .filter((part, i, all): part is string => !!part && part !== place.name && all.indexOf(part) === i)
    .join(', ');
}
