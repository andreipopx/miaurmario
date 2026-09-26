'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Check,
  Eraser,
  Hand,
  Lasso,
  Loader2,
  Maximize2,
  Minus,
  PaintBucket,
  Plus,
  RotateCcw,
  Square,
  Undo2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { turnedSize, type ImageSize } from '@/lib/image-crop';
import {
  DEFAULT_BRUSH_FRACTION,
  FIT_VIEW,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEP,
  brushSizeFor,
  clampView,
  hasPaint,
  pointIn,
  regionBox,
  strokeColour,
  strokePaints,
  traceFilledArea,
  traceStroke,
  zoomAround,
  type BrushMode,
  type BrushPoint,
  type BrushStroke,
  type BrushView,
} from '@/lib/alpha-brush';
import { cn } from '@/lib/utils';

/** How far the pointer must travel on screen before another point is recorded. */
const MIN_STEP_CSS = 2;

/**
 * The biggest preview canvas we keep, in pixels on its longest side.
 *
 * A phone photo is 2400px or more on its long edge, and the restore brush repaints
 * the whole thing on every pointer move — at full size that is 7 megapixels of
 * clear-and-redraw per event, which stutters on the exact device this is for. The
 * *mask* that gets sent is still built at the photo's own resolution (see `apply`),
 * so nothing about accuracy depends on this number; only how sharp the preview
 * looks at the deepest zoom.
 */
const PREVIEW_MAX = 1600;

/** How close two taps must be, in time and in CSS pixels, to count as a double tap. */
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_SLOP = 32;

/** What a double tap zooms to, when it is not already zoomed in. */
const DOUBLE_TAP_ZOOM = 3;

/** Which gesture the photo is under: painting, dragging it around, or pinching. */
type Tool = 'brush' | 'lasso' | 'rect' | 'pan';

export interface AlphaBrushResult {
  /** An RGBA PNG: red erases, green restores. Sized to the photo as displayed. */
  mask: Blob;
  width: number;
  height: number;
}

/**
 * "Borra lo que sobra": paint away what the cut-out kept, paint back what it ate.
 *
 * The same control in both places it is needed — over a photo being added, and over
 * a garment already in the wardrobe — because they are the same gesture and the user
 * should not have to learn it twice. What differs is only what it is handed:
 *
 * - `src` is the picture to paint on. For a saved garment that is the cut-out, so
 *   the holes the model left are visible and can be wiped; for a new photo it is
 *   the photo itself, turned by `quarters` the way the preview shows it.
 * - `restoreSrc` is the untouched photo. Painting a garment back has to show real
 *   pixels, and a stored cut-out keeps nothing under its transparency — without it
 *   the restore brush is hidden rather than lying about what it would do.
 *
 * Two dimensions, deliberately kept apart, because a fixed-size brush over a
 * thumbnail-sized photo was not enough to fix a halter neckline:
 *
 * - *what* a gesture does — borrar or devolver — is one pair of buttons;
 * - *how* it covers ground — pincel, lazo, recuadro, or mover the photo — is
 *   another. So the lasso can restore a region as readily as it can erase one,
 *   without six buttons for six combinations.
 *
 * Zoom is a CSS transform on the stage and nothing else. Every stroke is recorded in
 * the coordinates of the stored photo, read off the canvas's live bounding box, so
 * the mask is identical whether it was painted at 1x or at 8x. The brush is measured
 * in photo pixels too: zooming in shows it bigger without making it cover more.
 *
 * Nothing is sent until the user says so. Undo walks back stroke by stroke;
 * `onReset` is a different thing and says so — it throws away *every* edit ever
 * made to this garment and goes back to what the model decided.
 */
