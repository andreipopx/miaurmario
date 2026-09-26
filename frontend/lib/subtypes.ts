/**
 * Subtypes: the more specific name inside a type — a `top` that is a halter, a
 * `skirt` that is plisada.
 *
 * ## Contract
 *
 * Slugs are English, lowercase, hyphenated, and they are **data**: the tagger
 * writes them, the item detail reads them, and they sit in a `String(50)` column
 * with no enum behind it. Never translate a slug; the Spanish lives in messages
 * `tagValues.subtypes` and is resolved by `useTagLabel('subtypes', …)`.
 *
 * ## Kept in sync with `backend/app/prompts/clothing_analysis.txt`
 *
 * That prompt's SUBTYPE section is the list the model is allowed to answer from.
 * This map is the list the user can tap. They must hold the same slugs, or the AI
 * writes values the picker cannot show and the picker writes values the AI would
 * never produce. **Change one, change the other.**
 *
 * ## Not exhaustive, and never enforced
 *
 * A type missing from this map (`jeans`, `hoodie`, `blazer`) is one the prompt
 * calls specific enough already: the picker then offers only the free-text
 * escape. And a stored subtype outside the map — an old free-text entry, a word
 * the model invented — is still shown as-is. The map decides which buttons
 * appear, never which values are legal.
 */

export const SUBTYPES: Readonly<Record<string, readonly string[]>> = {
  shirt: ['button-down', 'oxford', 'henley', 'flannel', 'hawaiian', 'camp-collar'],
  blouse: ['wrap', 'ruffled', 'peasant', 'sleeveless', 'long-sleeve'],
  // The row this workstream exists for: a top is a halter, a bandeau, a corset or
  // a crop long before it is a "wrap", which is what the model kept guessing.
  top: [
    'halter',
    'straps',
    'bandeau',
    'corset',
    'cropped',
    'long-sleeve',
    'sleeveless',
    'asymmetric',
    'wrap',
    'off-shoulder',
    'bodysuit',
    'camisole',
  ],
  pants: ['chinos', 'trousers', 'joggers', 'cargo', 'leggings', 'sweatpants'],
  dress: [
    'mini',
    'midi',
    'maxi',
    'sundress',
    'slip-dress',
    'wrap',
    'shirt-dress',
    'a-line',
    'bodycon',
    'halter',
    'straps',
    'sleeveless',
    'long-sleeve',
    'pleated',
    'knit-dress',
  ],
  skirt: [
    'mini',
    'midi',
    'maxi',
    'pleated',
    'wrap',
    'pencil',
    'a-line',
    'denim-skirt',
    'asymmetric',
    'tulle',
    'skort',
  ],
  jacket: ['denim-jacket', 'bomber', 'parka', 'windbreaker', 'trucker', 'anorak'],
  sweater: ['pullover', 'crewneck', 'turtleneck', 'v-neck'],
  shoes: ['loafers', 'oxfords', 'mules', 'flats', 'heels', 'platforms'],
  sneakers: ['low-top', 'high-top', 'chunky', 'slip-on'],
  boots: ['ankle', 'chelsea', 'combat', 'knee-high', 'rain'],
  socks: ['ankle', 'crew', 'knee-high', 'no-show', 'dress', 'athletic'],
  tie: ['necktie', 'bow-tie', 'bolo'],
};

/** Every slug any type offers, deduplicated — what the label catalogue must cover. */
export const ALL_SUBTYPES: readonly string[] = Array.from(
  new Set(Object.values(SUBTYPES).flat())
).sort();

/** The buttons to offer for one type. Empty for a type that needs no subtype. */
export function subtypesFor(type: string | null | undefined): readonly string[] {
  if (!type) return [];
  return SUBTYPES[type.trim().toLowerCase()] ?? [];
}

/** Is this one of the buttons, i.e. does it need the "otro" box to be editable? */
export function isKnownSubtype(
  type: string | null | undefined,
  subtype: string | null | undefined
): boolean {
  if (!subtype) return false;
  return subtypesFor(type).includes(subtype.trim().toLowerCase());
}

/**
 * The subtype to keep when the type changes.
 *
 * A halter is not a halter once the garment becomes a pair of jeans, and the
 * commonest way to get a nonsense pair is to fix a wrong type and leave the
 * subtype the model guessed under it. So: keep it when the new type offers it
 * (dress → skirt keeps `midi`, `pleated`, `wrap`), drop it otherwise. A free-text
 * subtype is dropped too — it was written about a garment of the old type, and
 * silently keeping it is how "jeans / halter" ends up in the wardrobe. The user
 * can always type it again into "otro", which is cheaper than not noticing.
 */
export function subtypeAfterTypeChange(
  nextType: string | null | undefined,
  subtype: string | null | undefined
): string | null {
  if (!subtype) return null;
  return isKnownSubtype(nextType, subtype) ? subtype : null;
}
