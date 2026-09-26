'use client';

/* eslint-disable @next/next/no-img-element -- measured off a signed URL, not laid out */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Eraser, Loader2, PaintBucket, RotateCcw, Undo2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { turnedSize, type ImageSize } from '@/lib/image-crop';
import {
  DEFAULT_BRUSH_FRACTION,
  brushSizeFor,
  hasPaint,
  pointIn,
  strokeColour,
  traceStroke,
  type BrushMode,
  type BrushPoint,
  type BrushStroke,
} from '@/lib/alpha-brush';
import { cn } from '@/lib/utils';

/** How many mask pixels the pointer must travel before another point is recorded. */
const MIN_STEP = 2;

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
  const [sizePosition, setSizePosition] = useState(DEFAULT_BRUSH_FRACTION * 2);
  const [strokes, setStrokes] = useState<BrushStroke[]>([]);
  const [stage, setStage] = useState(maxStage);
  /** The keyboard crosshair, in mask pixels; null until a key is pressed. */
  const [caret, setCaret] = useState<{ x: number; y: number } | null>(null);

  const wrapper = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const base = useRef<HTMLImageElement | null>(null);
  const restore = useRef<HTMLImageElement | null>(null);
  const painting = useRef<{ pointerId: number; stroke: BrushStroke } | null>(null);
  const [restoreReady, setRestoreReady] = useState(false);

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

  // A new photo is a new edit.
  useEffect(() => {
    setStrokes([]);
    setCaret(null);
    setNatural(null);
    setBroken(false);
    base.current = null;
  }, [src]);

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

  // The restore brush needs real pixels to paint back, so it is only offered when
  // we have them. Erasing always works.
  const canRestore = restoreReady;
  useEffect(() => {
    if (!canRestore && mode === 'restore') setMode('erase');
  }, [canRestore, mode]);

  /** Put the turned photo on the context, filling the canvas. */
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

  // Every committed change — a new stroke, an undo, the photo finishing loading,
  // the restore photo arriving — repaints from the photo up.
  useEffect(() => {
    const el = canvas.current;
    const photo = base.current;
    if (!el || !photo || !mask) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, el.width, el.height);
    drawPhoto(ctx, photo);
    paintStrokes(ctx, strokes);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- paintStrokes reads refs
  }, [drawPhoto, mask, strokes, restoreReady, natural]);

  /**
   * Paint a list of strokes onto the context, on top of whatever is already there.
   *
   * Erasing punches the canvas through, which is literally what the user asked for.
   * Restoring clips the stroke's outline and redraws the untouched photo inside it,
   * so it brings back exactly the pixels the server will.
   */
  const paintStrokes = (
    ctx: CanvasRenderingContext2D,
    list: readonly BrushStroke[],
    from = 0
  ) => {
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
        // A round-capped thick line as a clip path: the segments, plus a disc at
        // every point so a single tap and the caps are included too.
        if (stroke.points.length > 1) {
          ctx.lineWidth = stroke.size;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
          for (const point of stroke.points.slice(1)) ctx.lineTo(point.x, point.y);
          ctx.stroke();
          ctx.beginPath();
        }
        for (const point of stroke.points) {
          ctx.moveTo(point.x + stroke.size / 2, point.y);
          ctx.arc(point.x, point.y, stroke.size / 2, 0, Math.PI * 2);
        }
        ctx.clip();
        drawPhoto(ctx, restore.current);
        ctx.restore();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
  };

  /**
   * Repaint everything, including the stroke still under the finger.
   *
   * Restoring cannot be drawn one segment at a time without a clip per segment, so
   * a restore stroke repaints; an erase stroke just punches the new segment through.
   * At this size (a few hundred pixels either way) the full repaint is unnoticeable.
   */
  const repaintLive = () => {
    const live = painting.current;
    const el = canvas.current;
    const photo = base.current;
    if (!el || !photo || !mask) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, el.width, el.height);
    drawPhoto(ctx, photo);
    paintStrokes(ctx, live ? [...strokes, live.stroke] : strokes);
  };

  /** Extend the stroke in progress, and show it immediately. */
  const extend = (point: BrushPoint) => {
    const live = painting.current;
    const el = canvas.current;
    if (!live || !el) return;
    const points = live.stroke.points;
    const last = points[points.length - 1];
    if (last && Math.hypot(point.x - last.x, point.y - last.y) < MIN_STEP) return;
    points.push(point);
    const ctx = el.getContext('2d');
    if (!ctx) return;
    if (live.stroke.mode === 'erase') {
      paintStrokes(ctx, [live.stroke], Math.max(0, points.length - 2));
    } else {
      repaintLive();
    }
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!mask || busy) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointIn(
      event.currentTarget.getBoundingClientRect(),
      mask,
      event.clientX,
      event.clientY
    );
    painting.current = { pointerId: event.pointerId, stroke: { mode, size: brush, points: [point] } };
    setCaret(point);
    // A tap that never moves still has to leave a mark.
    const ctx = canvas.current?.getContext('2d');
    if (ctx) paintStrokes(ctx, [painting.current.stroke]);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const live = painting.current;
    if (!live || live.pointerId !== event.pointerId || !mask) return;
    event.preventDefault();
    extend(
      pointIn(event.currentTarget.getBoundingClientRect(), mask, event.clientX, event.clientY)
    );
  };

  const endStroke = () => {
    const live = painting.current;
    painting.current = null;
    if (!live || live.stroke.points.length === 0) return;
    setStrokes((current) => [...current, live.stroke]);
  };

  /** Arrows move a crosshair, Enter or Space puts a dab down. */
  const onKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (!mask) return;
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
      setStrokes((current) => [...current, { mode, size: brush, points: [at] }]);
    }
  };

  const undo = () => setStrokes((current) => current.slice(0, -1));

  const apply = () => {
    const el = canvas.current;
    if (!el || !mask || !hasPaint(strokes)) return;
    // The mask is built here rather than kept alongside: one pass over the strokes,
    // at the resolution the server expects, and nothing to keep in step.
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

  const displayed = mask
    ? mask.width >= mask.height
      ? { width: stage, height: Math.round((stage * mask.height) / mask.width) }
      : { width: Math.round((stage * mask.width) / mask.height), height: stage }
    : { width: stage, height: stage };

  const painted = hasPaint(strokes);

  return (
    <div ref={wrapper} className={cn('flex w-full flex-col items-center gap-3', className)}>
      <p className="w-full text-[13px] font-semibold leading-snug">{t('title')}</p>
      <p className="w-full text-[12px] leading-snug text-muted-foreground">
        {canRestore ? t('hint') : t('hintEraseOnly')}
      </p>

      {/* The checker says "this is see-through" without a word of copy. */}
      <div
        data-no-swipe
        className="relative overflow-hidden rounded-lg"
        style={{
          width: displayed.width,
          height: displayed.height,
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
          <canvas
            ref={canvas}
            width={mask?.width || 1}
            height={mask?.height || 1}
            tabIndex={0}
            role="img"
            aria-label={mode === 'erase' ? t('eraseArea') : t('restoreArea')}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endStroke}
            onPointerCancel={endStroke}
            onKeyDown={onKeyDown}
            className="h-full w-full touch-none select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            style={{ cursor: 'crosshair' }}
          />
        )}
        {caret && mask && (
          <span
            aria-hidden
            className="pointer-events-none absolute rounded-full border-2 border-signature"
            style={{
              left: `${(caret.x / mask.width) * 100}%`,
              top: `${(caret.y / mask.height) * 100}%`,
              width: (brush / mask.width) * displayed.width,
              height: (brush / mask.width) * displayed.width,
              transform: 'translate(-50%, -50%)',
            }}
          />
        )}
      </div>

      {/* Erase or restore. Two 44px targets, and the second one only when there is
          a photo to restore from. */}
      <div className="flex w-full flex-wrap items-center gap-2" role="group" aria-label={t('tools')}>
        <Button
          type="button"
          variant={mode === 'erase' ? 'default' : 'secondary'}
          aria-pressed={mode === 'erase'}
          className="h-11 min-w-0 flex-1"
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
            className="h-11 min-w-0 flex-1"
            onClick={() => setMode('restore')}
          >
            <PaintBucket className="h-[18px] w-[18px] shrink-0" strokeWidth={2} aria-hidden />
            <span className="min-w-0 truncate">{t('restore')}</span>
          </Button>
        )}
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

      <div className="flex w-full items-center gap-3" data-no-swipe>
        <span className="shrink-0 text-[12px] text-muted-foreground">{t('brushSize')}</span>
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

      <div className="flex w-full flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          variant="ghost"
          className="min-w-0 sm:flex-1"
          onClick={onCancel}
          disabled={busy}
        >
          <span className="min-w-0 truncate">{t('cancel')}</span>
        </Button>
        {canReset && onReset && (
          <Button
            type="button"
            variant="secondary"
            className="min-w-0 sm:flex-1"
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
        <Button
          type="button"
          className="min-w-0 sm:flex-1"
          onClick={apply}
          disabled={!painted || busy}
        >
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

      <p className="w-full text-[12px] leading-snug text-muted-foreground">{t('keyboardHint')}</p>
    </div>
  );
}
