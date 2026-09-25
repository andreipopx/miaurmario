/**
 * Geometry for cropping a photo inside a frame (pure, unit-tested).
 *
 * This is the circle-crop maths from the profile photo, widened from a square
 * viewport to a rectangular one so the same drag/pinch/keyboard interaction can
 * frame a garment: a pair of trousers wants a tall frame, a pair of shoes a wide
 * one. `lib/avatar-crop` is the square special case and delegates here.
 *
 * The image is drawn inside a frame of `view.width` x `view.height` px at `scale`
 * px per image px, with its top-left corner at (`x`, `y`) (<= 0). The image must
 * always cover the frame, so `scale >= coverScale` and the offset is clamped.
 */

export interface CropState {
  x: number;
  y: number;
  /** Zoom multiplier on top of the "cover" scale: 1 … MAX_ZOOM. */
  zoom: number;
}

export interface ImageSize {
  width: number;
  height: number;
}

/** The frame the user is looking through, in CSS pixels. */
export type Viewport = ImageSize;

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MAX_ZOOM = 4;

/** The smallest scale at which the image still covers the frame. */
export function coverScale(img: ImageSize, view: Viewport): number {
  return Math.max(view.width / img.width, view.height / img.height);
}

export function scaleFor(img: ImageSize, view: Viewport, zoom: number): number {
  return coverScale(img, view) * clampZoom(zoom);
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(1, zoom));
}

/** Keep the image covering the frame. */
export function clampOffset(img: ImageSize, view: Viewport, state: CropState): CropState {
  const zoom = clampZoom(state.zoom);
  const s = scaleFor(img, view, zoom);
  const minX = view.width - img.width * s;
  const minY = view.height - img.height * s;
  return {
    zoom,
    x: Math.min(0, Math.max(minX, state.x)),
    y: Math.min(0, Math.max(minY, state.y)),
  };
}

/** Initial state: centred, no zoom. */
export function centred(img: ImageSize, view: Viewport): CropState {
  const s = scaleFor(img, view, 1);
  return {
    zoom: 1,
    x: (view.width - img.width * s) / 2,
    y: (view.height - img.height * s) / 2,
  };
}

/** Zoom keeping the point (`fx`, `fy`) of the frame fixed (defaults to its centre). */
export function zoomAt(
  img: ImageSize,
  view: Viewport,
  state: CropState,
  nextZoom: number,
  fx = view.width / 2,
  fy = view.height / 2
): CropState {
  const prev = scaleFor(img, view, state.zoom);
  const next = scaleFor(img, view, nextZoom);
  const ratio = next / prev;
  return clampOffset(img, view, {
    zoom: nextZoom,
    x: fx - (fx - state.x) * ratio,
    y: fy - (fy - state.y) * ratio,
  });
}

/** The rectangle to keep, in image pixels (what the API expects as crop_x/y/w/h). */
export function cropRect(img: ImageSize, view: Viewport, state: CropState): CropRect {
  const s = scaleFor(img, view, state.zoom);
  const width = Math.min(view.width / s, img.width);
  const height = Math.min(view.height / s, img.height);
  const x = Math.min(Math.max(0, -state.x / s), img.width - width);
  const y = Math.min(Math.max(0, -state.y / s), img.height - height);
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}

/** True when the rectangle is the whole photo, i.e. there is nothing to send. */
export function isWholeImage(img: ImageSize, rect: CropRect, tolerance = 2): boolean {
  return (
    rect.x <= tolerance &&
    rect.y <= tolerance &&
    rect.width >= img.width - tolerance &&
    rect.height >= img.height - tolerance
  );
}

/**
 * The frame shapes on offer.
 *
 * `free` is the photo's own proportions — pan and zoom still choose the framing,
 * it just does not force a shape on the garment. The other three are the shapes
 * people actually reach for: a square tile, a tall frame for trousers and coats,
 * a wide one for shoes and belts.
 */
export const CROP_PRESETS = ['free', 'square', 'portrait', 'landscape'] as const;
export type CropPreset = (typeof CROP_PRESETS)[number];

const PRESET_RATIO: Record<Exclude<CropPreset, 'free'>, number> = {
  square: 1,
  portrait: 3 / 4,
  landscape: 4 / 3,
};

/** Width / height for a preset; `free` follows the image. */
export function presetRatio(preset: CropPreset, img: ImageSize | null): number {
  if (preset !== 'free') return PRESET_RATIO[preset];
  if (!img || !img.width || !img.height) return 1;
  return img.width / img.height;
}

/**
 * The biggest frame of ratio `ratio` that fits in `stage`, in CSS pixels.
 *
 * Rotating the image changes which way the stage is filled, so the frame is
 * recomputed rather than remembered.
 */
export function frameFor(stage: Viewport, ratio: number): Viewport {
  const byWidth = { width: stage.width, height: stage.width / ratio };
  if (byWidth.height <= stage.height) return byWidth;
  return { width: stage.height * ratio, height: stage.height };
}

/** Clamp a hand-dragged frame to the stage, never smaller than `min`. */
export function clampFrame(stage: Viewport, frame: Viewport, min = 48): Viewport {
  return {
    width: Math.min(stage.width, Math.max(min, frame.width)),
    height: Math.min(stage.height, Math.max(min, frame.height)),
  };
}

/** Swap width and height for an odd number of quarter turns. */
export function turnedSize(img: ImageSize, quarters: number): ImageSize {
  return ((quarters % 4) + 4) % 4 % 2 === 1
    ? { width: img.height, height: img.width }
    : { width: img.width, height: img.height };
}

/** Quarter turns, normalised to 0…3 clockwise. */
export function normaliseQuarters(quarters: number): number {
  return ((quarters % 4) + 4) % 4;
}
