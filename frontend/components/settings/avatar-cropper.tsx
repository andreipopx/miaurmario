'use client';

/* eslint-disable @next/next/no-img-element -- local object URL being cropped */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import {
  MAX_ZOOM,
  centred,
  clampOffset,
  cropBox,
  scaleFor,
  zoomAt,
  type CropState,
  type ImageSize,
} from '@/lib/avatar-crop';

export interface CropResult {
  x: number;
  y: number;
  size: number;
}

/**
 * Lightweight circle crop: drag to move, pinch / wheel / slider to zoom.
 * Reports the kept square in image pixels via `onChange` (null while the image
 * can't be decoded, e.g. HEIC outside Safari — the server then centre-crops).
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
  const t = useTranslations('settings.avatar');
  const [img, setImg] = useState<ImageSize | null>(null);
  const [state, setState] = useState<CropState>({ x: 0, y: 0, zoom: 1 });
  const [broken, setBroken] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const frame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setImg(null);
    setBroken(false);
    onChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the file changes
  }, [src]);

  useEffect(() => {
    if (img) onChange(cropBox(img, view, state));
  }, [img, view, state, onChange]);

  const update = useCallback(
    (fn: (prev: CropState) => CropState) => {
      if (!img) return;
      setState((prev) => clampOffset(img, view, fn(prev)));
    },
    [img, view]
  );

  const setZoom = useCallback(
    (zoom: number, fx?: number, fy?: number) => {
      if (!img) return;
      setState((prev) => zoomAt(img, view, prev, zoom, fx, fy));
    },
    [img, view]
  );

  // Wheel zoom needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const el = frame.current;
    if (!el || !img) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      setState((prev) =>
        zoomAt(img, view, prev, prev.zoom * Math.exp(-e.deltaY / 400), e.clientX - rect.left, e.clientY - rect.top)
      );
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [img, view]);

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
        (a.x + b.x) / 2 - rect.left,
        (a.y + b.y) / 2 - rect.top
      );
      return;
    }
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    update((s) => ({ ...s, x: s.x + dx, y: s.y + dy }));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 20 : 5;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
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

  const scale = img ? scaleFor(img, view, state.zoom) : 1;

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        ref={frame}
        data-no-swipe
        role="group"
        tabIndex={0}
        aria-label={t('cropArea')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        className="relative cursor-grab touch-none select-none overflow-hidden rounded-lg bg-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:cursor-grabbing"
        style={{ width: view, height: view }}
      >
        {!broken && (
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
              setState(centred(size, view));
            }}
            onError={() => setBroken(true)}
            className="pointer-events-none absolute left-0 top-0 max-w-none origin-top-left select-none"
            style={
              img
                ? {
                    width: img.width,
                    height: img.height,
                    transform: `translate(${state.x}px, ${state.y}px) scale(${scale})`,
                  }
                : { opacity: 0 }
            }
          />
        )}
        {broken && (
          <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">
            {t('noPreview')}
          </p>
        )}
        {/* Circle mask: everything outside the circle is dimmed. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)' }}
        />
        <div aria-hidden className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-white/80" />
      </div>

      <div className="flex w-full max-w-[260px] items-center gap-3" data-no-swipe>
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
    </div>
  );
}
