/**
 * Reading where the device is, without ever keeping it precisely.
 *
 * The browser hands back a position accurate to metres. Nothing here passes
 * that on: {@link readDevicePosition} rounds to {@link CITY_COORD_DECIMALS}
 * before returning, so the precise fix never reaches our API, our state or the
 * network tab. The backend rounds again on arrival — the promise is kept on
 * both sides, and `backend/app/services/location_service.py` holds the twin of
 * these constants.
 *
 * Permission is always the browser's to ask: nothing in here calls
 * `getCurrentPosition` on its own. {@link geolocationPermissionState} exists so
 * the app-open travel check can stay silent unless permission was *already*
 * granted.
 */

/** 2 decimals ≈ 1 km: a city, not a street. Mirrors CITY_COORD_DECIMALS on the backend. */
export const CITY_COORD_DECIMALS = 2;

/** Beyond this, a reading is a trip worth asking about. Mirrors TRAVEL_DISTANCE_KM. */
export const TRAVEL_THRESHOLD_KM = 100;

/** Long enough for a cold GPS fix, short enough that nobody stares at a spinner. */
export const GEOLOCATION_TIMEOUT_MS = 10_000;

const EARTH_RADIUS_KM = 6371.0088;

/** Why we have no position. Each one keeps manual entry as the way forward. */
export type LocationFailure = 'unsupported' | 'denied' | 'timeout' | 'unavailable';

export type DevicePosition = { latitude: number; longitude: number };

export type LocationReading =
  | ({ ok: true } & DevicePosition)
  | { ok: false; reason: LocationFailure };

export function roundCityCoord(value: number): number {
  return Number(value.toFixed(CITY_COORD_DECIMALS));
}

/** Great-circle distance in km. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dPhi = phi2 - phi1;
  const dLambda = toRad(lon2 - lon1);
  const h =
    Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** True when a reading is far enough from the saved city to be worth asking about. */
export function isFarFromSaved(
  savedLat: number | null | undefined,
  savedLon: number | null | undefined,
  latitude: number,
  longitude: number
): boolean {
  if (savedLat == null || savedLon == null) return false;
  return haversineKm(savedLat, savedLon, latitude, longitude) > TRAVEL_THRESHOLD_KM;
}

/** Map a GeolocationPositionError code onto something we can say out loud. */
export function failureFromError(error: { code?: number } | null | undefined): LocationFailure {
  switch (error?.code) {
    case 1:
      return 'denied';
    case 3:
      return 'timeout';
    default:
      return 'unavailable';
  }
}

/**
 * One position from the browser, rounded to city precision.
 *
 * Never rejects: every outcome (including "the user said no") comes back as a
 * value, because none of them is an error the user needs to see as one.
 */
export function readDevicePosition(
  options: PositionOptions = {
    enableHighAccuracy: false,
    timeout: GEOLOCATION_TIMEOUT_MS,
    maximumAge: 10 * 60 * 1000,
  }
): Promise<LocationReading> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve({ ok: false, reason: 'unsupported' });
  }
  return new Promise((resolve) => {
    let settled = false;
    const done = (reading: LocationReading) => {
      if (settled) return;
      settled = true;
      resolve(reading);
    };
    navigator.geolocation.getCurrentPosition(
      (position) =>
        done({
          ok: true,
          // Rounded here, before the value exists anywhere else.
          latitude: roundCityCoord(position.coords.latitude),
          longitude: roundCityCoord(position.coords.longitude),
        }),
      (error) => done({ ok: false, reason: failureFromError(error) }),
      options
    );
  });
}

/**
 * Whether geolocation is already granted, without asking for it.
 *
 * Returns 'prompt' whenever we cannot tell (no Permissions API, or it throws),
 * which is the cautious answer: callers that must stay silent treat anything
 * but 'granted' as "do nothing".
 */
export async function geolocationPermissionState(): Promise<PermissionState> {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) return 'prompt';
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
    return status.state;
  } catch {
    return 'prompt';
  }
}
