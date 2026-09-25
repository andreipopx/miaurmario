'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Pipette, X, Check, Loader2, AlertCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getErrorMessage } from '@/lib/api';
import { CLOTHING_COLORS } from '@/lib/types';
import { nearestClothingColor } from '@/lib/colors';
import { useColorLabel } from '@/lib/tag-labels';

interface ColorEyedropperProps {
  imageUrl: string;
  /**
   * The named colour the pick snapped to, plus the exact shade that was sampled.
   * Callers store the name (that is what the stylist reasons on) and may keep the
   * hex so the swatch shows the user's real brown rather than the palette's.
   */
  onColorSelect: (color: string, hex: string) => void;
  trigger?: React.ReactNode;
  /** Class for the wrapper around a custom `trigger`, which is a real button. */
  triggerClassName?: string;
  /** Accessible name for a custom `trigger`, which is usually just an image. */
  triggerLabel?: string;
  disabled?: boolean;
}

/**
 * A preview the browser already holds (a `data:`/`blob:` URL from the file the
 * user just picked) must not go through a credentialed fetch: Safari rejects
 * `credentials: 'include'` on those schemes outright. Load them straight.
 */
function isLocalSource(url: string): boolean {
  return url.startsWith('data:') || url.startsWith('blob:');
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

type ClothingColor = (typeof CLOTHING_COLORS)[number];

// Snap to the canonical palette with the same perceptual (CIEDE2000) match
// the colour-preference wheel uses.
function findClosestColor(hex: string): ClothingColor {
  const value = nearestClothingColor(hex);
  return CLOTHING_COLORS.find((c) => c.value === value) ?? CLOTHING_COLORS[0];
}

export function ColorEyedropper({
  imageUrl,
  onColorSelect,
  trigger,
  triggerClassName,
  triggerLabel,
  disabled,
}: ColorEyedropperProps) {
  const t = useTranslations('color.eyedropper');
  const colorLabel = useColorLabel();
  const [open, setOpen] = useState(false);
  const [pickedColor, setPickedColor] = useState<string | null>(null);
  const [matchedColor, setMatchedColor] = useState<ClothingColor | null>(null);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [hoverColor, setHoverColor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
      }
    };
  }, []);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setIsLoading(true);
      setError(null);
      setImageLoaded(false);
      setPickedColor(null);
      setMatchedColor(null);
    }
  }, [open]);

  // Load image onto canvas when dialog opens and canvas is ready
  useEffect(() => {
    if (!open || imageLoaded) return;

    // Small delay to ensure canvas is mounted
    const timer = setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) {
        setError(t('canvasUnavailable'));
        setIsLoading(false);
        return;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setError(t('contextUnavailable'));
        setIsLoading(false);
        return;
      }

      const draw = (source: string) => {
          const img = new Image();
          img.onload = () => {
            imageRef.current = img;

            // Scale image to fit canvas while maintaining aspect ratio
            const maxWidth = 500;
            const maxHeight = 500;
            let width = img.width;
            let height = img.height;

            if (width > maxWidth) {
              height = (height * maxWidth) / width;
              width = maxWidth;
            }
            if (height > maxHeight) {
              width = (width * maxHeight) / height;
              height = maxHeight;
            }

            canvas.width = width;
            canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);
            setIsLoading(false);
            setImageLoaded(true);
          };
          img.onerror = () => {
            setError(t('loadFailedBlob'));
            setIsLoading(false);
          };
          img.src = source;
      };

      // A photo the user just picked is already in this page, so draw it
      // directly. Anything on the server has to come through a credentialed
      // fetch and a blob URL, or the canvas ends up tainted and unreadable.
      if (isLocalSource(imageUrl)) {
        draw(imageUrl);
        return;
      }

      fetch(imageUrl, { credentials: 'include' })
        .then(response => {
          if (!response.ok) throw new Error(t('loadFailedStatus', { status: response.status }));
          return response.blob();
        })
        .then(blob => {
          // Cleanup previous blob URL
          if (blobUrlRef.current) {
            URL.revokeObjectURL(blobUrlRef.current);
          }
          const blobUrl = URL.createObjectURL(blob);
          blobUrlRef.current = blobUrl;
          draw(blobUrl);
        })
        .catch(err => {
          setError(getErrorMessage(err, t('loadFailedGeneric')));
          setIsLoading(false);
        });
    }, 100); // Small delay to ensure DOM is ready

    return () => clearTimeout(timer);
  }, [open, imageUrl, imageLoaded]);

  const getColorAtPosition = useCallback((x: number, y: number): string | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    try {
      const pixel = ctx.getImageData(x, y, 1, 1).data;
      return rgbToHex(pixel[0], pixel[1], pixel[2]);
    } catch {
      return null;
    }
  }, []);

  const handleCanvasMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) * (canvas.width / rect.width));
    const y = Math.floor((e.clientY - rect.top) * (canvas.height / rect.height));

    setCursorPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    const color = getColorAtPosition(x, y);
    setHoverColor(color);
  }, [getColorAtPosition]);

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) * (canvas.width / rect.width));
    const y = Math.floor((e.clientY - rect.top) * (canvas.height / rect.height));

    const color = getColorAtPosition(x, y);
    if (color) {
      setPickedColor(color);
      setMatchedColor(findClosestColor(color));
    }
  }, [getColorAtPosition]);

  const handleConfirm = () => {
    if (matchedColor && pickedColor) {
      // The name is the family everything downstream works on; the hex is the
      // shade the user actually pointed at, so the swatch can show it.
      onColorSelect(matchedColor.value, pickedColor);
      setOpen(false);
      setPickedColor(null);
      setMatchedColor(null);
    }
  };

  const handleCanvasLeave = () => {
    setCursorPos(null);
    setHoverColor(null);
  };

  return (
    <>
      {trigger ? (
        // A real button, not a div with onClick: on the review grid the trigger
        // *is* the garment photo, and tapping a photo has to work from the
        // keyboard too.
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={triggerClassName}
          aria-label={triggerLabel ?? t('buttonTitle')}
          disabled={disabled}
        >
          {trigger}
        </button>
      ) : (
        <Button
          type="button"
          variant="secondary"
          size="icon"
          onClick={() => setOpen(true)}
          disabled={disabled}
          title={t('buttonTitle')}
          aria-label={t('buttonTitle')}
        >
          <Pipette className="h-4 w-4" strokeWidth={1.75} />
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-pop-sky text-pop-foreground">
                <Pipette className="h-4 w-4" strokeWidth={1.75} />
              </span>
              {t('dialogTitle')}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t('instructions')}
            </p>

            <div className="relative flex min-h-[200px] justify-center rounded-tile bg-panel p-3">
              {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              )}

              {error && (
                <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center text-destructive">
                  <AlertCircle className="h-8 w-8" strokeWidth={1.75} />
                  <span className="text-sm font-medium">{error}</span>
                </div>
              )}

              <canvas
                ref={canvasRef}
                className={`max-w-full cursor-crosshair rounded-[14px] ${isLoading || error ? 'invisible' : ''}`}
                onMouseMove={handleCanvasMove}
                onMouseLeave={handleCanvasLeave}
                onClick={handleCanvasClick}
              />

              {/* Hover preview */}
              {!isLoading && !error && cursorPos && hoverColor && (
                <div
                  className="glass-dock pointer-events-none absolute z-10 flex items-center gap-2 rounded-full py-1 pl-1 pr-3"
                  style={{
                    left: Math.min(cursorPos.x + 20, 400),
                    top: Math.max(cursorPos.y - 30, 10),
                  }}
                >
                  <div
                    className="h-6 w-6 rounded-full ring-1 ring-inset ring-black/10"
                    style={{ backgroundColor: hoverColor }}
                  />
                  <span className="text-xs font-semibold tabular-nums">{hoverColor}</span>
                </div>
              )}
            </div>

            {/* Selected color display */}
            {pickedColor && matchedColor && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-panel p-3">
                <div className="flex items-center gap-3">
                  <div className="flex flex-col items-center gap-1">
                    <div
                      className="h-10 w-10 rounded-full ring-1 ring-inset ring-black/10"
                      style={{ backgroundColor: pickedColor }}
                    />
                    <span className="text-xs text-muted-foreground">{t('pickedLabel')}</span>
                  </div>
                  <div aria-hidden className="text-muted-foreground">&rarr;</div>
                  <div className="flex flex-col items-center gap-1">
                    <div
                      className="h-10 w-10 rounded-full ring-1 ring-inset ring-black/10"
                      style={{ backgroundColor: matchedColor.hex }}
                    />
                    <span className="text-xs font-bold">{colorLabel(matchedColor.value)}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setPickedColor(null);
                      setMatchedColor(null);
                    }}
                  >
                    <X className="h-4 w-4" strokeWidth={1.75} />
                    {t('clear')}
                  </Button>
                  <Button onClick={handleConfirm}>
                    <Check className="h-4 w-4" strokeWidth={2} />
                    {t('useName', { name: colorLabel(matchedColor.value) })}
                  </Button>
                </div>
              </div>
            )}

            {!pickedColor && (
              <div className="py-2 text-center text-sm text-muted-foreground">
                {t('noneSelected')}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
