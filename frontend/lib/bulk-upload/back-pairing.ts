import type { Item } from '@/lib/types';

/**
 * Pairing fronts with backs in the quick pass after a batch.
 *
 * The rule the whole file is built on: **one photo is one garment, and nothing here
 * changes that on its own.** A front and a back shot of the same jumper look nothing
 * alike — that is the point of taking both — so no image comparison is going to spot
 * the pair, and the pHash duplicate check is not built for it either. The user is the
 * only one who knows.
 *
 * What this file does is narrower and honest: it holds the user's own "esta es la
 * espalda de aquella" answers until the pass is saved (so "deshacer" is free), and it
 * points at one pair per garment that is *worth asking about*. Asking is not deciding.
 */

/** A pending answer: this garment's photo belongs to that one, as that side. */
export interface BackPairing {
  targetId: string;
  view: 'back' | 'detail';
}

/** The whole batch's pending answers, keyed by the garment being folded in. */
export type BackPairings = Readonly<Record<string, BackPairing>>;

/**
 * The garments still shown in the grid: the ones nobody has handed to another yet.
 *
 * A garment that is about to become another's back photo has no business sitting in
 * the grid asking to be tagged — it is not going to exist. It comes straight back if
 * the answer is undone, because none of this has been sent yet.
 */
export function visibleInReview(
  items: readonly Item[],
  pairings: BackPairings
): readonly Item[] {
  return items.filter((item) => !pairings[item.id]);
}

/** Which garments have been promised a back, so the grid can say so on the tile. */
export function backsPromisedTo(pairings: BackPairings): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const pairing of Object.values(pairings)) {
    counts.set(pairing.targetId, (counts.get(pairing.targetId) ?? 0) + 1);
  }
  return counts;
}

/**
 * A garment cannot be handed to one that is itself being handed away, or the chain
 * would end nowhere. The keeper has to be a garment that is staying.
 */
export function mergeTargetsFor(
  items: readonly Item[],
  pairings: BackPairings,
  sourceId: string
): readonly Item[] {
  return items.filter((item) => item.id !== sourceId && !pairings[item.id]);
}

// -- the hint ------------------------------------------------------------------

/** How close in time two photos have to be for the question to be worth asking. */
export const SUGGEST_WINDOW_MS = 60_000;

/**
 * Colour families that read as the same colour on a garment. The tagger will call the
 * front of one navy jumper "navy" and its back "blue" often enough that insisting on
 * an exact match would throw away most of the real pairs.
 */
const COLOUR_FAMILY: Record<string, string> = {
  navy: 'blue',
  blue: 'blue',
  'light-blue': 'blue',
  denim: 'blue',
  black: 'dark',
  charcoal: 'dark',
  grey: 'grey',
  gray: 'grey',
  silver: 'grey',
  white: 'light',
  cream: 'light',
  beige: 'light',
  ivory: 'light',
  brown: 'brown',
  tan: 'brown',
  camel: 'brown',
  khaki: 'brown',
  red: 'red',
  burgundy: 'red',
  maroon: 'red',
  pink: 'pink',
  green: 'green',
  olive: 'green',
  yellow: 'yellow',
  mustard: 'yellow',
  orange: 'orange',
  purple: 'purple',
  lilac: 'purple',
};

function family(colour: string | null | undefined): string | null {
  const key = colour?.trim().toLowerCase();
  if (!key) return null;
  return COLOUR_FAMILY[key] ?? key;
}

/**
 * Which garment, if any, to quietly ask about: "¿es la espalda de la anterior?"
 *
 * Deliberately conservative, and deliberately a *question*. Three things have to line
 * up — the two photos were taken within about a minute of each other, the tagger gave
 * them the same type, and their colours are the same family — and even then nothing
 * happens until the user says sí. No model is asked; this is arithmetic on two
 * timestamps and two tags.
 *
 * `dismissed` is the answers that were "no". A no is remembered for that pair and
 * never asked again, because being asked the same question twice is worse than not
 * being asked at all.
 */
export function suggestedBackTarget(
  items: readonly Item[],
  index: number,
  dismissed: ReadonlySet<string>,
  pairings: BackPairings = {}
): Item | null {
  const item = items[index];
  const previous = items[index - 1];
  if (!item || !previous) return null;
  // Neither end of the pair may be one already spoken for.
  if (pairings[item.id] || pairings[previous.id]) return null;
  if (dismissed.has(pairKey(previous.id, item.id))) return null;
  // A garment that already has a back photo is not missing one.
  if (previous.back_image) return null;

  const gap = Math.abs(
    new Date(item.created_at).getTime() - new Date(previous.created_at).getTime()
  );
  if (!Number.isFinite(gap) || gap > SUGGEST_WINDOW_MS) return null;

  const type = item.type?.trim().toLowerCase();
  if (!type || type === 'unknown' || type !== previous.type?.trim().toLowerCase()) return null;

  const colour = family(item.primary_color);
  if (colour === null || colour !== family(previous.primary_color)) return null;

  return previous;
}

/** A stable key for "we already asked about these two", whichever way round. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
