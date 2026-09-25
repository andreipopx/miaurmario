/**
 * The circle crop for profile photos: the square special case of `lib/image-crop`.
 *
 * The maths moved to `image-crop` when the garment cropper needed rectangular
 * frames; this module keeps the square-viewport signatures the avatar UI is
 * written against (a single `view` number, a `size` instead of width/height) and
 * delegates, so there is one implementation to get right.
 */

import {
  MAX_ZOOM,
  clampOffset as clampOffsetRect,
  centred as centredRect,
  coverScale as coverScaleRect,
  cropRect,
  scaleFor as scaleForRect,
  zoomAt as zoomAtRect,
  clampZoom,
  type CropState,
  type ImageSize,
} from '@/lib/image-crop';

export { MAX_ZOOM, clampZoom };
export type { CropState, ImageSize };

export const MAX_AVATAR_BYTES = 10 * 1024 * 1024;

const square = (view: number): ImageSize => ({ width: view, height: view });

export function coverScale(img: ImageSize, view: number): number {
  return coverScaleRect(img, square(view));
}

export function scaleFor(img: ImageSize, view: number, zoom: number): number {
  return scaleForRect(img, square(view), zoom);
}

/** Keep the image covering the viewport. */
export function clampOffset(img: ImageSize, view: number, state: CropState): CropState {
  return clampOffsetRect(img, square(view), state);
}

/** Initial state: centred, no zoom. */
export function centred(img: ImageSize, view: number): CropState {
  return centredRect(img, square(view));
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
  return zoomAtRect(img, square(view), state, nextZoom, fx, fy);
}

/** The square to keep, in image pixels (what the API expects as crop_x/crop_y/crop_size). */
export function cropBox(img: ImageSize, view: number, state: CropState) {
  const rect = cropRect(img, square(view), state);
  return { x: rect.x, y: rect.y, size: rect.width };
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
