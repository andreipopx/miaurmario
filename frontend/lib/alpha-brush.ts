/**
 * The maths behind "borra lo que sobra", kept away from the canvas so it can be
 * tested without a browser.
 *
 * A stroke is a list of points in *mask* coordinates — the pixels of the photo as
 * the user sees it, after any quarter turns — plus how wide the brush was. The
 * server is handed an RGBA PNG where **red erases and green restores** and the
 * mask's own alpha is the strength, so a soft brush edge stays unambiguous: a
 * half-covered pixel is a half-strength stroke, never "half erase, half restore".
 *
 * Mask coordinates are the whole point: the photo can be zoomed and dragged around
 * under the finger, and none of that is allowed to reach these numbers. The screen
 * is where the gesture happens; the mask is what gets edited.
 */

import type { ImageSize } from '@/lib/image-crop';

export type BrushMode = 'erase' | 'restore';

/**
 * How a stroke covers ground.
 *
 * `brush` is the finger dragged over the photo. The other two enclose a region —
 * the hole inside a halter neckline, the gap under a bag handle — and fill all of
 * it at once, which is the difference between one gesture and two minutes of
 * careful colouring-in.
 */
export type BrushShape = 'brush' | 'lasso' | 'rect';

export interface BrushPoint {
  x: number;
  y: number;
}

export interface BrushStroke {
  mode: BrushMode;
  /** Diameter in mask pixels. Ignored by a region, which has no thickness. */
  size: number;
  points: BrushPoint[];
  /**
   * A region instead of a line, when set. `lasso` closes the path the finger drew;
   * `rect` takes the first and last points as opposite corners.
   */
  shape?: BrushShape;
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
 * `rect` is the canvas's *live* bounding box, which already carries whatever zoom
 * and pan the stage is applying — a CSS transform moves the box the browser
 * reports, so one ratio per axis stays correct at 1x and at 8x alike. That is why
 * zooming cannot put a stroke somewhere the user did not touch, and why there is no
 * zoom argument here to get out of step with the transform.
 */
export function pointIn(
  rect: DOMRect,
  mask: ImageSize,
  clientX: number,
  clientY: number
): BrushPoint {
  const width = rect.width || 1;
  const height = rect.height || 1;
  return {
    x: ((clientX - rect.left) / width) * mask.width,
    y: ((clientY - rect.top) / height) * mask.height,
  };
}

/** The axis-aligned box a `rect` region covers, from its first and last points. */
export function regionBox(
  points: readonly BrushPoint[]
): { x: number; y: number; width: number; height: number } | null {
  if (points.length < 2) return null;
  const a = points[0];
  const b = points[points.length - 1];
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/** True when this one stroke would change any pixel. */
export function strokePaints(stroke: BrushStroke): boolean {
  if (stroke.shape === 'rect') {
    const box = regionBox(stroke.points);
    return !!box && box.width >= 1 && box.height >= 1;
  }
  // Two points and a closing edge is a line with no inside; three is a triangle.
  if (stroke.shape === 'lasso') return stroke.points.length >= 3;
  return stroke.points.length > 0;
}

/** True when a stroke put down anything at all. */
export function hasPaint(strokes: readonly BrushStroke[]): boolean {
  return strokes.some(strokePaints);
}

/**
 * Add a region's outline to the current path, without painting it.
 *
 * Shared by the mask, the live preview and the restore brush's clip, so all three
 * agree about exactly which pixels are inside — a preview that disagreed with the
 * saved result would be worse than no preview.
 */
export function regionPath(ctx: CanvasRenderingContext2D, stroke: BrushStroke): void {
  const points = stroke.points;
  if (stroke.shape === 'rect') {
    const box = regionBox(points);
    if (!box) return;
    ctx.rect(box.x, box.y, box.width, box.height);
    return;
  }
  if (points.length < 3) return;
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
}

/**
 * Add a stroke's *filled area* to the current path — what `clip()` needs.
 *
 * A thick round-capped line cannot be clipped to directly, so it is rebuilt out of
 * the shapes whose union it is: a disc at every point and a quad along every
 * segment. The quads are wound the same way as the discs on purpose; under the
 * non-zero rule opposite windings would cancel and punch holes at the joints. This
 * matters because the preview used to clip to the discs alone, so a fast drag came
 * out dotted on screen and solid on the server.
 */
export function traceFilledArea(ctx: CanvasRenderingContext2D, stroke: BrushStroke): void {
  if (stroke.shape && stroke.shape !== 'brush') {
    regionPath(ctx, stroke);
    return;
  }
  const radius = stroke.size / 2;
  const points = stroke.points;
  for (const point of points) {
    ctx.moveTo(point.x + radius, point.y);
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  }
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1];
    const to = points[i];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) continue;
    const nx = (-dy / length) * radius;
    const ny = (dx / length) * radius;
    ctx.moveTo(from.x + nx, from.y + ny);
    ctx.lineTo(from.x - nx, from.y - ny);
    ctx.lineTo(to.x - nx, to.y - ny);
    ctx.lineTo(to.x + nx, to.y + ny);
    ctx.closePath();
  }
}

