/**
 * «Modo viaje»: small pure helpers for the trip screens (dates, weather, suitcase).
 */
import type { Trip, TripDay, TripWeather } from '@/lib/hooks/use-trips';
import type { Item } from '@/lib/types';

/** "YYYY-MM-DD" as a local date (no UTC shift: a trip day is a calendar day). */
function parseDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** "12 – 15 oct" in the same month, "28 oct – 2 nov" across months. */
export function formatTripDates(start: string, end: string, locale: string): string {
  const a = parseDay(start);
  const b = parseDay(end);
  const dayMonth = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
  if (start === end) return dayMonth.format(a);
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
    return `${a.getDate()} – ${dayMonth.format(b)}`;
  }
  return `${dayMonth.format(a)} – ${dayMonth.format(b)}`;
}

/** "sábado 18" — the heading of a trip day. */
export function formatTripDay(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric' }).format(parseDay(iso));
}

/** The day's min and max: the forecast stores their average and the max. */
export function tripTemperatures(w: TripWeather): { min: number; max: number } {
  return { min: Math.round(2 * w.temperature - w.feels_like), max: Math.round(w.feels_like) };
}

/** The garments of a day, in the order the plan lists them, skipping any deleted since. */
export function dayItems(day: TripDay, trip: Pick<Trip, 'items'>): Item[] {
  const byId = new Map(trip.items.map((i) => [i.id, i]));
  return day.item_ids.map((id) => byId.get(id)).filter((i): i is Item => !!i);
}

/** How many looks each packed garment shows up in (the suitcase's reuse at a glance). */
export function timesWorn(trip: Pick<Trip, 'days'>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const day of trip.days) for (const id of day.item_ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}
