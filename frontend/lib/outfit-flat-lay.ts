import { ITEM_ROLE, canonicalItemOrder } from '@/lib/studio/canonical-order';
import { clothingColorHex, hexToRgb, rgbToHex } from '@/lib/colors';

/**
 * Flat-lay layout maths: turn a look's garments into a composed arrangement —
 * top above the bottom, shoes below, accessories tucked beside — the way the
 * pieces would be laid out on a bed to be photographed.
 *
 * Everything here is pure and deterministic (same items in, same layout out,
 * whatever order they arrive in): no randomness, no drag, no measuring of the
 * DOM. `OutfitFlatLay` is the only renderer; this file is the brain.
 *
 * Coordinates are normalized against the frame: `x`/`y` are the piece's centre
 * (0..1, left→right and top→bottom) and `width` is a fraction of the frame's
 * width. Garment cut-outs are square, so a piece's height as a fraction of the
 * frame is `width * aspect`.
 */

export type FlatLayRole =
  | 'full_body'
  | 'outer_layer'
  | 'mid_layer'
  | 'base_top'
  | 'bottom'
  | 'footwear'
  | 'socks'
  | 'neckwear'
  | 'accessory';

/** Frame aspect (width / height). Portrait 4:5 — the shape a shared look wants. */
export const FLAT_LAY_ASPECT = 4 / 5;

/** More than this and the frame turns into a pile; the rest become a "+N". */
export const FLAT_LAY_MAX_PIECES = 6;

export interface FlatLayInput {
  id: string;
  type: string;
  name?: string | null;
  primary_color?: string | null;
  thumbnail_url?: string | null;
  image_url?: string | null;
  /**
   * True when the stored photo keeps its alpha. Missing is read as `false`, which
   * is the safe reading: every photo stored before background removal wrote WebP
   * with alpha has a white background baked in.
   */
  has_cutout?: boolean;
}

export interface FlatLayPiece<T extends FlatLayInput = FlatLayInput> {
  item: T;
  role: FlatLayRole;
  /** Centre of the piece, 0..1 of the frame. */
  x: number;
  y: number;
  /** Fraction of the frame's width. The piece is square. */
  width: number;
  /** Paint order; larger is nearer the viewer. */
  z: number;
}

export interface FlatLayResult<T extends FlatLayInput = FlatLayInput> {
  pieces: FlatLayPiece<T>[];
  /** Garments that did not fit in the frame (shown as "+N" by the renderer). */
  overflow: number;
}

/**
 * Types the shared role map does not cover (it is the backend's body-slot map,
 * which has no opinion on a "suit"). A suit covers the whole body, so it is
 * laid out like a dress; anything the tagger invents lands beside the look
 * rather than on top of it.
 */
const EXTRA_ROLE: Record<string, FlatLayRole> = {
  suit: 'full_body',
};

export function flatLayRole(type: string | null | undefined): FlatLayRole {
  const key = (type ?? '').trim().toLowerCase();
  const role = ITEM_ROLE[key] ?? EXTRA_ROLE[key];
  return (role as FlatLayRole) ?? 'accessory';
}

/**
 * Where each role sits across the frame, and how big it is. The jacket lies
 * open on the left, the top on it and to the right, the bottom centred below,
 * shoes to one side at the foot. `x` and `width` are fractions of the frame's
 * width; the vertical position is packed, not fixed (see `BAND`).
 */
const BASE_SLOTS: Record<FlatLayRole, { x: number; width: number }> = {
  outer_layer: { x: 0.31, width: 0.56 },
  full_body: { x: 0.46, width: 0.56 },
  mid_layer: { x: 0.35, width: 0.5 },
  base_top: { x: 0.57, width: 0.46 },
  bottom: { x: 0.44, width: 0.5 },
  socks: { x: 0.64, width: 0.22 },
  footwear: { x: 0.33, width: 0.34 },
  neckwear: { x: 0.5, width: 0.22 },
  accessory: { x: 0.8, width: 0.28 },
};

