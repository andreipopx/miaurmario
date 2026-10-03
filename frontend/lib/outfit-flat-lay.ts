import { ITEM_ROLE, canonicalItemOrder } from '@/lib/studio/canonical-order';
import { clothingColorHex, hexToRgb, rgbToHex } from '@/lib/colors';

/**
 * Flat-lay layout maths: turn a look's garments into a tidy board — the top
 * above the bottom, the coat, bag and shoes beside them, nothing overlapping —
 * the way a shop lays out a look to photograph it.
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
  /**
   * This garment seen from behind, or null/absent when nobody photographed its
   * back. What "ver por detrás" swaps to, and what decides whether that toggle is
   * offered at all.
   */
  back_image?: FlatLayPhoto | null;
}

/** One photo of a garment, with its own alpha flag: cut-outs are per photo. */
export interface FlatLayPhoto {
  image_url?: string | null;
  thumbnail_url?: string | null;
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
 * The board. Garments never overlap: each one gets its own cell, the way a look
 * is laid out to be photographed for a shop — tidy, every piece whole and
 * readable — instead of piled on each other.
 *
 * Two columns. The body (the top, or a dress, and the bottom) stacks down the
 * main column; everything that goes with it (the coat, a second top, the bag,
 * the scarf, the shoes) stacks down the side column, shoes at its foot. A look
 * with nothing on the side is centred and larger; a look with only the small
 * things (a bag and a hat) stacks them down the middle.
 */
const MAIN_ROLES: ReadonlySet<FlatLayRole> = new Set<FlatLayRole>(['full_body', 'base_top', 'mid_layer', 'bottom']);

/** How tall a cell is, in shares of the column: a coat is worth more than a belt. */
const CELL_WEIGHT: Record<FlatLayRole, number> = {
  full_body: 1.9,
  outer_layer: 1.1,
  mid_layer: 1,
  base_top: 1,
  bottom: 1.15,
  footwear: 0.62,
  socks: 0.42,
  neckwear: 0.5,
  accessory: 0.56,
};

/** Order down the side column: the coat at the top, the shoes at the foot. */
const SIDE_ORDER: Record<FlatLayRole, number> = {
  outer_layer: 0,
  mid_layer: 1,
  base_top: 1,
  full_body: 1,
  bottom: 1,
  neckwear: 2,
  accessory: 3,
  socks: 4,
  footwear: 5,
};

const BOARD_MARGIN = 0.045;
const BOARD_GAP = 0.03;
/** A garment fills this much of its cell: a little air between neighbours. */
const CELL_FILL = 0.94;

interface Cell<T extends FlatLayInput> {
  item: T;
  role: FlatLayRole;
  weight: number;
  z: number;
}

/**
 * Lay one column of cells into [top, bottom] at column centre `x`, width `width`
 * (fractions of the frame). Cell heights follow their weights with `unit` height
 * per weight; when the column is shorter than the frame, the slack goes between
 * the cells, and a lone piece sits at the foot if it is shoes, else in the middle.
 */
function layColumn<T extends FlatLayInput>(
  cells: Cell<T>[],
  x: number,
  width: number,
  unit: number,
  aspect: number
): FlatLayPiece<T>[] {
  if (cells.length === 0) return [];
  const top = BOARD_MARGIN;
  const available = 1 - 2 * BOARD_MARGIN;
  const heights = cells.map((c) => c.weight * unit);
  const used = heights.reduce((sum, h) => sum + h, 0) + BOARD_GAP * (cells.length - 1);
  const slack = Math.max(0, available - used);
  let cursor: number;
  let gap: number;
  if (cells.length === 1) {
    gap = 0;
    cursor = cells[0].role === 'footwear' ? top + slack : top + slack / 2;
  } else {
    gap = BOARD_GAP + slack / (cells.length - 1);
    cursor = top;
  }
  return cells.map((cell, i) => {
    const h = heights[i];
    // A square piece: as wide as the column allows, as tall as the cell allows.
    const side = Math.min(width, h / aspect) * CELL_FILL;
    const piece: FlatLayPiece<T> = {
      item: cell.item,
      role: cell.role,
      x: round(x),
      y: round(cursor + h / 2),
      width: round(side),
      z: cell.z,
    };
    cursor += h + gap;
    return piece;
  });
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

  // Which column: the first top (or the dress) and the first bottom make the body;
  // anything else, including a second top, goes beside it.
  let main: Cell<T>[] = [];
  let side: Cell<T>[] = [];
  let hasUpper = false;
  let hasBottom = false;
  shown.forEach((item, index) => {
    const role = flatLayRole(item.type);
    const cell: Cell<T> = { item, role, weight: CELL_WEIGHT[role], z: (index + 1) * 10 };
    const upper = role === 'full_body' || role === 'base_top' || role === 'mid_layer';
    if (MAIN_ROLES.has(role) && ((upper && !hasUpper) || (role === 'bottom' && !hasBottom))) {
      if (upper) hasUpper = true;
      else hasBottom = true;
      main.push(cell);
    } else {
      side.push(cell);
    }
  });
  // A coat with nothing under it is the body itself.
  if (main.length === 0 && side.some((c) => c.role === 'outer_layer')) {
    const coat = side.find((c) => c.role === 'outer_layer')!;
    main = [coat];
    side = side.filter((c) => c !== coat);
  }
  // Only small things: they are the look, down the middle.
  if (main.length === 0) {
    main = side;
    side = [];
  }
  main.sort((a, b) => (a.role === 'bottom' ? 1 : 0) - (b.role === 'bottom' ? 1 : 0));
  side.sort((a, b) => SIDE_ORDER[a.role] - SIDE_ORDER[b.role] || a.z - b.z);

  const available = 1 - 2 * BOARD_MARGIN;
  // One height per weight for both columns, so a coat beside a T-shirt is drawn
  // at the same scale as it: the taller column decides.
  const mainNeed = main.reduce((s, c) => s + c.weight, 0);
  const sideNeed = side.reduce((s, c) => s + c.weight, 0);
  const gaps = (n: number) => BOARD_GAP * Math.max(0, n - 1);
  const unit = Math.min(
    (available - gaps(main.length)) / Math.max(mainNeed, 1e-6),
    side.length ? (available - gaps(side.length)) / Math.max(sideNeed, 1e-6) : Infinity
  );

  let pieces: FlatLayPiece<T>[];
  if (side.length === 0) {
    pieces = layColumn(main, 0.5, 0.72, unit, aspect);
  } else {
    const mainWidth = 0.56;
    const sideWidth = 0.34;
    const mainX = BOARD_MARGIN + mainWidth / 2;
    const sideX = 1 - BOARD_MARGIN - sideWidth / 2;
    pieces = [
      ...layColumn(main, mainX, mainWidth, unit, aspect),
      ...layColumn(side, sideX, sideWidth, unit, aspect),
    ];
  }

  // Back in canonical order (also the reading and tab order).
  const rank = new Map(shown.map((item, index) => [item.id, index]));
  pieces.sort((a, b) => (rank.get(a.item.id) ?? 0) - (rank.get(b.item.id) ?? 0));

  return { pieces, overflow: Math.max(0, ordered.length - shown.length) };
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

// -- seeing the look from behind ---------------------------------------------

/** A usable back photo, or null: a `back_image` with no URL in it is not one. */
export function backPhotoOf(item: FlatLayInput | null | undefined): FlatLayPhoto | null {
  const back = item?.back_image;
  if (!back) return null;
  return back.thumbnail_url || back.image_url ? back : null;
}

/**
 * Whether "ver por detrás" is worth offering at all.
 *
 * One garment with a back photo is enough — the point of the toggle is to see the
 * backs you *have*, and the ones you have not are what it fades. A look where
 * nobody photographed a back never shows the control: an inert toggle is worse
 * than no toggle, and this is also what keeps it off every look in a wardrobe
 * that predates back photos.
 */
export function lookHasABack<T extends FlatLayInput>(
  items: readonly T[] | null | undefined
): boolean {
  return (items ?? []).some((item) => backPhotoOf(item) !== null);
}

/** A garment as the flat lay should draw it, once the side is decided. */
export interface FlatLayFace {
  thumbnail_url?: string | null;
  image_url?: string | null;
  has_cutout?: boolean;
  /**
   * True when this garment is showing its front *because* it has no back photo,
   * while the look is being shown from behind. The renderer fades it: "no tengo su
   * espalda" is a fact about the wardrobe, and pretending otherwise would have the
   * viewer reading a front photo as a back.
   */
  missingBack: boolean;
}

/**
 * Which photo of a garment to draw, and whether to apologise for it.
 *
 * Front is the plain case and is left exactly as it was — the primary photo, its
 * own cut-out flag — so nothing about a single-photo garment or an old item
 * changes. Behind, a garment with a back photo swaps to it (including that
 * photo's own alpha, which may differ from the front's), and one without stays on
 * its front and is marked.
 */
export function flatLayFace(item: FlatLayInput, showBack: boolean): FlatLayFace {
  const front: FlatLayFace = {
    thumbnail_url: item.thumbnail_url,
    image_url: item.image_url,
    has_cutout: item.has_cutout,
    missingBack: false,
  };
  if (!showBack) return front;
  const back = backPhotoOf(item);
  if (!back) return { ...front, missingBack: true };
  return {
    thumbnail_url: back.thumbnail_url,
    image_url: back.image_url,
    has_cutout: back.has_cutout,
    missingBack: false,
  };
}
