'use client';

/* eslint-disable @next/next/no-img-element -- a local object URL being cropped */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';

import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import {
  CROP_PRESETS,
  MAX_ZOOM,
  centred,
  clampFrame,
  clampOffset,
  cropRect,
  frameFor,
  presetRatio,
  scaleFor,
  turnedSize,
  zoomAt,
  type CropPreset,
  type CropRect,
  type CropState,
  type ImageSize,
  type Viewport,
} from '@/lib/image-crop';

export type { CropRect };

/**
 * Drag to move, pinch / wheel / slider to zoom, and a frame you can reshape.
 *
 * The interaction is the one written for the profile photo, widened so it can
 * frame a garment: the frame is a rectangle rather than a fixed square, so long
 * trousers and wide shoes can both be cropped properly, and it can be turned in
 * quarter steps by the caller (`quarters`) because a photo that arrives sideways
 * has to be straightened before it can be framed.
 *
 * Everything reported back is in pixels of the image *as displayed* — after the
 * quarter turns — which is the order the server applies them in.
 *
 * `onChange(null)` means "I cannot measure this photo" (HEIC outside Safari, a
 * broken file): the caller then sends no crop and the whole photo is kept.
 */
export function ImageCropper({
  src,
  shape = 'rect',
  quarters = 0,
  maxStage = 320,
  showPresets = true,
  initialPreset = 'free',
  onChange,
  className,
}: {
  src: string;
  /** `circle` is the profile-photo mask: a square frame with a round cut-out. */
  shape?: 'rect' | 'circle';
  /** Quarter turns clockwise the caller has applied to the photo. */
  quarters?: number;
  maxStage?: number;
  showPresets?: boolean;
  initialPreset?: CropPreset;
  onChange: (crop: CropRect | null) => void;
  className?: string;
}) {
  const t = useTranslations('imageCrop');
  const circle = shape === 'circle';

  const [img, setImg] = useState<ImageSize | null>(null);
  const [broken, setBroken] = useState(false);
  const [preset, setPreset] = useState<CropPreset>(circle ? 'square' : initialPreset);
  const [stage, setStage] = useState<Viewport>({ width: maxStage, height: maxStage });
  const [frame, setFrame] = useState<Viewport>({ width: maxStage, height: maxStage });
  const [state, setState] = useState<CropState>({ x: 0, y: 0, zoom: 1 });

  const wrapper = useRef<HTMLDivElement>(null);
  const stageEl = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const resizing = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  /** The photo as the user sees it: a quarter turn swaps its sides. */
  const display = img ? turnedSize(img, quarters) : null;

  // The stage is as wide as the dialog allows, so the same component works at
  // 320 px and on a desktop without two sets of numbers.
  useLayoutEffect(() => {
    const el = wrapper.current;
    if (!el) return;
    const measure = () => {
      const width = Math.max(160, Math.min(maxStage, el.clientWidth || maxStage));
      setStage((prev) => (prev.width === width ? prev : { width, height: width }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [maxStage]);

  // A new file is a new crop: forget everything and tell the caller we have nothing yet.
  useEffect(() => {
    setImg(null);
    setBroken(false);
    onChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the file changes
  }, [src]);

  /** Put the frame where the preset says and centre the photo in it. */
  const layOut = useCallback(
    (size: ImageSize, nextPreset: CropPreset, nextStage: Viewport) => {
      const next = frameFor(nextStage, presetRatio(nextPreset, size));
      setFrame(next);
      setState(centred(size, next));
    },
    []
  );

  // Rotating or reshaping invalidates the framing, so both start again from centred.
  useEffect(() => {
    if (display) layOut(display, preset, stage);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `display` is derived from img + quarters
  }, [img, quarters, preset, stage.width, layOut]);

  useEffect(() => {
    if (display) onChange(cropRect(display, frame, state));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `display` is derived from img + quarters
  }, [img, quarters, frame, state, onChange]);

  const update = useCallback(
    (fn: (prev: CropState) => CropState) => {
      if (!display) return;
      setState((prev) => clampOffset(display, frame, fn(prev)));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- display is derived
    [img, quarters, frame]
  );

  const setZoom = useCallback(
    (zoom: number, fx?: number, fy?: number) => {
      if (!display) return;
      setState((prev) => zoomAt(display, frame, prev, zoom, fx, fy));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- display is derived
    [img, quarters, frame]
  );

  const resizeFrame = useCallback(
    (next: Viewport) => {
      const clamped = clampFrame(stage, next);
      setFrame(clamped);
      if (display) setState((prev) => clampOffset(display, clamped, prev));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- display is derived
    [img, quarters, stage]
  );

  // Wheel zoom needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const el = stageEl.current;
    if (!el || !display) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      setState((prev) =>
        zoomAt(
          display,
          frame,
          prev,
          prev.zoom * Math.exp(-e.deltaY / 400),
          e.clientX - rect.left - (stage.width - frame.width) / 2,
          e.clientY - rect.top - (stage.height - frame.height) / 2
        )
      );
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- display is derived
  }, [img, quarters, frame, stage]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = Array.from(pointers.current.values());
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: state.zoom };
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, next);
    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = Array.from(pointers.current.values());
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const rect = e.currentTarget.getBoundingClientRect();
      setZoom(
        pinch.current.zoom * (dist / Math.max(pinch.current.dist, 1)),
        (a.x + b.x) / 2 - rect.left - (stage.width - frame.width) / 2,
        (a.y + b.y) / 2 - rect.top - (stage.height - frame.height) / 2
      );
      return;
    }
    update((s) => ({ ...s, x: s.x + (next.x - prev.x), y: s.y + (next.y - prev.y) }));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  const onHandleDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    resizing.current = { x: e.clientX, y: e.clientY, ...frame };
  };

  const onHandleMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const from = resizing.current;
    if (!from) return;
    e.stopPropagation();
    // The frame is centred, so it grows from both sides at once.
    resizeFrame({
      width: from.width + (e.clientX - from.x) * 2,
      height: from.height + (e.clientY - from.y) * 2,
    });
  };

  const onHandleUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    resizing.current = null;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 20 : 5;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    // Alt + arrows reshape the frame, so free cropping is not mouse-only.
    if (e.altKey && !circle && moves[e.key]) {
      e.preventDefault();
      const grow = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? step * 2 : -step * 2;
      const horizontal = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
      resizeFrame({
        width: frame.width + (horizontal ? grow : 0),
        height: frame.height + (horizontal ? 0 : grow),
      });
      return;
    }
    if (moves[e.key]) {
      e.preventDefault();
      const [dx, dy] = moves[e.key];
      update((s) => ({ ...s, x: s.x + dx, y: s.y + dy }));
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      setZoom(state.zoom * 1.1);
    } else if (e.key === '-') {
      e.preventDefault();
      setZoom(state.zoom / 1.1);
    }
  };

  const scale = display ? scaleFor(display, frame, state.zoom) : 1;
  const frameLeft = (stage.width - frame.width) / 2;
  const frameTop = (stage.height - frame.height) / 2;

  return (
    <div ref={wrapper} className={cn('flex w-full flex-col items-center gap-3', className)}>
      <div
        ref={stageEl}
        data-no-swipe
        data-testid="image-cropper"
        role="group"
        tabIndex={0}
        aria-label={t('area')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        className="relative cursor-grab touch-none select-none overflow-hidden rounded-lg bg-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:cursor-grabbing"
        style={{ width: stage.width, height: stage.height }}
      >
        {/* The photo, positioned from the frame's top-left corner and free to
            spill over the dimmed surround so the user can see what they are cutting. */}
        <div className="absolute" style={{ left: frameLeft, top: frameTop }}>
          {!broken && (
            <div
              className="absolute left-0 top-0 origin-top-left"
              style={
                display
                  ? {
                      width: display.width,
                      height: display.height,
                      transform: `translate(${state.x}px, ${state.y}px) scale(${scale})`,
                    }
                  : { opacity: 0 }
              }
            >
              <img
                src={src}
                alt=""
                draggable={false}
                onLoad={(e) => {
                  const el = e.currentTarget;
                  const size = { width: el.naturalWidth, height: el.naturalHeight };
                  if (!size.width || !size.height) {
                    setBroken(true);
                    return;
                  }
                  setImg(size);
                }}
                onError={() => setBroken(true)}
                className="pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none"
                style={
                  img
                    ? {
                        width: img.width,
                        height: img.height,
                        transform: `translate(-50%, -50%) rotate(${quarters * 90}deg)`,
                      }
                    : { opacity: 0 }
                }
              />
            </div>
          )}
        </div>

        {broken && (
          <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">
            {t('noPreview')}
          </p>
        )}

        {/* Everything outside the frame is dimmed by one enormous shadow. */}
        <div
          aria-hidden
          className={cn('pointer-events-none absolute', circle ? 'rounded-full' : 'rounded-md')}
          style={{
            left: frameLeft,
            top: frameTop,
            width: frame.width,
            height: frame.height,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
          }}
        />
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute ring-2 ring-white/80',
            circle ? 'rounded-full' : 'rounded-md'
          )}
          style={{ left: frameLeft, top: frameTop, width: frame.width, height: frame.height }}
        />

        {!circle && (
          <button
            type="button"
            aria-label={t('resize')}
            title={t('resize')}
            onPointerDown={onHandleDown}
            onPointerMove={onHandleMove}
            onPointerUp={onHandleUp}
            onPointerCancel={onHandleUp}
            onClick={(e) => e.preventDefault()}
            className="absolute flex h-11 w-11 touch-none items-center justify-center rounded-full text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            style={{
              left: frameLeft + frame.width - 22,
              top: frameTop + frame.height - 22,
            }}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/55 shadow-sm">
              <Maximize2 className="h-3.5 w-3.5 rotate-90" strokeWidth={2.5} aria-hidden />
            </span>
          </button>
        )}
      </div>

      <div className="flex w-full items-center gap-3" style={{ maxWidth: stage.width }} data-no-swipe>
        <ZoomOut className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
        <Slider
          aria-label={t('zoom')}
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          value={[state.zoom]}
          disabled={!img}
          onValueChange={([z]) => setZoom(z)}
        />
        <ZoomIn className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
      </div>

      {showPresets && !circle && (
        <div
          role="group"
          aria-label={t('shape')}
          className="flex w-full flex-wrap justify-center gap-1.5"
          data-no-swipe
        >
          {CROP_PRESETS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={preset === option}
              onClick={() => setPreset(option)}
              disabled={!img}
              className={cn(
                'min-h-[40px] rounded-full px-3 text-[13px] font-semibold transition-colors disabled:opacity-50',
                preset === option
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-panel text-foreground hover:bg-secondary'
              )}
            >
              {t(`presets.${option}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
