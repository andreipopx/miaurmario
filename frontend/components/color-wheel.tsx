'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Slider } from '@/components/ui/slider';
import { hslToRgb, rgbToHex } from '@/lib/colors';

interface ColorWheelProps {
  /** Emits the picked colour as #rrggbb. */
  onChange: (hex: string) => void;
  size?: number;
  label: string;
  lightnessLabel: string;
}

interface Hsl {
  h: number;
  s: number;
  l: number;
}

const INITIAL_HSL: Hsl = { h: 20, s: 0.7, l: 0.5 };
/** The colour the wheel starts on, so callers can preview it before any pick. */
export const COLOR_WHEEL_INITIAL_HEX = rgbToHex(hslToRgb(INITIAL_HSL.h, INITIAL_HSL.s, INITIAL_HSL.l));

/**
 * Tiny dependency-free HSL colour wheel: hue around, saturation outwards,
 * lightness on a slider. Pointer (tap/drag) and keyboard (arrows: hue,
 * shift+arrows: saturation) both work.
 */
export function ColorWheel({ onChange, size = 208, label, lightnessLabel }: ColorWheelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hsl, setHsl] = useState<Hsl>(INITIAL_HSL);
  const dragging = useRef(false);
  const lightnessId = useId();

  const emit = useCallback(
    (next: Hsl) => {
      setHsl(next);
      onChange(rgbToHex(hslToRgb(next.h, next.s, next.l)));
    },
    [onChange]
  );

  // Paint the wheel for the current lightness.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext?.('2d');
    if (!canvas || !ctx) return;
    const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);
    const px = Math.round(size * dpr);
    canvas.width = px;
    canvas.height = px;
    const image = ctx.createImageData(px, px);
    const r = px / 2;
    for (let y = 0; y < px; y++) {
      for (let x = 0; x < px; x++) {
        const dx = x - r + 0.5;
        const dy = y - r + 0.5;
        const dist = Math.hypot(dx, dy);
        const i = (y * px + x) * 4;
        if (dist > r) {
          image.data[i + 3] = 0;
          continue;
        }
        const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
        const { r: cr, g, b } = hslToRgb(hue, dist / r, hsl.l);
        image.data[i] = cr;
        image.data[i + 1] = g;
        image.data[i + 2] = b;
        // Soft anti-aliased edge.
        image.data[i + 3] = dist > r - 1 ? Math.round(255 * (r - dist)) : 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  }, [hsl.l, size]);

  const pickAt = (clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    const radius = rect.width / 2;
    const h = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    const s = Math.min(1, Math.hypot(dx, dy) / radius);
    emit({ ...hsl, h, s });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 10;
    let next: Hsl | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      next = e.shiftKey
        ? { ...hsl, s: Math.min(1, hsl.s + step) }
        : { ...hsl, h: (hsl.h + step) % 360 };
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      next = e.shiftKey
        ? { ...hsl, s: Math.max(0, hsl.s - step) }
        : { ...hsl, h: (hsl.h - step + 360) % 360 };
    }
    if (next) {
      e.preventDefault();
      emit(next);
    }
  };

  // Marker position.
  const angle = (hsl.h * Math.PI) / 180;
  const markerX = size / 2 + Math.cos(angle) * hsl.s * (size / 2);
  const markerY = size / 2 + Math.sin(angle) * hsl.s * (size / 2);
  const hex = rgbToHex(hslToRgb(hsl.h, hsl.s, hsl.l));

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsl.h)}
        aria-valuetext={hex}
        onKeyDown={onKeyDown}
        className="relative touch-none rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4"
        style={{ width: size, height: size }}
        onPointerDown={(e) => {
          dragging.current = true;
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          pickAt(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (dragging.current) pickAt(e.clientX, e.clientY);
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
      >
        <canvas
          ref={canvasRef}
          aria-hidden
          className="h-full w-full rounded-full ring-1 ring-inset ring-black/10 dark:ring-white/15"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow-[0_0_0_1.5px_rgba(0,0,0,0.45)]"
          style={{ left: markerX, top: markerY, backgroundColor: hex }}
        />
      </div>
      <div className="w-full max-w-[240px] space-y-2">
        <p className="text-[13px] font-semibold text-muted-foreground" id={lightnessId}>
          {lightnessLabel}
        </p>
        <Slider
          aria-labelledby={lightnessId}
          value={[Math.round(hsl.l * 100)]}
          min={10}
          max={90}
          step={1}
          onValueChange={(vals) => emit({ ...hsl, l: vals[0] / 100 })}
        />
      </div>
    </div>
  );
}