export function AlphaBrush({
  src,
  restoreSrc,
  quarters = 0,
  maxStage = 320,
  busy = false,
  resetting = false,
  canReset = false,
  onApply,
  onCancel,
  onReset,
  className,
}: {
  src: string;
  restoreSrc?: string | null;
  /** Quarter turns the caller shows the photo at; the mask is in those coordinates. */
  quarters?: number;
  maxStage?: number;
  busy?: boolean;
  resetting?: boolean;
  canReset?: boolean;
  onApply: (result: AlphaBrushResult) => void;
  onCancel: () => void;
  onReset?: () => void;
  className?: string;
}) {
  const t = useTranslations('imageBrush');

  const [natural, setNatural] = useState<ImageSize | null>(null);
  const [broken, setBroken] = useState(false);
  const [mode, setMode] = useState<BrushMode>('erase');
  const [tool, setTool] = useState<Tool>('brush');
  const [sizePosition, setSizePosition] = useState(DEFAULT_BRUSH_FRACTION * 2);
  const [strokes, setStrokes] = useState<BrushStroke[]>([]);
  const [stage, setStage] = useState(maxStage);
  const [view, setView] = useState<BrushView>(FIT_VIEW);
  /** The region being dragged out, drawn as an outline until the finger lifts. */
  const [region, setRegion] = useState<BrushStroke | null>(null);
  /** Where the brush would land: the mouse, or the keyboard crosshair. In mask pixels. */
  const [caret, setCaret] = useState<BrushPoint | null>(null);

  const wrapper = useRef<HTMLDivElement>(null);
  const stageEl = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const base = useRef<HTMLImageElement | null>(null);
  const restore = useRef<HTMLImageElement | null>(null);
  const [restoreReady, setRestoreReady] = useState(false);

  /** Every finger or pen currently down, in client coordinates. */
  const pointers = useRef(new Map<number, BrushPoint>());
  const gesture = useRef<
    | { kind: 'paint'; pointerId: number; stroke: BrushStroke }
    | { kind: 'pan'; pointerId: number; from: BrushPoint; fromView: BrushView }
    | {
        kind: 'pinch';
        ids: [number, number];
        distance: number;
        centre: BrushPoint;
        fromView: BrushView;
      }
    | null
  >(null);
  const lastTap = useRef<{ at: number; x: number; y: number } | null>(null);

  /** The photo as the user sees it: a quarter turn swaps its sides. */
  const mask = useMemo(() => (natural ? turnedSize(natural, quarters) : null), [natural, quarters]);
  const brush = mask ? brushSizeFor(mask, sizePosition) : 0;

  // The stage is as wide as the dialog allows, so one component serves 320px and a
  // desktop without two sets of numbers. Same approach as the cropper.
  useLayoutEffect(() => {
    const el = wrapper.current;
    if (!el) return;
    const measure = () =>
      setStage((prev) => {
        const width = Math.max(160, Math.min(maxStage, el.clientWidth || maxStage));
        return prev === width ? prev : width;
      });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [maxStage]);

  /** The box the whole photo occupies on the stage at zoom 1, in CSS pixels. */
  const displayed = mask
    ? mask.width >= mask.height
      ? { width: stage, height: Math.round((stage * mask.height) / mask.width) }
      : { width: Math.round((stage * mask.width) / mask.height), height: stage }
    : { width: stage, height: stage };

  // A new photo is a new edit.
  useEffect(() => {
    setStrokes([]);
    setRegion(null);
    setCaret(null);
    setNatural(null);
    setBroken(false);
    setView(FIT_VIEW);
    base.current = null;
  }, [src]);

  // The pan offset is measured in stage pixels, so a stage that changed size — the
  // dialog reflowing, the phone turning — would leave it pointing somewhere else.
  // Showing the whole photo again is both correct and the obvious thing to see.
  useEffect(() => {
    setView(FIT_VIEW);
  }, [displayed.width, displayed.height]);

  /** Load both bitmaps ourselves: the canvas needs decoded images, not <img> tags. */
  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      if (cancelled) return;
      if (!image.naturalWidth || !image.naturalHeight) {
        setBroken(true);
        return;
      }
      base.current = image;
      setNatural({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => !cancelled && setBroken(true);
    image.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);

  useEffect(() => {
    setRestoreReady(false);
    restore.current = null;
    if (!restoreSrc) return;
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      if (cancelled) return;
      restore.current = image;
      setRestoreReady(true);
    };
    // Not an error worth showing: without it the restore brush is simply not offered.
    image.onerror = () => undefined;
    image.src = restoreSrc;
    return () => {
      cancelled = true;
    };
  }, [restoreSrc]);

  // Restoring needs real pixels to paint back, so it is only offered when we have
  // them. Erasing always works.
  const canRestore = restoreReady;
  useEffect(() => {
    if (!canRestore && mode === 'restore') setMode('erase');
  }, [canRestore, mode]);

  /**
   * How much smaller the preview canvas is than the photo.
   *
   * Strokes stay in the photo's own coordinates; the context is scaled by this once
   * per repaint, so nothing else in here has to know about it.
   */
  const previewScale = mask
    ? Math.min(1, PREVIEW_MAX / Math.max(mask.width, mask.height, 1))
    : 1;
  const previewSize = mask
    ? {
        width: Math.max(1, Math.round(mask.width * previewScale)),
        height: Math.max(1, Math.round(mask.height * previewScale)),
      }
    : { width: 1, height: 1 };

  /** Put the turned photo on the context, filling the photo's coordinate space. */
  const drawPhoto = useCallback(
    (ctx: CanvasRenderingContext2D, image: HTMLImageElement) => {
      if (!mask) return;
      ctx.save();
      ctx.translate(mask.width / 2, mask.height / 2);
      ctx.rotate((quarters * Math.PI) / 2);
      ctx.drawImage(
        image,
        -image.naturalWidth / 2,
        -image.naturalHeight / 2,
        image.naturalWidth,
        image.naturalHeight
      );
      ctx.restore();
    },
    [mask, quarters]
  );

  /**
   * Paint a list of strokes onto the context, on top of whatever is already there.
   *
   * Erasing punches the canvas through, which is literally what the user asked for.
   * Restoring clips to the stroke's own area and redraws the untouched photo inside
   * it, so it brings back exactly the pixels the server will.
   */
  const paintStrokes = useCallback(
    (ctx: CanvasRenderingContext2D, list: readonly BrushStroke[], from = 0) => {
      for (const stroke of list) {
        if (stroke.mode === 'erase') {
          ctx.globalCompositeOperation = 'destination-out';
          ctx.strokeStyle = '#000';
          ctx.fillStyle = '#000';
          traceStroke(ctx, stroke, from);
        } else if (restore.current) {
          ctx.globalCompositeOperation = 'source-over';
          ctx.save();
          ctx.beginPath();
          traceFilledArea(ctx, stroke);
          ctx.clip();
          drawPhoto(ctx, restore.current);
          ctx.restore();
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    },
    [drawPhoto]
  );

  /** Clear the canvas and set it up to take coordinates in photo pixels. */
  const freshContext = useCallback((): CanvasRenderingContext2D | null => {
    const el = canvas.current;
    if (!el) return null;
    const ctx = el.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, el.width, el.height);
    ctx.setTransform(previewScale, 0, 0, previewScale, 0, 0);
    return ctx;
  }, [previewScale]);

  // Every committed change — a new stroke, an undo, the photo finishing loading,
  // the restore photo arriving — repaints from the photo up.
  useEffect(() => {
    const photo = base.current;
    if (!photo || !mask) return;
    const ctx = freshContext();
    if (!ctx) return;
    drawPhoto(ctx, photo);
    paintStrokes(ctx, strokes);
  }, [drawPhoto, freshContext, mask, paintStrokes, strokes, restoreReady, natural]);

  /** Repaint everything, including the stroke still under the finger. */
  const repaintLive = () => {
    const live = gesture.current;
    const photo = base.current;
    if (!photo || !mask) return;
    const ctx = freshContext();
    if (!ctx) return;
    drawPhoto(ctx, photo);
    paintStrokes(ctx, live?.kind === 'paint' ? [...strokes, live.stroke] : strokes);
  };

  // --- coordinates ----------------------------------------------------------

  /**
   * Where a pointer landed, in the stored photo's pixels.
   *
   * Off the canvas's live bounding box, which already carries the zoom and the pan,
   * so a stroke painted at 8x lands on the same pixel it would at 1x.
   */
  const maskPoint = (clientX: number, clientY: number): BrushPoint | null => {
    const el = canvas.current;
    if (!el || !mask) return null;
    return pointIn(el.getBoundingClientRect(), mask, clientX, clientY);
  };

  /** Where a pointer landed on the stage itself, which is what zoom is anchored to. */
  const stagePoint = (clientX: number, clientY: number): BrushPoint => {
    const rect = stageEl.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  };

  /** Photo pixels per CSS pixel at the current zoom — how coarse to sample a drag. */
  const minStep = mask
    ? Math.max(1, (MIN_STEP_CSS * mask.width) / Math.max(1, displayed.width * view.zoom))
    : MIN_STEP_CSS;

  // --- zoom -----------------------------------------------------------------

  const zoomTo = (next: number, anchor?: BrushPoint) =>
    setView((current) =>
      zoomAround(
        current,
        displayed,
        next,
        anchor ?? { x: displayed.width / 2, y: displayed.height / 2 }
      )
    );

  const zoomBy = (factor: number, anchor?: BrushPoint) =>
    setView((current) =>
      zoomAround(
        current,
        displayed,
        current.zoom * factor,
        anchor ?? { x: displayed.width / 2, y: displayed.height / 2 }
      )
    );

  // A native listener, because React's onWheel cannot preventDefault: without it the
  // wheel scrolls the dialog instead of zooming the photo.
  useEffect(() => {
    const el = stageEl.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      event.preventDefault();
      const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      zoomBy(factor, stagePoint(event.clientX, event.clientY));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- zoomBy reads fresh state via the updater
  }, [displayed.width, displayed.height]);

  /** Toggle between fitting the photo and a close-up of the spot that was tapped. */
  const toggleZoomAt = (point: BrushPoint) => {
    if (view.zoom > MIN_ZOOM + 0.01) {
      setView(FIT_VIEW);
      return;
    }
    zoomTo(DOUBLE_TAP_ZOOM, point);
  };

  // --- gestures -------------------------------------------------------------

  /** Extend the stroke in progress, and show it immediately. */
  const extend = (point: BrushPoint) => {
    const live = gesture.current;
    if (live?.kind !== 'paint') return;
    const points = live.stroke.points;
    const last = points[points.length - 1];
    const shape = live.stroke.shape ?? 'brush';

    if (shape === 'rect') {
      // Two corners, so the second point is replaced rather than appended.
      if (points.length > 1) points[points.length - 1] = point;
      else points.push(point);
      setRegion({ ...live.stroke, points: [...points] });
      return;
    }
    if (last && Math.hypot(point.x - last.x, point.y - last.y) < minStep) return;
    points.push(point);
    if (shape === 'lasso') {
      // Only the outline moves while the finger is down; the fill lands on the
      // canvas when it lifts, which keeps a big photo from stuttering mid-drag.
      setRegion({ ...live.stroke, points: [...points] });
      return;
    }
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    if (live.stroke.mode === 'erase') {
      ctx.setTransform(previewScale, 0, 0, previewScale, 0, 0);
      paintStrokes(ctx, [live.stroke], Math.max(0, points.length - 2));
    } else {
      repaintLive();
    }
  };

  /** Abandon whatever is in progress without recording it. */
  const abandon = () => {
    const live = gesture.current;
    gesture.current = null;
    setRegion(null);
    if (live?.kind === 'paint') repaintLive();
  };

  const startPinch = (ids: [number, number]) => {
    const a = pointers.current.get(ids[0]);
    const b = pointers.current.get(ids[1]);
    if (!a || !b) return;
    gesture.current = {
      kind: 'pinch',
      ids,
      distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
      centre: stagePoint((a.x + b.x) / 2, (a.y + b.y) / 2),
      fromView: view,
    };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!mask || busy) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);

    if (pointers.current.size >= 2) {
      // A second finger means the first one was the start of a pinch, not a stroke.
      abandon();
      const ids = Array.from(pointers.current.keys()).slice(0, 2) as [number, number];
      startPinch(ids);
      return;
    }

    // The hand tool, the middle mouse button, and a right-drag all mean "move the
    // photo" — nobody should have to find the right tool to look somewhere else.
    if (tool === 'pan' || event.button === 1 || event.button === 2) {
      gesture.current = {
        kind: 'pan',
        pointerId: event.pointerId,
        from: { x: event.clientX, y: event.clientY },
        fromView: view,
      };
      return;
    }

    const point = maskPoint(event.clientX, event.clientY);
    if (!point) return;
    const shape: Tool = tool;
    const stroke: BrushStroke = {
      mode,
      size: brush,
      points: [point],
      shape: shape === 'brush' ? 'brush' : shape === 'lasso' ? 'lasso' : 'rect',
    };
    gesture.current = { kind: 'paint', pointerId: event.pointerId, stroke };
    setCaret(point);
    if (stroke.shape === 'brush') {
      // A tap that never moves still has to leave a mark.
      const ctx = canvas.current?.getContext('2d');
      if (ctx) {
        ctx.setTransform(previewScale, 0, 0, previewScale, 0, 0);
        paintStrokes(ctx, [stroke]);
      }
    } else {
      setRegion(stroke);
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pointers.current.has(event.pointerId)) {
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    const live = gesture.current;

    if (live?.kind === 'pinch') {
      const a = pointers.current.get(live.ids[0]);
      const b = pointers.current.get(live.ids[1]);
      if (!a || !b) return;
      event.preventDefault();
      const distance = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
      setView(
        zoomAround(
          live.fromView,
          displayed,
          live.fromView.zoom * (distance / live.distance),
          live.centre
        )
      );
      return;
    }

    if (live?.kind === 'pan' && live.pointerId === event.pointerId) {
      event.preventDefault();
      setView(
        clampView(
          {
            zoom: live.fromView.zoom,
            x: live.fromView.x + (event.clientX - live.from.x),
            y: live.fromView.y + (event.clientY - live.from.y),
          },
          displayed
        )
      );
      return;
    }

    if (live?.kind === 'paint' && live.pointerId === event.pointerId) {
      event.preventDefault();
      const point = maskPoint(event.clientX, event.clientY);
      if (point) extend(point);
      return;
    }

    // Nothing down: show a mouse user where the brush would land.
    if (event.pointerType === 'mouse' && tool === 'brush') {
      const point = maskPoint(event.clientX, event.clientY);
      if (point) setCaret(point);
    }
  };

  const endGesture = (event: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    pointers.current.delete(event.pointerId);
    const live = gesture.current;

    if (live?.kind === 'pinch') {
      if (pointers.current.size === 1) {
        // One finger left: carry on as a drag rather than dropping the gesture.
        const [id] = Array.from(pointers.current.keys());
        const at = pointers.current.get(id);
        gesture.current = at
          ? { kind: 'pan', pointerId: id, from: at, fromView: view }
          : null;
      } else if (pointers.current.size === 0) {
        gesture.current = null;
      }
      return;
    }

    if (live?.kind === 'pan' && live.pointerId === event.pointerId) {
      gesture.current = null;
      // In the hand tool a tap is not a stroke, so it is free to mean "zoom here".
      if (!cancelled && tool === 'pan') registerTap(event);
      return;
    }

    if (live?.kind === 'paint' && live.pointerId === event.pointerId) {
      gesture.current = null;
      setRegion(null);
      if (cancelled) {
        repaintLive();
        return;
      }
      const stroke = live.stroke;
      if (!strokePaints(stroke)) {
        // A lasso of two points or a recuadro of no width encloses nothing; saying
        // so by simply leaving the photo alone beats recording an empty edit.
        repaintLive();
        return;
      }
      setStrokes((current) => [...current, stroke]);
    }
  };

  /** Two quick taps in the same spot zoom in, or back out again. */
  const registerTap = (event: React.PointerEvent<HTMLDivElement>) => {
    const now = Date.now();
    const previous = lastTap.current;
    if (
      previous &&
      now - previous.at < DOUBLE_TAP_MS &&
      Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < DOUBLE_TAP_SLOP
    ) {
      lastTap.current = null;
      toggleZoomAt(stagePoint(event.clientX, event.clientY));
      return;
    }
    lastTap.current = { at: now, x: event.clientX, y: event.clientY };
  };

  /** Arrows move a crosshair, Enter or Space puts a dab down, +/−/0 zoom. */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!mask) return;
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      zoomBy(ZOOM_STEP);
      return;
    }
    if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      zoomBy(1 / ZOOM_STEP);
      return;
    }
    if (event.key === '0') {
      event.preventDefault();
      setView(FIT_VIEW);
      return;
    }
    const step = Math.max(2, Math.round(brush / (event.shiftKey ? 1 : 3)));
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      setCaret((prev) => {
        const from = prev ?? { x: mask.width / 2, y: mask.height / 2 };
        return {
          x: Math.min(mask.width, Math.max(0, from.x + move[0])),
          y: Math.min(mask.height, Math.max(0, from.y + move[1])),
        };
      });
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const at = caret ?? { x: mask.width / 2, y: mask.height / 2 };
      setCaret(at);
      setStrokes((current) => [...current, { mode, size: brush, points: [at], shape: 'brush' }]);
    }
  };

  const undo = () => setStrokes((current) => current.slice(0, -1));

  const apply = () => {
    if (!mask || !hasPaint(strokes)) return;
    // The mask is built here rather than kept alongside: one pass over the strokes,
    // at the photo's own resolution whatever the preview was showing, and nothing to
    // keep in step.
    const out = document.createElement('canvas');
    out.width = mask.width;
    out.height = mask.height;
    const ctx = out.getContext('2d');
    if (!ctx) return;
    for (const stroke of strokes) {
      ctx.strokeStyle = strokeColour(stroke.mode);
      ctx.fillStyle = strokeColour(stroke.mode);
      traceStroke(ctx, stroke);
    }
    out.toBlob((blob) => {
      if (blob) onApply({ mask: blob, width: mask.width, height: mask.height });
    }, 'image/png');
  };

  const painted = hasPaint(strokes);
  const zoomed = view.zoom > MIN_ZOOM + 0.01;
  /** The brush ring, when there is a brush and somewhere to put it. */
  const ring = tool === 'brush' && mask && caret ? caret : null;
  const liveBox = region?.shape === 'rect' ? regionBox(region.points) : null;
  /** Red for "this goes", green for "this comes back" — the server's own contract. */
  const regionFill = mode === 'erase' ? 'rgba(244, 63, 94, 0.3)' : 'rgba(16, 185, 129, 0.3)';
  const hint = t(
    tool === 'pan'
      ? 'hintPan'
      : tool === 'lasso'
        ? mode === 'erase'
          ? 'hintLassoErase'
          : 'hintLassoRestore'
        : tool === 'rect'
          ? mode === 'erase'
            ? 'hintRectErase'
            : 'hintRectRestore'
          : mode === 'erase'
            ? 'hintBrushErase'
            : 'hintBrushRestore'
  );

  const toolButton = (value: Tool, icon: React.ReactNode, label: string) => (
    <Button
      type="button"
      variant={tool === value ? 'default' : 'secondary'}
      aria-pressed={tool === value}
      // Two per row while the words fit and one per row when they do not: `basis` in
      // rem grows with the root font size, so at 125% "Recuadro" stops being
      // "Recuad…" instead of quietly losing its last two letters.
      className="h-11 min-w-0 flex-1 basis-[7.5rem] px-2"
      title={label}
      onClick={() => {
        setTool(value);
        setRegion(null);
      }}
    >
      {icon}
      <span className="min-w-0 truncate">{label}</span>
    </Button>
  );

  return (
    <div ref={wrapper} className={cn('flex w-full flex-col items-center gap-3', className)}>
      {/* Undo lives up here, beside the title, rather than at the end of the zoom
          row: at 125% font that row is four 55px buttons and a label, and undo was
          being wrapped onto a line of its own where it read as a stray control. It
          undoes the whole edit a stroke at a time, so the top of the panel is where
          it belongs anyway. */}
      <div className="flex w-full items-center gap-2">
        <p className="min-w-0 flex-1 text-[13px] font-semibold leading-snug">{t('title')}</p>
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className="h-11 w-11 shrink-0"
          disabled={strokes.length === 0}
          onClick={undo}
          aria-label={t('undo')}
          title={t('undo')}
        >
          <Undo2 className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
        </Button>
      </div>
      <p className="w-full text-[12px] leading-snug text-muted-foreground" aria-live="polite">
        {hint}
      </p>

      {/* The checker says "this is see-through" without a word of copy. It belongs to
          the stage rather than to the photo, so it stays put while the photo is
          dragged over it — which is also how you can tell that it *is* the photo
          moving. */}
      <div
        ref={stageEl}
        data-no-swipe
        tabIndex={0}
        role="application"
        aria-label={mode === 'erase' ? t('eraseArea') : t('restoreArea')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endGesture(e)}
        onPointerCancel={(e) => endGesture(e, true)}
        onPointerLeave={() => {
          if (!gesture.current) setCaret(null);
        }}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={onKeyDown}
        className={cn(
          'relative touch-none select-none overflow-hidden rounded-lg',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
        )}
        style={{
          width: displayed.width,
          height: displayed.height,
          cursor: tool === 'pan' ? 'grab' : 'crosshair',
          backgroundColor: 'hsl(var(--panel))',
          backgroundImage:
            'linear-gradient(45deg, rgba(128,128,128,0.22) 25%, transparent 25%, transparent 75%, rgba(128,128,128,0.22) 75%), linear-gradient(45deg, rgba(128,128,128,0.22) 25%, transparent 25%, transparent 75%, rgba(128,128,128,0.22) 75%)',
          backgroundSize: '16px 16px',
          backgroundPosition: '0 0, 8px 8px',
        }}
      >
        {broken ? (
          <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-[13px] text-muted-foreground">
            {t('noPreview')}
          </p>
        ) : (
          <div
            className="absolute left-0 top-0"
            style={{
              width: displayed.width,
              height: displayed.height,
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
              transformOrigin: '0 0',
            }}
          >
            <canvas
              ref={canvas}
              width={previewSize.width}
              height={previewSize.height}
              aria-hidden
              className="block h-full w-full"
            />
            {mask && (
              <svg
                viewBox={`0 0 ${mask.width} ${mask.height}`}
                preserveAspectRatio="none"
                className="pointer-events-none absolute left-0 top-0 h-full w-full"
                aria-hidden
              >
                {/* White over black, so the outline reads over a white shirt and over
                    a black one, in either theme. */}
                {liveBox && (
                  <rect
                    x={liveBox.x}
                    y={liveBox.y}
                    width={liveBox.width}
                    height={liveBox.height}
                    fill={regionFill}
                    stroke="#fff"
                    strokeWidth={2}
                    strokeDasharray="7 5"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {region?.shape === 'lasso' && region.points.length > 1 && (
                  <polygon
                    points={region.points.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill={regionFill}
                    stroke="#fff"
                    strokeWidth={2}
                    strokeDasharray="7 5"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {ring && (
                  <>
                    <circle
                      cx={ring.x}
                      cy={ring.y}
                      r={brush / 2}
                      fill="none"
                      stroke="#000"
                      strokeOpacity={0.55}
                      strokeWidth={3.5}
                      vectorEffect="non-scaling-stroke"
                    />
                    <circle
                      cx={ring.x}
                      cy={ring.y}
                      r={brush / 2}
                      fill="none"
                      stroke="#fff"
                      strokeWidth={1.5}
                      vectorEffect="non-scaling-stroke"
                    />
                  </>
                )}
              </svg>
            )}
          </div>
        )}
      </div>

      {/* Zoom, and the undo that used to hide beside the brush slider. Kept on its
          own row above the tools so that "how do I get closer" is answered without
          knowing about pinch. */}
      <div className="flex w-full flex-wrap items-center gap-1.5" data-no-swipe>
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className="h-11 w-11 shrink-0"
          onClick={() => zoomBy(1 / ZOOM_STEP)}
          disabled={!mask || view.zoom <= MIN_ZOOM}
          aria-label={t('zoomOut')}
          title={t('zoomOut')}
        >
          <Minus className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
        </Button>
        {/* Wide enough that "100%" and "256%" do not shove the buttons about, in
            pixels rather than rem: at 125% font the whole row was 55px-wide buttons
            plus a 70px label and the undo button ran off the edge of the panel. */}
        <span
          className="min-w-[48px] shrink-0 text-center text-[12px] font-semibold tabular-nums"
          aria-live="polite"
        >
          {t('zoomLevel', { percent: Math.round(view.zoom * 100) })}
        </span>
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className="h-11 w-11 shrink-0"
          onClick={() => zoomBy(ZOOM_STEP)}
          disabled={!mask || view.zoom >= MAX_ZOOM}
          aria-label={t('zoomIn')}
          title={t('zoomIn')}
        >
          <Plus className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className="h-11 w-11 shrink-0"
          onClick={() => setView(FIT_VIEW)}
          disabled={!zoomed}
          aria-label={t('zoomFit')}
          title={t('zoomFit')}
        >
          <Maximize2 className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
        </Button>
      </div>

      {/* What a gesture does. A two-up pair that splits the row evenly rather than
          competing with anything else for it — at 320px and at 125% font "Devolver"
          was being truncated to "Devo…", which is not a word. */}
      <div className="w-full">
        <p className="mb-1 text-[12px] text-muted-foreground" id="brush-action-label">
          {t('action')}
        </p>
        <div
          className="flex w-full flex-wrap gap-2"
          role="group"
          aria-labelledby="brush-action-label"
        >
          <Button
            type="button"
            variant={mode === 'erase' ? 'default' : 'secondary'}
            aria-pressed={mode === 'erase'}
            className="h-11 min-w-0 flex-1 basis-[8rem] px-2"
            onClick={() => setMode('erase')}
          >
            <Eraser className="h-[18px] w-[18px] shrink-0" strokeWidth={2} aria-hidden />
            <span className="min-w-0 truncate">{t('erase')}</span>
          </Button>
          {canRestore && (
            <Button
              type="button"
              variant={mode === 'restore' ? 'default' : 'secondary'}
              aria-pressed={mode === 'restore'}
              className="h-11 min-w-0 flex-1 basis-[8rem] px-2"
              onClick={() => setMode('restore')}
            >
              <PaintBucket className="h-[18px] w-[18px] shrink-0" strokeWidth={2} aria-hidden />
              <span className="min-w-0 truncate">{t('restore')}</span>
            </Button>
          )}
        </div>
      </div>

      {/* How it covers ground. Two by two at 320px, one row when there is space. */}
      <div className="w-full">
        <p className="mb-1 text-[12px] text-muted-foreground" id="brush-tool-label">
          {t('tool')}
        </p>
        <div
          className="flex w-full flex-wrap gap-2"
          role="group"
          aria-labelledby="brush-tool-label"
        >
          {toolButton(
            'brush',
            <Eraser className="h-[18px] w-[18px] shrink-0" strokeWidth={2} aria-hidden />,
            t('toolBrush')
          )}
          {toolButton(
            'lasso',
            <Lasso className="h-[18px] w-[18px] shrink-0" strokeWidth={2} aria-hidden />,
            t('toolLasso')
          )}
          {toolButton(
            'rect',
            <Square className="h-[18px] w-[18px] shrink-0" strokeWidth={2} aria-hidden />,
            t('toolRect')
          )}
          {toolButton(
            'pan',
            <Hand className="h-[18px] w-[18px] shrink-0" strokeWidth={2} aria-hidden />,
            t('toolPan')
          )}
        </div>
      </div>

      {/* Only the brush has a thickness, so the slider is only there for the brush —
          a disabled control nobody can explain is worse than no control. */}
      {tool === 'brush' && (
        <div className="w-full" data-no-swipe>
          <p className="mb-1 text-[12px] text-muted-foreground" id="brush-size-label">
            {t('brushSize')}
          </p>
          <Slider
            aria-label={t('brushSize')}
            min={0}
            max={1}
            step={0.01}
            value={[sizePosition]}
            disabled={!mask}
            onValueChange={([value]) => setSizePosition(value)}
          />
        </div>
      )}

      {/* "Volver al automático" is a bigger, rarer decision than the others — it
          throws away every edit ever made to this garment, not just this session's —
          so it sits on its own line above them rather than beside "Guardar". */}
      {canReset && onReset && (
        <Button
          type="button"
          variant="secondary"
          className="w-full min-w-0"
          onClick={onReset}
          disabled={busy || resetting}
        >
          {resetting ? (
            <Loader2
              className="h-[18px] w-[18px] shrink-0 animate-spin motion-reduce:animate-none"
              aria-hidden
            />
          ) : (
            <RotateCcw className="h-[18px] w-[18px] shrink-0" strokeWidth={2} aria-hidden />
          )}
          <span className="min-w-0 truncate">{t('reset')}</span>
        </Button>
      )}

      <div className="grid w-full grid-cols-2 gap-2">
        <Button
          type="button"
          variant="ghost"
          className="min-w-0 px-2"
          onClick={onCancel}
          disabled={busy}
        >
          <span className="min-w-0 truncate">{t('cancel')}</span>
        </Button>
        <Button type="button" className="min-w-0 px-2" onClick={apply} disabled={!painted || busy}>
          {busy ? (
            <Loader2
              className="h-[18px] w-[18px] shrink-0 animate-spin motion-reduce:animate-none"
              aria-hidden
            />
          ) : (
            <Check className="h-[18px] w-[18px] shrink-0" strokeWidth={2} aria-hidden />
          )}
          <span className="min-w-0 truncate">{t('apply')}</span>
        </Button>
      </div>

      <p className="w-full text-[12px] leading-snug text-muted-foreground">{t('zoomHint')}</p>
      <p className="w-full text-[12px] leading-snug text-muted-foreground">{t('keyboardHint')}</p>
    </div>
  );
}
