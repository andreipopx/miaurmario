// Shared by the request config (server) and TimeZoneCookie (browser): no server imports here.

// The device's IANA zone, written by the browser (components/time-zone-cookie.tsx).
export const TIME_ZONE_COOKIE = 'mm_tz';
export const DEFAULT_TIME_ZONE = 'Europe/Madrid';

/**
 * Dates must be formatted in the user's zone on the server and in the browser alike:
 * without one, next-intl formatted in UTC, so Monday 00:00 in Madrid came out as
 * "dom" in the week strip. The browser reports its zone in a cookie; until it has,
 * the deployment's home zone stands in.
 */
export function resolveTimeZone(value: string | undefined): string {
  if (!value) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return value;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}