/**
 * The garments stack down the frame in bands — neck, torso, legs, feet — and
 * only the bands a look actually has take up room. This is what keeps a
 * two-piece look from leaving a hole where the trousers would have been: the
 * boots move up under the dress instead of waiting at the bottom of the frame.
 * Accessories sit beside the stack rather than in it.
 */
const BAND: Record<FlatLayRole, number> = {
  neckwear: 0,
  full_body: 1,
  outer_layer: 1,
  mid_layer: 1,
  base_top: 1,
  bottom: 2,
  socks: 3,
  footwear: 3,
  accessory: -1,
};

/** Within a band: the jacket sits a touch lower than the top laid on it. */
const BAND_NUDGE: Record<FlatLayRole, number> = {
  outer_layer: 0.06,
  mid_layer: 0.03,
  base_top: -0.06,
  full_body: 0,
  bottom: 0,
  footwear: 0,
  socks: -0.02,
  neckwear: 0,
  accessory: 0,
};

/** Bands overlap slightly, so a hem covers a waistband instead of hovering. */
const BAND_OVERLAP = 0.2;

/**
 * Paint order. The outer layer is the thing lying flat underneath; the top sits
 * on it; the bottom's waistband tucks under the top's hem; small things last.
 */
const ROLE_Z: Record<FlatLayRole, number> = {
  outer_layer: 1,
  full_body: 2,
  bottom: 3,
  mid_layer: 4,
  base_top: 5,
  socks: 6,
  footwear: 7,
  neckwear: 8,
  accessory: 9,
};

/**
 * Accessories are tucked around the look, never on it, in a fixed sequence.
 * `at` is how far down the garments' own stack the piece sits (0 = its top,
 * 1 = its bottom), so a bag hangs beside the trousers whatever the look is.
 */
const ACCESSORY_SLOTS: ReadonlyArray<{ x: number; at: number; width: number }> = [
  { x: 0.81, at: 0.42, width: 0.26 },
  { x: 0.82, at: 0.76, width: 0.22 },
  { x: 0.14, at: 0.72, width: 0.22 },
  { x: 0.15, at: 0.16, width: 0.22 },
  { x: 0.63, at: 0.06, width: 0.2 },
  { x: 0.5, at: 1.02, width: 0.18 },
];

/** Two jumpers in one look: nudge the second so it reads as two garments. */
const DUPLICATE_OFFSETS: ReadonlyArray<{ dx: number; dy: number; dw: number }> = [
  { dx: 0, dy: 0, dw: 0 },
  { dx: 0.15, dy: -0.04, dw: -0.06 },
  { dx: -0.16, dy: 0.04, dw: -0.06 },
  { dx: 0.09, dy: 0.08, dw: -0.1 },
];

export interface FitOptions {
  aspect?: number;
  /** Empty band kept around the composition, as a fraction of the frame. */
  margin?: number;
  minScale?: number;
  maxScale?: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Round to 4 decimals so two identical layouts compare equal, and CSS stays short. */
function round(v: number): number {
  return Math.round(v * 1e4) / 1e4;
}

/**
 * Scale and centre the arrangement so it fills the frame whatever roles are
 * present. This is what makes a two-piece look read as a composition rather
 * than two small thumbnails stranded in a corner: the same slot table is used,
 * then the bounding box of whatever was actually placed is fitted to the frame.
 */
export function fitToFrame<T extends FlatLayInput>(
  pieces: FlatLayPiece<T>[],
  options: FitOptions = {}
): FlatLayPiece<T>[] {
  const aspect = options.aspect ?? FLAT_LAY_ASPECT;
  const margin = options.margin ?? 0.035;
  const minScale = options.minScale ?? 0.6;
  const maxScale = options.maxScale ?? 1.55;
  if (pieces.length === 0) return [];

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pieces) {
    const halfW = p.width / 2;
    const halfH = (p.width * aspect) / 2;
    minX = Math.min(minX, p.x - halfW);
    maxX = Math.max(maxX, p.x + halfW);
    minY = Math.min(minY, p.y - halfH);
    maxY = Math.max(maxY, p.y + halfH);
  }
  const boxW = Math.max(maxX - minX, 1e-6);
  const boxH = Math.max(maxY - minY, 1e-6);
  const available = 1 - 2 * margin;
  // Both axes are scaled by the same factor, which is uniform in pixels too
  // (x is a fraction of the width, y of the height), so nothing is squashed.
  const scale = clamp(Math.min(available / boxW, available / boxH), minScale, maxScale);
  const centreX = (minX + maxX) / 2;
  const centreY = (minY + maxY) / 2;

