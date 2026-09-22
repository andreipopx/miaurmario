// "Momentos del día": several looks per day. Pure helpers + API types (unit-testable).

import type { Outfit } from '@/lib/hooks/use-outfits';

export interface DayMoment {
  order: number;
  /** null = the day's default (unlabelled) moment, e.g. looks from before moments existed. */
  label: string | null;
  /** "HH:MM:SS" or null. */
  time: string | null;
  occasion: string;
  outfit: Outfit | null;
  is_worn: boolean;
  transition_from_order: number | null;
  /** Items this look shares with the previous moment's look. */
  shared_item_ids: string[];
  look_count: number;
}

export interface DayPlan {
  date: string;
  moments: DayMoment[];
  max_moments: number;
}

export interface MomentSuggestBody {
  /** Omit to add a new moment at the end; set to regenerate that moment. */
  order?: number;
  label?: string | null;
  /** "HH:MM" */
  time?: string | null;
  occasion?: string | null;
  transition?: boolean;
}

export interface MomentSuggestResult {
  day: DayPlan;
  outfit_id: string;
  engine: 'ai' | 'heuristic';
}

export type MomentPresetKey = 'morning' | 'afternoon' | 'evening';

export interface MomentPreset {
  key: MomentPresetKey;
  time: string;
  occasion: string;
}

export const MOMENT_PRESETS: readonly MomentPreset[] = [
  { key: 'morning', time: '09:00', occasion: 'work' },
  { key: 'afternoon', time: '15:00', occasion: 'casual' },
  { key: 'evening', time: '20:30', occasion: 'date' },
];

/** Occasions offered when adding a moment (all valid for the backend). */
export const MOMENT_OCCASIONS = ['work', 'casual', 'date', 'dinner', 'party', 'sport', 'formal', 'outdoor'] as const;

/** "09:00:00" → "09:00". */
export function shortTime(time: string | null | undefined): string | null {
  if (!time) return null;
  const m = /^(\d{2}):(\d{2})/.exec(time);
  return m ? `${m[1]}:${m[2]}` : null;
}

function minutes(time: string | null): number | null {
  const s = shortTime(time);
  if (!s) return null;
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

/**
 * The preset to propose for the next moment: the first one later than the
 * latest moment's time (morning → afternoon → evening), else the evening.
 */
export function nextPreset(moments: Pick<DayMoment, 'time'>[]): MomentPreset {
  if (moments.length === 0) return MOMENT_PRESETS[0];
  const latest = Math.max(-1, ...moments.map((m) => minutes(m.time) ?? -1));
  if (latest < 0) return MOMENT_PRESETS[Math.min(moments.length, MOMENT_PRESETS.length - 1)];
  return MOMENT_PRESETS.find((p) => (minutes(p.time) ?? 0) > latest) ?? MOMENT_PRESETS[MOMENT_PRESETS.length - 1];
}

/** The closest earlier moment that has a look: what a transition would start from. */
export function transitionSource(moments: DayMoment[], order?: number): DayMoment | null {
  const limit = order ?? Number.POSITIVE_INFINITY;
  const earlier = moments.filter((m) => m.order < limit && m.outfit);
  return earlier.length ? earlier[earlier.length - 1] : null;
}

/** For a transition look: how many pieces stay and how many change vs the previous moment. */
export function transitionSummary(moment: DayMoment): { kept: number; changed: number } | null {
  if (!moment.outfit || moment.shared_item_ids.length === 0) return null;
  const kept = moment.shared_item_ids.length;
  return { kept, changed: Math.max(0, moment.outfit.items.length - kept) };
}
