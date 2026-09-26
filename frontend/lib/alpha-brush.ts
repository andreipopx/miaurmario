/**
 * The maths behind "borra lo que sobra", kept away from the canvas so it can be
 * tested without a browser.
 *
 * A stroke is a list of points in *mask* coordinates — the pixels of the photo as
 * the user sees it, after any quarter turns — plus how wide the brush was. The
 * server is handed an RGBA PNG where **red erases and green restores** and the
 * mask's own alpha is the strength, so a soft brush edge stays unambiguous: a
 * half-covered pixel is a half-strength stroke, never "half erase, half restore".
 */

import type { ImageSize } from '@/lib/image-crop';

export type BrushMode = 'erase' | 'restore';

export interface BrushPoint {
  x: number;
  y: number;
}

export interface BrushStroke {
  mode: BrushMode;
  /** Diameter in mask pixels. */
  size: number;
  points: BrushPoint[];
}

/** The smallest and largest brush, as a fraction of the photo's shorter side. */
export const MIN_BRUSH_FRACTION = 0.02;
export const MAX_BRUSH_FRACTION = 0.45;
export const DEFAULT_BRUSH_FRACTION = 0.1;

/** A brush diameter in mask pixels, from a 0-1 slider position. */
export function brushSizeFor(mask: ImageSize, position: number): number {
  const shorter = Math.min(mask.width, mask.height) || 1;
  const clamped = Math.min(1, Math.max(0, position));
  const fraction = MIN_BRUSH_FRACTION + (MAX_BRUSH_FRACTION - MIN_BRUSH_FRACTION) * clamped;
  return Math.max(4, Math.round(shorter * fraction));
}

/**
 * Where a pointer landed, in mask pixels.
 *
 * The canvas is CSS-sized to the box the photo occupies and its backing store is
 * the mask's own resolution, so this is one ratio per axis and nothing else — no
 * zoom, no scroll offset, and it keeps working while the box is being resized.
 */
export function pointIn(rect: DOMRect, mask: ImageSize, clientX: number, clientY: number): BrushPoint {
  const width = rect.width || 1;
  const height = rect.height || 1;
  return {
    x: ((clientX - rect.left) / width) * mask.width,
    y: ((clientY - rect.top) / height) * mask.height,
  };
}

/** True when a stroke put down anything at all. */
export function hasPaint(strokes: readonly BrushStroke[]): boolean {
  return strokes.some((stroke) => stroke.points.length > 0);
}

/**
 * Draw one stroke onto a 2D context as a round-capped line.
 *
 * A single tap has one point and no line to draw, so it gets a dot of its own;
 * without that, tapping a small hole would do nothing at all.
 */
export function traceStroke(
  ctx: CanvasRenderingContext2D,
  stroke: BrushStroke,
  from = 0
): void {
  const points = stroke.points;
  if (points.length === 0) return;
  ctx.lineWidth = stroke.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, stroke.size / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  const start = Math.max(0, Math.min(from, points.length - 2));
  ctx.moveTo(points[start].x, points[start].y);
  for (let i = start + 1; i < points.length; i += 1) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
}

/** The colour the server reads a stroke as. */
export function strokeColour(mode: BrushMode): string {
  return mode === 'erase' ? '#ff0000' : '#00ff00';
}
