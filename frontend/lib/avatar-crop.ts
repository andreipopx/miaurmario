/**
 * Geometry for the circle-crop UI (pure, unit-tested).
 *
 * The image is drawn inside a square viewport of `view` px at `scale` px per
 * image px, with its top-left corner at (`x`, `y`) (≤ 0). The image must always
 * cover the viewport, so `scale ≥ minScale` and the offset is clamped.
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

export const MAX_ZOOM = 4;
export const MAX_AVATAR_BYTES = 10 * 1024 * 1024;

export function coverScale(img: ImageSize, view: number): number {
  return view / Math.min(img.width, img.height);
}

export function scaleFor(img: ImageSize, view: number, zoom: number): number {
  return coverScale(img, view) * clampZoom(zoom);
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(1, zoom));
}

/** Keep the image covering the viewport. */
export function clampOffset(img: ImageSize, view: number, state: CropState): CropState {
  const zoom = clampZoom(state.zoom);
  const s = scaleFor(img, view, zoom);
  const minX = view - img.width * s;
  const minY = view - img.height * s;
  return {
    zoom,
    x: Math.min(0, Math.max(minX, state.x)),
    y: Math.min(0, Math.max(minY, state.y)),
  };
}

/** Initial state: centred, no zoom. */
export function centred(img: ImageSize, view: number): CropState {
  const s = scaleFor(img, view, 1);
  return { zoom: 1, x: (view - img.width * s) / 2, y: (view - img.height * s) / 2 };
}

/** Zoom keeping the point (`fx`, `fy`) of the viewport fixed (defaults to its centre). */
export function zoomAt(
  img: ImageSize,
  view: number,
  state: CropState,
  nextZoom: number,
  fx = view / 2,
  fy = view / 2
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

/** The square to keep, in image pixels (what the API expects as crop_x/crop_y/crop_size). */
export function cropBox(img: ImageSize, view: number, state: CropState) {
  const s = scaleFor(img, view, state.zoom);
  const size = Math.min(view / s, img.width, img.height);
  const x = Math.min(Math.max(0, -state.x / s), img.width - size);
  const y = Math.min(Math.max(0, -state.y / s), img.height - size);
  return { x: Math.round(x), y: Math.round(y), size: Math.max(1, Math.round(size)) };
}

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

/** Client-side pre-check; the server validates again. Returns an error key or null. */
export function avatarFileError(file: Pick<File, 'type' | 'size' | 'name'>): 'type' | 'size' | null {
  const type = (file.type || '').toLowerCase();
  const heicByName = !type && /\.(heic|heif)$/i.test(file.name);
  if (!ACCEPTED.includes(type) && !heicByName) return 'type';
  if (file.size > MAX_AVATAR_BYTES) return 'size';
  return null;
}
