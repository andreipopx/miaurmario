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
import { CLOTHING_COLORS } from '@/lib/types';

interface ColorEyedropperProps {
  imageUrl: string;
  onColorSelect: (color: string) => void;
  trigger?: React.ReactNode;
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h: h * 360, s, l };
}

function colorDistance(hex1: string, hex2: string): number {
  const rgb1 = hexToRgb(hex1);
  const rgb2 = hexToRgb(hex2);
  const hsl1 = rgbToHsl(rgb1.r, rgb1.g, rgb1.b);
  const hsl2 = rgbToHsl(rgb2.r, rgb2.g, rgb2.b);

  const saturationPenalty = Math.abs(hsl1.s - hsl2.s) * 100;
  let hueDiff = Math.abs(hsl1.h - hsl2.h);
  if (hueDiff > 180) hueDiff = 360 - hueDiff;

  const hueWeight = Math.min(hsl1.s, hsl2.s) * 2;
  const hueDistance = hueDiff * hueWeight;
  const rgbDistance = Math.sqrt(
    (rgb1.r - rgb2.r) ** 2 +
    (rgb1.g - rgb2.g) ** 2 +
    (rgb1.b - rgb2.b) ** 2
  );

  return rgbDistance + saturationPenalty + hueDistance;
}

type ClothingColor = (typeof CLOTHING_COLORS)[number];

function findClosestColor(hex: string): ClothingColor {
  let closestIndex = 0;
  let minDistance = Infinity;

  for (let i = 0; i < CLOTHING_COLORS.length; i++) {
    const distance = colorDistance(hex, CLOTHING_COLORS[i].hex);
    if (distance < minDistance) {
      minDistance = distance;
      closestIndex = i;
    }
  }

  return CLOTHING_COLORS[closestIndex];
}

export function ColorEyedropper({ imageUrl, onColorSelect, trigger }: ColorEyedropperProps) {
  const t = useTranslations('color.eyedropper');
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

      // Fetch image as blob to avoid CORS issues with canvas
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
          img.src = blobUrl;
        })
        .catch(err => {
          setError(err.message || t('loadFailedGeneric'));
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
    if (matchedColor) {
      onColorSelect(matchedColor.value);
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
        <div onClick={() => setOpen(true)}>{trigger}</div>
      ) : (
        <Button
          type="button"
          variant="secondary"
          size="icon"
          onClick={() => setOpen(true)}
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
                    <span className="text-xs font-bold">{matchedColor.name}</span>
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
                    {t('useName', { name: matchedColor.name })}
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