  return pieces.map((p) => ({
    ...p,
    x: round(0.5 + (p.x - centreX) * scale),
    y: round(0.5 + (p.y - centreY) * scale),
    width: round(p.width * scale),
  }));
}

export interface BuildFlatLayOptions extends FitOptions {
  max?: number;
}

/**
 * The layout for a look. Items may arrive in any order and with any mix of
 * roles; the result is canonical (tops before bottoms before shoes, which is
 * also the reading and tab order) and stable.
 */
export function buildFlatLay<T extends FlatLayInput>(
  items: readonly T[] | null | undefined,
  options: BuildFlatLayOptions = {}
): FlatLayResult<T> {
  const max = options.max ?? FLAT_LAY_MAX_PIECES;
  const usable = (items ?? []).filter((item): item is T => Boolean(item && item.id));
  if (usable.length === 0) return { pieces: [], overflow: 0 };

  const aspect = options.aspect ?? FLAT_LAY_ASPECT;
  const ordered = canonicalItemOrder(usable as T[]);
  const shown = ordered.slice(0, Math.max(0, max));
  const roleCounts = new Map<FlatLayRole, number>();

  // A dress worn over trousers is a layered look, not one piece hiding the
  // other. The bottom keeps its own band below, and the dress is painted in
  // front of it so its hem covers the waistband instead of the other way
  // round. Paint order only, and only for a look that really has both.
  const shownRoles = shown.map((item) => flatLayRole(item.type));
  const layeredOverBottom = shownRoles.includes('full_body') && shownRoles.includes('bottom');
  const zOf = (role: FlatLayRole): number =>
    layeredOverBottom && role === 'full_body' ? ROLE_Z.bottom + 0.5 : ROLE_Z[role];

  // 1. Across the frame: each garment's column and size come from its role.
  const sized = shown.map((item) => {
    const role = flatLayRole(item.type);
    const seen = roleCounts.get(role) ?? 0;
    roleCounts.set(role, seen + 1);
    const base = BASE_SLOTS[role];
    const nudge = DUPLICATE_OFFSETS[Math.min(seen, DUPLICATE_OFFSETS.length - 1)];
    const slot = role === 'accessory' ? ACCESSORY_SLOTS[seen % ACCESSORY_SLOTS.length] : null;
    return {
      item,
      role,
      seen,
      x: (slot ? slot.x : base.x) + (slot ? 0 : nudge.dx),
      width: Math.max(0.12, (slot ? slot.width : base.width) + (slot ? 0 : nudge.dw)),
      dy: slot ? 0 : nudge.dy,
      at: slot ? slot.at : 0,
      z: zOf(role) * 10 + seen,
    };
  });

  // 2. Down the frame: stack only the bands this look actually has.
  const garments = sized.filter((p) => BAND[p.role] >= 0);
  const bands = Array.from(new Set(garments.map((p) => BAND[p.role]))).sort((a, b) => a - b);
  const centres = new Map<number, number>();
  const heights = new Map<number, number>();
  let cursor = 0;
  let previousHeight = 0;
  for (const band of bands) {
    const height = Math.max(
      ...garments.filter((p) => BAND[p.role] === band).map((p) => p.width * aspect)
    );
    if (previousHeight > 0) cursor -= BAND_OVERLAP * Math.min(height, previousHeight);
    centres.set(band, cursor + height / 2);
    heights.set(band, height);
    cursor += height;
    previousHeight = height;
  }
  const stackTop = garments.length > 0 ? centres.get(bands[0])! - heights.get(bands[0])! / 2 : 0;
  const stackHeight = Math.max(cursor - stackTop, 1e-6);

  const placed: FlatLayPiece<T>[] = sized.map((p) => {
    const band = BAND[p.role];
    // An accessory hangs beside the garments, at a fixed depth down the stack.
    const y =
      band < 0
        ? stackTop + p.at * stackHeight
        : centres.get(band)! + p.dy + BAND_NUDGE[p.role] * heights.get(band)!;
    return { item: p.item, role: p.role, x: p.x, y, width: p.width, z: p.z };
  });

  return {
    pieces: fitToFrame(placed, options),
    overflow: Math.max(0, ordered.length - shown.length),
  };
}

