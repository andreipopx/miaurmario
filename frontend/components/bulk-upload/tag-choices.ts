/**
 * The shortlists the quick pass offers as one-tap buttons.
 *
 * A full 31-type select is a fine editor and a terrible stepper: the point of the
 * pass is that a whole batch goes by in a couple of taps each, so the common
 * garments and the common colours are on screen and everything else is one extra
 * tap away in the full list.
 */

import { CLOTHING_COLORS, CLOTHING_TYPES } from '@/lib/types';

export const QUICK_TYPES = [
  't-shirt',
  'shirt',
  'sweater',
  'hoodie',
  'jacket',
  'coat',
  'jeans',
  'pants',
  'shorts',
  'skirt',
  'dress',
  'sneakers',
] as const;

export const QUICK_COLORS = [
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

/** Add or remove a style, keeping at most MAX_STYLES and dropping the oldest. */
export function toggleStyle(current: readonly string[] | null | undefined, style: string): string[] {
  const styles = current ?? [];
  if (styles.includes(style)) return styles.filter((s) => s !== style);
  return [...styles, style].slice(-MAX_STYLES);
}

/** Every type, with the shortlist first, for the "more types" select. */
export const OTHER_TYPES = CLOTHING_TYPES.map((type) => type.value).filter(
  (value) => !(QUICK_TYPES as readonly string[]).includes(value)
);

export const OTHER_COLORS = CLOTHING_COLORS.map((color) => color.value).filter(
  (value) => !(QUICK_COLORS as readonly string[]).includes(value)
);

/** An item the stylist cannot use yet: no type, or the tagger's placeholder. */
export function needsType(type: string | null | undefined): boolean {
  return !type || type === 'unknown';
}
