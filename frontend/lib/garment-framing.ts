/**
 * How big a garment should look in its tile.
 *
 * Cut-outs are already cropped to the garment and centred: the server trims the
 * transparent border off with a small consistent margin, so a coat photographed
 * off-centre still arrives as a coat filling its own frame, and `object-contain`
 * centres it. What was still wrong is *proportion*. Every garment was drawn to fill
 * its tile, so a hat came out the size of a coat and a wardrobe grid read like a
 * set of unrelated pictures rather than a wardrobe.
 *
 * So: scale by role. A hat is worth about a third of the frame, a coat nearly all
 * of it, and everything else sits between. This is presentation only — a CSS
 * transform on the way to the screen — so the stored photo, the user's own crop and
 * the untouched original are all untouched, and the numbers can be retuned without
 * re-rendering a single file.
 *
 * Only cut-outs get this. A legacy white-background photo has no idea where the
 * garment is inside it, so shrinking it would shrink a white rectangle and make
 * things worse; those keep exactly today's behaviour.
 */

import { ITEM_ROLE } from '@/lib/studio/canonical-order';

export type GarmentRole =
  | 'full_body'
  | 'base_top'
  | 'mid_layer'
  | 'outer_layer'
  | 'bottom'
  | 'footwear'
  | 'socks'
  | 'neckwear'
  | 'accessory'
  | 'headwear';

/**
 * Types the shared role map does not place. It is the backend's body-slot map, so
 * it is about what a garment covers rather than about how big it looks, and a hat
 * and a bag are both "accessory" there while they are nothing like each other here.
 */
const FRAMING_ROLE: Record<string, GarmentRole> = {
  hat: 'headwear',
  scarf: 'neckwear',
  belt: 'accessory',
  bag: 'accessory',
  tie: 'neckwear',
  socks: 'socks',
};

export function garmentFramingRole(type?: string | null): GarmentRole {
  const key = (type || '').toLowerCase();
  const override = FRAMING_ROLE[key];
  if (override) return override;
  return (ITEM_ROLE[key] as GarmentRole) ?? 'accessory';
}

/**
 * How much of the tile's shorter side a role's garment should occupy.
 *
 * Tuned against real photos rather than from theory: a coat and a dress are the
 * tallest things in a wardrobe and set the ceiling; trousers are nearly as long; a
 * top is shorter than both; shoes, a bag and a belt are small objects and look
 * wrong blown up to the same height; a hat is the smallest thing anyone owns. The
 * ratios are deliberately gentle — this is meant to read as "these were photographed
 * by the same person", not as a scale model.
 */
export const ROLE_FRAME_SHARE: Record<GarmentRole, number> = {
  full_body: 1,
  outer_layer: 1,
  bottom: 0.94,
  mid_layer: 0.9,
  base_top: 0.84,
  footwear: 0.66,
  neckwear: 0.62,
  accessory: 0.6,
  socks: 0.54,
  headwear: 0.46,
};

/**
 * The scale to draw a garment at, or 1 when we should not touch it.
 *
 * `hasCutout` is the whole condition: without transparency we do not know where the
 * garment is in the picture, and nothing should look worse than it does today.
 */
export function garmentFrameScale(
  type: string | null | undefined,
  hasCutout: boolean | undefined
): number {
  if (!hasCutout) return 1;
  return ROLE_FRAME_SHARE[garmentFramingRole(type)] ?? 1;
}

/**
 * A style object for the garment image, or undefined when there is nothing to do.
 *
 * Combines with the quarter turns an optimistic rotation is showing, because both
 * are transforms on the same element and the second one would otherwise silently
 * replace the first.
 */
export function garmentFrameStyle(
  type: string | null | undefined,
  hasCutout: boolean | undefined,
  quarterTurns = 0
): { transform: string } | undefined {
  const scale = garmentFrameScale(type, hasCutout);
  const turns = ((quarterTurns % 4) + 4) % 4;
  if (scale === 1 && turns === 0) return undefined;
  const parts: string[] = [];
  if (turns) parts.push(`rotate(${turns * 90}deg)`);
  if (scale !== 1) parts.push(`scale(${scale})`);
  return { transform: parts.join(' ') };
}
