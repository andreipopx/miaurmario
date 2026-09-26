/**
 * The shortlists the quick pass offers as one-tap buttons.
 *
 * A full 31-type select is a fine editor and a terrible stepper: the point of the
 * pass is that a whole batch goes by in a couple of taps each, so the common
 * garments and the common colours are on screen and everything else is one extra
 * tap away in the full list.
 *
 * Which garments are "common" is not ours to decide. A hardcoded shortlist hid
 * `top` — the single type this wardrobe's owner reaches for most — behind the
 * "más tipos" select, which is exactly the tap the pass exists to avoid. So the
 * buttons are built from what the owner actually wears (`GET /items/types`,
 * `GET /items/colors`), padded out of the defaults below for anyone whose
 * wardrobe is too new to have an opinion yet.
 */

import { CLOTHING_COLORS, CLOTHING_TYPES } from '@/lib/types';

/** How many one-tap buttons a row offers, whoever the owner is. */
export const QUICK_CHOICE_COUNT = 12;

/**
 * The shortlist for a wardrobe that has not told us anything yet, and the padding
 * for one that has told us a little. `top` is in it: a shortlist that cannot
 * offer a top is the bug this list exists to prevent.
 */
export const DEFAULT_QUICK_TYPES = [
  'top',
  't-shirt',
  'shirt',
  'sweater',
  'hoodie',
  'jacket',
  'coat',
  'jeans',
  'pants',
  'skirt',
  'dress',
  'sneakers',
] as const;

export const DEFAULT_QUICK_COLORS = [
  'black',
  'white',
  'gray',
  'navy',
  'blue',
  'beige',
  'brown',
  'green',
  'red',
  'pink',
  'cream',
  'olive',
] as const;

/** Every value the tagger and the scorer know, in vocabulary order. */
export const ALL_TYPES: readonly string[] = CLOTHING_TYPES.map((type) => type.value);
export const ALL_COLORS: readonly string[] = CLOTHING_COLORS.map((color) => color.value);

/** One row of `GET /items/types`. */
export interface TypeUsage {
  type: string;
  count: number;
}

/** One row of `GET /items/colors`. */
export interface ColorUsage {
  color: string;
  count: number;
}

/**
 * The shortlist for one row: what the owner uses most first, then the defaults.
 *
 * - `used` arrives count-descending from the API; we sort again anyway, stably,
 *   so the order is a function of the data and not of the server's mood.
 * - Anything outside `vocabulary` is dropped. `tags` is a free-form column and
 *   `type` is only `String(50)`: a legacy row, a hand-written import or a model
 *   that invented a word must never put a button on screen that writes a value
 *   the scorer has never heard of.
 * - The result is always exactly `count` long (assuming the vocabulary is that
 *   big) so the row's height — and therefore everything under it — does not
 *   depend on how full the wardrobe is.
 */
export function quickChoicesFor(
  used: readonly string[] | null | undefined,
  defaults: readonly string[],
  vocabulary: readonly string[],
  count: number = QUICK_CHOICE_COUNT
): string[] {
  const known = new Set(vocabulary);
  const chosen: string[] = [];
  const take = (value: unknown) => {
    if (typeof value !== 'string') return;
    const slug = value.trim().toLowerCase();
    if (!known.has(slug) || chosen.includes(slug)) return;
    chosen.push(slug);
  };

  (used ?? []).forEach(take);
  defaults.forEach(take);
  // A default list shorter than `count` still gets a full row rather than a
  // ragged one; in practice the defaults are already `count` long.
  vocabulary.forEach(take);

  return chosen.slice(0, count);
}

/** Usage rows, most-used first, with the tagger's "no idea" placeholder dropped. */
function byUsage<T>(rows: readonly T[] | null | undefined, name: (row: T) => unknown): string[] {
  return (rows ?? [])
    .map((row, index) => ({ row, index }))
    .sort((a, b) => countOf(b.row) - countOf(a.row) || a.index - b.index)
    .map(({ row }) => name(row))
    .filter((value): value is string => typeof value === 'string' && !needsType(value));
}

function countOf(row: unknown): number {
  const count = (row as { count?: unknown } | null)?.count;
  return typeof count === 'number' && Number.isFinite(count) ? count : 0;
}

/**
 * The type buttons for one owner. Pass `undefined` while the usage call is in
 * flight, or for a wardrobe with nothing in it: both get the defaults.
 */
export function quickTypesFor(
  usage?: readonly TypeUsage[] | null,
  defaults: readonly string[] = DEFAULT_QUICK_TYPES,
  count: number = QUICK_CHOICE_COUNT
): string[] {
  return quickChoicesFor(
    byUsage(usage, (row) => row?.type),
    defaults,
    ALL_TYPES,
    count
  );
}

/** The colour swatches for one owner. Same contract as `quickTypesFor`. */
export function quickColorsFor(
  usage?: readonly ColorUsage[] | null,
  defaults: readonly string[] = DEFAULT_QUICK_COLORS,
  count: number = QUICK_CHOICE_COUNT
): string[] {
  return quickChoicesFor(
    byUsage(usage, (row) => row?.color),
    defaults,
    ALL_COLORS,
    count
  );
}

/**
 * Style and formality, the two tags that turn "a shirt" into "a shirt for the
 * office". Both vocabularies are the tagger's (backend prompts/clothing_analysis)
 * so a hand-tagged garment scores exactly like an AI-tagged one.
 */
export const QUICK_STYLES = [
  'casual',
  'classic',
  'sporty',
  'minimalist',
  'elegant',
  'streetwear',
  'vintage',
  'preppy',
  'bohemian',
  'athletic',
  'modern',
  'rugged',
] as const;

export const FORMALITY_LEVELS = [
  'very-casual',
  'casual',
  'smart-casual',
  'business-casual',
  'formal',
] as const;

export const SEASONS = ['spring', 'summer', 'fall', 'winter', 'all-season'] as const;

/** The tagger picks one or two styles; so does the user. */
export const MAX_STYLES = 2;

/**
 * A tag list, whatever shape it arrived in.
 *
 * `tags` is a free-form JSON column: the tagger is asked for `"style": ["…"]`
 * but a model that answers with a bare string, or an older row written before
 * the vocabulary settled, both turn up here. Reading them as a list rather than
 * trusting the type keeps one odd garment from taking a screen down with it.
 */
export function asTagList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string');
  if (typeof value === 'string' && value) return [value];
  return [];
}

/** Add or remove a style, keeping at most MAX_STYLES and dropping the oldest. */
export function toggleStyle(current: readonly string[] | null | undefined, style: string): string[] {
  const styles = current ?? [];
  if (styles.includes(style)) return styles.filter((s) => s !== style);
  return [...styles, style].slice(-MAX_STYLES);
}

/** An item the stylist cannot use yet: no type, or the tagger's placeholder. */
export function needsType(type: string | null | undefined): boolean {
  return !type || type === 'unknown';
}
