/**
 * The eraser's arithmetic, away from the canvas.
 *
 * What matters here is the contract with the server — red erases, green restores —
 * and that a point on screen becomes the right pixel of the mask, because getting
 * that wrong means the user wipes somewhere they did not touch. Since the photo can
 * now be zoomed and dragged around while that happens, the mapping is pinned under
 * zoom too, along with the bounds that stop a pan leaving an empty stage.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BRUSH_FRACTION,
  FIT_VIEW,
  MAX_BRUSH_FRACTION,
  MAX_ZOOM,
  MIN_BRUSH_FRACTION,
  MIN_ZOOM,
  brushSizeFor,
  clampView,
  hasPaint,
  pointIn,
  regionBox,
  strokeColour,
  zoomAround,
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

describe('hasPaint, for a region', () => {
  it('needs three corners before a lasso has an inside', () => {
    const lasso = (n: number): BrushStroke => ({
      mode: 'erase',
      size: 10,
      shape: 'lasso',
      points: Array.from({ length: n }, (_, i) => ({ x: i * 10, y: i * 7 })),
    });
    expect(hasPaint([lasso(2)])).toBe(false);
    expect(hasPaint([lasso(3)])).toBe(true);
  });

  it('ignores a recuadro dragged out to nothing', () => {
    const box = (w: number, h: number): BrushStroke => ({
      mode: 'erase',
      size: 10,
      shape: 'rect',
      points: [
        { x: 20, y: 20 },
        { x: 20 + w, y: 20 + h },
      ],
    });
    // A tap that never moved is not "make this whole garment transparent".
    expect(hasPaint([box(0, 0)])).toBe(false);
    expect(hasPaint([box(0, 40)])).toBe(false);
    expect(hasPaint([box(40, 40)])).toBe(true);
  });
});

describe('regionBox', () => {
  it('takes the first and last points as opposite corners, in any order', () => {
    const forwards = regionBox([
      { x: 10, y: 20 },
      { x: 60, y: 90 },
    ]);
    const backwards = regionBox([
      { x: 60, y: 90 },
      { x: 10, y: 20 },
    ]);
    expect(forwards).toEqual({ x: 10, y: 20, width: 50, height: 70 });
    // Dragging up and to the left is the same box as dragging down and to the right.
    expect(backwards).toEqual(forwards);
  });

  it('ignores everything the finger did in between', () => {
    expect(
      regionBox([
        { x: 0, y: 0 },
        { x: 500, y: 500 },
        { x: 10, y: 10 },
      ])
    ).toEqual({ x: 0, y: 0, width: 10, height: 10 });
  });

  it('is nothing at all before the finger has moved', () => {
    expect(regionBox([{ x: 5, y: 5 }])).toBeNull();
  });
});

describe('pointIn, once the photo has been zoomed', () => {
  // The stage is 300x400 and the photo behind it is 600x800 mask pixels. Zooming is a
  // CSS transform, so the browser hands us a box that is bigger than the stage and
  // starts off to the left of it — and the same arithmetic has to keep working, or
  // the user wipes somewhere they did not touch.
  const mask = { width: 600, height: 800 };
  const zoomed = (zoom: number, panX: number, panY: number): DOMRect =>
    ({
      left: panX,
      top: panY,
      width: 300 * zoom,
      height: 400 * zoom,
      right: panX + 300 * zoom,
      bottom: panY + 400 * zoom,
      x: panX,
      y: panY,
      toJSON: () => ({}),
    }) as DOMRect;

  it('maps the same pixel at 1x and at 4x', () => {
    // The photo's centre pixel: at 1x it is the middle of the stage; at 4x, with the
    // view panned so the centre is still in the middle, it is the middle again.
    const at1x = pointIn(zoomed(1, 0, 0), mask, 150, 200);
    const at4x = pointIn(zoomed(4, -450, -600), mask, 150, 200);
    expect(at1x).toEqual({ x: 300, y: 400 });
    expect(at4x.x).toBeCloseTo(300, 6);
    expect(at4x.y).toBeCloseTo(400, 6);
  });

  it('resolves finer detail the further in you go', () => {
    // One CSS pixel of finger movement covers a quarter as much of the photo at 4x,
    // which is the entire point of being able to zoom.
    const fit = zoomed(1, 0, 0);
    const deep = zoomed(4, 0, 0);
    expect(pointIn(fit, mask, 151, 200).x - pointIn(fit, mask, 150, 200).x).toBeCloseTo(2, 6);
    expect(pointIn(deep, mask, 151, 200).x - pointIn(deep, mask, 150, 200).x).toBeCloseTo(0.5, 6);
  });
});

describe('clampView', () => {
  const stage = { width: 300, height: 400 };

  it('never zooms out past the whole photo, or in past what is useful', () => {
    expect(clampView({ zoom: 0.2, x: 0, y: 0 }, stage).zoom).toBe(MIN_ZOOM);
    expect(clampView({ zoom: 99, x: 0, y: 0 }, stage).zoom).toBe(MAX_ZOOM);
  });

  it('leaves no empty stage to get lost in', () => {
    // At 2x the photo is 600x800, so it can slide 300 left and 400 up and no further.
    expect(clampView({ zoom: 2, x: -1000, y: -1000 }, stage)).toEqual({
      zoom: 2,
      x: -300,
      y: -400,
    });
    expect(clampView({ zoom: 2, x: 50, y: 50 }, stage)).toEqual({ zoom: 2, x: 0, y: 0 });
  });

  it('pins the photo to the stage once you are all the way out', () => {
    expect(clampView({ zoom: 1, x: -80, y: 30 }, stage)).toEqual(FIT_VIEW);
  });

  it('survives arithmetic that went wrong upstream', () => {
    expect(clampView({ zoom: NaN, x: NaN, y: NaN }, stage)).toEqual(FIT_VIEW);
  });
});

describe('zoomAround', () => {
  const stage = { width: 300, height: 400 };

  it('keeps the spot under the fingers where it was', () => {
    const anchor = { x: 90, y: 120 };
    const after = zoomAround(FIT_VIEW, stage, 2, anchor);
    // Whatever was at the anchor before is still at the anchor: (anchor - x) / zoom
    // is the point of the photo under it, and it has not moved.
    const before = (anchor.x - FIT_VIEW.x) / FIT_VIEW.zoom;
    expect((anchor.x - after.x) / after.zoom).toBeCloseTo(before, 6);
  });

  it('cannot be talked past the limits, or off the edge', () => {
    const wild = zoomAround(FIT_VIEW, stage, 1000, { x: 0, y: 0 });
    expect(wild.zoom).toBe(MAX_ZOOM);
    expect(wild.x).toBeLessThanOrEqual(0);
    expect(wild.y).toBeLessThanOrEqual(0);
    expect(wild.x).toBeGreaterThanOrEqual(stage.width - stage.width * MAX_ZOOM);
  });
});