/**
 * Draw one stroke onto a 2D context.
 *
 * A region is filled. A brush stroke is a round-capped line; a single tap has one
 * point and no line to draw, so it gets a dot of its own — without that, tapping a
 * small hole would do nothing at all.
 */
export function traceStroke(
  ctx: CanvasRenderingContext2D,
  stroke: BrushStroke,
  from = 0
): void {
  if (stroke.shape && stroke.shape !== 'brush') {
    ctx.beginPath();
    regionPath(ctx, stroke);
    ctx.fill();
    return;
  }
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

// --- Zoom and pan -----------------------------------------------------------
//
// The stage shows the photo at some box of CSS pixels. Zooming scales that box and
// panning slides it, and both are applied as one CSS transform on a wrapper, which
// is what keeps `pointIn` honest: the browser reports the transformed box, so the
// arithmetic above never has to know a zoom happened.

/** 1 is "the whole photo fits"; anything less would leave the stage empty. */
export const MIN_ZOOM = 1;
/**
 * Eight times is enough to pick at a strap on a 320px phone and still be pointing
 * at something; past that the photo's own pixels are bigger than the finger.
 */
export const MAX_ZOOM = 8;
/** One press of + or − , and one notch of a mouse wheel. */
export const ZOOM_STEP = 1.6;

export interface BrushView {
  zoom: number;
  /** The scaled photo's top-left corner, in stage CSS pixels. Never positive. */
  x: number;
  y: number;
}

export const FIT_VIEW: BrushView = { zoom: MIN_ZOOM, x: 0, y: 0 };

/**
 * A view that cannot show emptiness.
 *
 * The photo is never smaller than the stage and never dragged off the edge of it,
 * so there is no way to get lost — which on a phone is the difference between a
 * zoom you can use and a zoom you have to undo.
 */
export function clampView(view: BrushView, stage: ImageSize): BrushView {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number.isFinite(view.zoom) ? view.zoom : 1));
  const minX = stage.width - stage.width * zoom;
  const minY = stage.height - stage.height * zoom;
  return {
    zoom,
    x: Math.min(0, Math.max(minX, Number.isFinite(view.x) ? view.x : 0)),
    y: Math.min(0, Math.max(minY, Number.isFinite(view.y) ? view.y : 0)),
  };
}

/**
 * Zoom while keeping one point of the photo under the same spot on the stage.
 *
 * `anchor` is in stage CSS pixels, so it is where the fingers are or where the
 * cursor is. Anything else — zooming about the centre, say — walks the detail the
 * user was working on off the screen.
 */
export function zoomAround(
  view: BrushView,
  stage: ImageSize,
  nextZoom: number,
  anchor: BrushPoint
): BrushView {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
  const ratio = zoom / (view.zoom || 1);
  return clampView(
    {
      zoom,
      x: anchor.x - (anchor.x - view.x) * ratio,
      y: anchor.y - (anchor.y - view.y) * ratio,
    },
    stage
  );
}