/**
 * How much of the frame a role is worth when deciding the look's colour: the
 * coat and the trousers set the mood, the belt does not.
 */
const COLOR_WEIGHT: Record<FlatLayRole, number> = {
  full_body: 3,
  outer_layer: 3,
  base_top: 2.5,
  bottom: 2.5,
  mid_layer: 2,
  footwear: 1,
  socks: 0.5,
  neckwear: 0.5,
  accessory: 0.5,
};

/**
 * The look's dominant garment colour as a tag value ("navy"), or null when no
 * garment has been tagged with one. Ties go to whichever colour appears first
 * in canonical order, so the answer never depends on the API's ordering.
 */
export function dominantGarmentColor<T extends FlatLayInput>(
  items: readonly T[] | null | undefined
): string | null {
  const usable = (items ?? []).filter((item): item is T => Boolean(item && item.id));
  if (usable.length === 0) return null;
  const ordered = canonicalItemOrder(usable as T[]);
  const scores = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  ordered.forEach((item, index) => {
    const color = item.primary_color?.trim().toLowerCase();
    if (!color) return;
    const weight = COLOR_WEIGHT[flatLayRole(item.type)] ?? 0.5;
    scores.set(color, (scores.get(color) ?? 0) + weight);
    if (!firstSeen.has(color)) firstSeen.set(color, index);
  });
  let best: string | null = null;
  let bestScore = -Infinity;
  for (const [color, score] of Array.from(scores.entries())) {
    const bestIndex = best === null ? Infinity : (firstSeen.get(best) ?? Infinity);
    const index = firstSeen.get(color) ?? Infinity;
    if (score > bestScore || (score === bestScore && index < bestIndex)) {
      best = color;
      bestScore = score;
    }
  }
  return best;
}

export interface FlatLayTint {
  light: string;
  dark: string;
}

/** Surfaces the tint is mixed into, so the frame still reads as a panel. */
const TINT_BASE_LIGHT = '#F4F4F2';
const TINT_BASE_DARK = '#242424';
const TINT_STRENGTH_LIGHT = 0.16;
const TINT_STRENGTH_DARK = 0.2;

function mix(hex: string, base: string, amount: number): string {
  const a = hexToRgb(hex);
  const b = hexToRgb(base);
  return rgbToHex({
    r: b.r + (a.r - b.r) * amount,
    g: b.g + (a.g - b.g) * amount,
    b: b.b + (a.b - b.b) * amount,
  });
}

/**
 * A soft tinted background derived from a named garment colour — a hint of the
 * look's own colour, never a colour field. Returns null for colours outside the
 * palette so the caller can fall back to the plain panel.
 */
export function flatLayTint(color: string | null | undefined): FlatLayTint | null {
  const hex = color ? clothingColorHex(color.trim().toLowerCase()) : undefined;
  if (!hex) return null;
  try {
    return {
      light: mix(hex, TINT_BASE_LIGHT, TINT_STRENGTH_LIGHT),
      dark: mix(hex, TINT_BASE_DARK, TINT_STRENGTH_DARK),
    };
  } catch {
    return null;
  }
}

/** The tint for a whole look, in one call. */
export function flatLayTintFor<T extends FlatLayInput>(
  items: readonly T[] | null | undefined
): FlatLayTint | null {
  return flatLayTint(dominantGarmentColor(items));
}
