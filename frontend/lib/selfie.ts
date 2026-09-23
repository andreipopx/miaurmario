/**
 * "Qué llevo puesto": types and the pure state logic of the result screen.
 *
 * The backend returns one entry per garment it saw in the photo, each with the
 * wardrobe item it looks like (or none) plus a few alternatives. From there the
 * user corrects picks and chooses what goes into the look, so the picks live
 * here as plain data — easy to test without React.
 */

export interface SelfieItemSummary {
  id: string;
  name: string | null;
  type: string;
  subtype: string | null;
  primary_color: string | null;
  colors: string[];
  pattern: string | null;
  thumbnail_url: string | null;
  image_url: string | null;
}

export interface SelfieGarment {
  index: number;
  type: string;
  subtype: string | null;
  primary_color: string | null;
  colors: string[];
  pattern: string | null;
  material: string | null;
  match: SelfieItemSummary | null;
  alternatives: SelfieItemSummary[];
}

export interface SelfieAnalysis {
  garments: SelfieGarment[];
  matched_count: number;
  /** Always false: the photo is analysed and dropped, never stored. */
  photo_stored: boolean;
}

export interface SelfieItemPayload {
  type: string;
  subtype?: string | null;
  primary_color?: string | null;
  colors?: string[];
  pattern?: string | null;
  material?: string | null;
  name?: string | null;
}

/** garment index -> the wardrobe item it is (null = "not this one" / nothing yet). */
export type SelfiePicks = Record<number, string | null>;

/** What the server proposed, before the user corrects anything. */
export function initialPicks(garments: SelfieGarment[]): SelfiePicks {
  const picks: SelfiePicks = {};
  for (const g of garments) picks[g.index] = g.match?.id ?? null;
  return picks;
}

/**
 * Point one garment at one wardrobe item. The same item can only be worn once,
 * so choosing it here clears it from any other garment. Picking the item that
 * is already there clears it (tap again = "no es esta").
 */
export function setPick(picks: SelfiePicks, index: number, itemId: string | null): SelfiePicks {
  const next: SelfiePicks = { ...picks };
  if (itemId && next[index] === itemId) {
    next[index] = null;
    return next;
  }
  if (itemId) {
    for (const key of Object.keys(next)) {
      const i = Number(key);
      if (i !== index && next[i] === itemId) next[i] = null;
    }
  }
  next[index] = itemId;
  return next;
}

/** Every item the user kept, in garment order, without repeats. */
export function chosenItemIds(garments: SelfieGarment[], picks: SelfiePicks): string[] {
  const ids: string[] = [];
  for (const g of garments) {
    const id = picks[g.index];
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Garments that point at nothing: candidates for "añadir al armario". */
export function unmatchedGarments(garments: SelfieGarment[], picks: SelfiePicks): SelfieGarment[] {
  return garments.filter((g) => !picks[g.index]);
}

/**
 * Every wardrobe item mentioned anywhere in the answer, by id, so the UI can
 * draw the card of a pick that came from an alternative or the item picker.
 */
export function itemsById(
  garments: SelfieGarment[],
  extra: SelfieItemSummary[] = []
): Map<string, SelfieItemSummary> {
  const map = new Map<string, SelfieItemSummary>();
  for (const g of garments) {
    if (g.match) map.set(g.match.id, g.match);
    for (const alt of g.alternatives) map.set(alt.id, alt);
  }
  for (const item of extra) map.set(item.id, item);
  return map;
}

/** Choices offered for one garment: its match first, then the alternatives. */
export function optionsFor(
  garment: SelfieGarment,
  picked: SelfieItemSummary | null
): SelfieItemSummary[] {
  const options: SelfieItemSummary[] = [];
  const push = (item: SelfieItemSummary | null | undefined) => {
    if (item && !options.some((o) => o.id === item.id)) options.push(item);
  };
  push(garment.match);
  push(picked);
  for (const alt of garment.alternatives) push(alt);
  return options;
}
