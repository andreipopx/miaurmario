/**
 * The eraser's arithmetic, away from the canvas.
 *
 * What matters here is the contract with the server — red erases, green restores —
 * and that a point on screen becomes the right pixel of the mask, because getting
 * that wrong means the user wipes somewhere they did not touch.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BRUSH_FRACTION,
  MAX_BRUSH_FRACTION,
  MIN_BRUSH_FRACTION,
  brushSizeFor,
  hasPaint,
  pointIn,
  strokeColour,
  type BrushStroke,
} from '@/lib/alpha-brush';

const rect = (): DOMRect =>
  ({ left: 0, top: 0, width: 300, height: 400, right: 300, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

describe('strokeColour', () => {
  it('is the contract the server reads: red erases, green restores', () => {
    expect(strokeColour('erase')).toBe('#ff0000');
    expect(strokeColour('restore')).toBe('#00ff00');
  });
});

describe('brushSizeFor', () => {
  it('scales with the photo, not with the screen', () => {
    // The same slider position on a big photo and a small one covers the same
    // proportion of the garment.
    const big = brushSizeFor({ width: 2000, height: 3000 }, DEFAULT_BRUSH_FRACTION * 2);
    const small = brushSizeFor({ width: 200, height: 300 }, DEFAULT_BRUSH_FRACTION * 2);
    expect(big / small).toBeCloseTo(10, 0);
  });

  it('measures against the shorter side', () => {
    expect(brushSizeFor({ width: 400, height: 1000 }, 0)).toBe(
      brushSizeFor({ width: 1000, height: 400 }, 0)
    );
  });

  it('spans the intended range and clamps outside it', () => {
    const mask = { width: 1000, height: 1000 };
    expect(brushSizeFor(mask, 0)).toBe(Math.round(1000 * MIN_BRUSH_FRACTION));
    expect(brushSizeFor(mask, 1)).toBe(Math.round(1000 * MAX_BRUSH_FRACTION));
    expect(brushSizeFor(mask, -5)).toBe(brushSizeFor(mask, 0));
    expect(brushSizeFor(mask, 5)).toBe(brushSizeFor(mask, 1));
  });

  it('never goes so small it cannot be aimed', () => {
    expect(brushSizeFor({ width: 10, height: 10 }, 0)).toBeGreaterThanOrEqual(4);
  });

  it('survives a photo of no size at all', () => {
    expect(brushSizeFor({ width: 0, height: 0 }, 0.5)).toBeGreaterThanOrEqual(4);
  });
});

describe('pointIn', () => {
  it('maps a corner to a corner', () => {
    const mask = { width: 600, height: 800 };
    expect(pointIn(rect(), mask, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(pointIn(rect(), mask, 300, 400)).toEqual({ x: 600, y: 800 });
  });

  it('maps the middle to the middle whatever the box is doing', () => {
    const mask = { width: 600, height: 800 };
    expect(pointIn(rect(), mask, 150, 200)).toEqual({ x: 300, y: 400 });
  });

  it('accounts for where the box sits on the page', () => {
    const mask = { width: 100, height: 100 };
    const offset = { ...rect(), left: 40, top: 90 } as DOMRect;
    expect(pointIn(offset, mask, 40, 90)).toEqual({ x: 0, y: 0 });
  });

  it('does not divide by zero on a box that has not been laid out', () => {
    const collapsed = { ...rect(), width: 0, height: 0 } as DOMRect;
    const point = pointIn(collapsed, { width: 100, height: 100 }, 0, 0);
    expect(Number.isFinite(point.x)).toBe(true);
    expect(Number.isFinite(point.y)).toBe(true);
  });
});

describe('hasPaint', () => {
  const stroke = (points: number): BrushStroke => ({
    mode: 'erase',
    size: 10,
    points: Array.from({ length: points }, (_, i) => ({ x: i, y: i })),
  });

  it('is false with nothing painted, so "guardar" stays off', () => {
    expect(hasPaint([])).toBe(false);
    expect(hasPaint([stroke(0)])).toBe(false);
  });

  it('is true for a single tap', () => {
    expect(hasPaint([stroke(1)])).toBe(true);
  });
});
