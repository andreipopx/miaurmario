/**
 * First-run guidance: the welcome tour and one-time tips per area.
 *
 * What the user has already seen lives server-side in `users.seen_tips` (so it
 * follows them across devices), mirrored in localStorage so a failed request
 * never makes a tip come back on this device. Everything here is pure and
 * unit-tested; the React side is lib/hooks/use-seen-tips.ts.
 */

import { resolveNav } from '@/components/nav-items';

export const TOUR_KEY = 'tour';

/** «Tu estilo con Stinky»: the swipe deck, offered once right after the tour. */
export const STYLE_QUIZ_KEY = 'style-quiz';

/** Areas with a one-time tip, keyed by nav section key (nav-items.ts). Hoy has the tour instead. */
export const AREA_TIPS = {
  wardrobe: 'tip.wardrobe',
  stylist: 'tip.stylist',
  inspo: 'tip.inspo',
  stinky: 'tip.stinky',
  settings: 'tip.settings',
} as const;

export type TipArea = keyof typeof AREA_TIPS;
export type TipKey = (typeof AREA_TIPS)[TipArea];

export const ALL_TIP_KEYS: readonly TipKey[] = Object.values(AREA_TIPS);

/**
 * Ready items the suggestion engine needs before it can propose a look: the
 * recommendation service and the day-moments composer both raise
 * InsufficientWardrobeError below 2 candidates (a top + a bottom, or a dress +
 * shoes). Keep in sync with backend/app/services/recommendation_service.py.
 */
export const MIN_ITEMS_FOR_LOOKS = 2;

/** Minimal user shape the rules need (UserProfile from /users/me). */
export interface FirstRunUser {
  onboarding_completed: boolean;
  username?: string | null;
  /** Undefined when the backend predates the field: then we show nothing. */
  seen_tips?: string[] | null;
}

/** Server keys ∪ keys this device already marked (maybe not synced yet). */
export function mergeSeen(server: readonly string[] | null | undefined, local: readonly string[]): string[] {
  const out = [...(server ?? [])];
  for (const k of local) if (!out.includes(k)) out.push(k);
  return out;
}

/** Keys seen on this device that the server does not know about yet (failed PATCH). */
export function unsyncedKeys(server: readonly string[] | null | undefined, local: readonly string[]): string[] {
  const s = new Set(server ?? []);
  return local.filter((k) => !s.has(k));
}

/** The welcome tour opens by itself once: after onboarding (username chosen), or on an existing user's next visit. */
export function shouldAutoOpenTour(user: FirstRunUser | null | undefined, local: readonly string[] = []): boolean {
  if (!user || !user.onboarding_completed || !user.username) return false;
  if (!Array.isArray(user.seen_tips)) return false;
  return !mergeSeen(user.seen_tips, local).includes(TOUR_KEY);
}

/**
 * The style quiz follows the tour, never interrupts it, and only asks once:
 * afterwards it lives in Ajustes → Tu estilo. Like the tour it needs the user
 * to be past onboarding, and it waits for the tour to be dealt with first so
 * two dialogs never fight over the screen.
 */
export function shouldAutoOpenStyleQuiz(user: FirstRunUser | null | undefined, local: readonly string[] = []): boolean {
  if (!user || !user.onboarding_completed || !user.username) return false;
  if (!Array.isArray(user.seen_tips)) return false;
  const seen = mergeSeen(user.seen_tips, local);
  return seen.includes(TOUR_KEY) && !seen.includes(STYLE_QUIZ_KEY);
}

/** Which area tip belongs to this path, if any (sub-pages share their section's tip). */
export function tipKeyForPath(pathname: string | null | undefined): TipKey | null {
  const section = resolveNav(pathname)?.section.key;
  if (!section || !(section in AREA_TIPS)) return null;
  return AREA_TIPS[section as TipArea];
}

/**
 * The area tip shows until dismissed, but never before the tour has been dealt
 * with (the tour comes first) and never after "Saltar todo".
 */
export function shouldShowTip(
  user: FirstRunUser | null | undefined,
  key: TipKey | null,
  local: readonly string[] = []
): boolean {
  if (!key || !user || !user.onboarding_completed || !Array.isArray(user.seen_tips)) return false;
  const seen = mergeSeen(user.seen_tips, local);
  return seen.includes(TOUR_KEY) && !seen.includes(key);
}

/** "Saltar todo" in the tour: the tour, the style quiz and every area tip. */
export function skipAllKeys(): string[] {
  return [TOUR_KEY, STYLE_QUIZ_KEY, ...ALL_TIP_KEYS];
}

export type FirstStepsStage = 'empty' | 'progress' | 'ready';

/** Hoy: big "sube tu primera prenda" card, progress towards the minimum, or the normal look UI. */
export function firstStepsStage(itemCount: number): FirstStepsStage {
  if (itemCount <= 0) return 'empty';
  if (itemCount < MIN_ITEMS_FOR_LOOKS) return 'progress';
  return 'ready';
}
