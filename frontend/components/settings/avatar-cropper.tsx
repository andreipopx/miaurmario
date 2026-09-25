'use client';

import { useCallback } from 'react';

import { ImageCropper } from '@/components/shared/image-cropper';

export interface CropResult {
  x: number;
  y: number;
  size: number;
}

/**
 * The circle crop for a profile photo.
 *
 * The interaction (drag to move, pinch / wheel / slider to zoom, arrows and +/-
 * on a keyboard) lives in `ImageCropper`, which the garment cropper uses too.
 * This is the square, round-masked case: the frame cannot be reshaped and the
 * result is reported as a square box.
 *
 * `onChange(null)` while the image cannot be decoded (e.g. HEIC outside Safari) —
 * the server then centre-crops.
 */
export function AvatarCropper({
  src,
  view = 260,
  onChange,
}: {
  src: string;
  view?: number;
  onChange: (crop: CropResult | null) => void;
}) {
  const report = useCallback(
    (rect: { x: number; y: number; width: number; height: number } | null) => {
      onChange(rect ? { x: rect.x, y: rect.y, size: Math.min(rect.width, rect.height) } : null);
    },
    [onChange]
  );

  return <ImageCropper src={src} shape="circle" maxStage={view} onChange={report} />;
}
