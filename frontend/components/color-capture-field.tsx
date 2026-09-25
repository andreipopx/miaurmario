'use client';

import { useState } from 'react';
import { Check, Palette } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ColorEyedropper } from '@/components/color-eyedropper';
import { ColorWheel, COLOR_WHEEL_INITIAL_HEX } from '@/components/color-wheel';
import { nearestClothingColor, swatchHex } from '@/lib/colors';
import { useColorLabel } from '@/lib/tag-labels';
import { CLOTHING_COLORS } from '@/lib/types';

export interface ColorPick {
  /** The named family: the only part the stylist, the filters and the scorer see. */
  color: string;
  /** The exact shade, `#rrggbb`, or undefined when it came off the swatch list. */
  hex?: string;
}

interface ColorCaptureFieldProps {
  value: string;
  hex?: string | null;
  onPick: (pick: ColorPick) => void;
  /** The garment photo to sample from; without one there is nothing to tap. */
  imageUrl?: string | null;
  id?: string;
}

/**
 * "What colour is this?" answered three ways, on one line: pick a name, tap the
 * photo, or turn a wheel.
 *
 * Whichever way it is answered, the answer stored is a *named* colour — the
 * families the tagger and the stylist share — plus, when the user pointed at a
 * real colour rather than choosing a name, the exact shade so the swatch can
 * show their brown instead of the palette's brown. Picking a name off the list
 * drops the shade, because the name is then all the user actually said.
 */
export function ColorCaptureField({
  value,
  hex,
  onPick,
  imageUrl,
  id,
}: ColorCaptureFieldProps) {
  const t = useTranslations('color.capture');
  const colorLabel = useColorLabel();
  const [wheelOpen, setWheelOpen] = useState(false);
  const [wheelHex, setWheelHex] = useState(COLOR_WHEEL_INITIAL_HEX);

  const shown = swatchHex(value, hex);
  const wheelMatch = nearestClothingColor(wheelHex);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="h-9 w-9 shrink-0 rounded-full border border-border"
          style={shown ? { backgroundColor: shown } : undefined}
        />
        <Select value={value} onValueChange={(next) => onPick({ color: next })}>
          <SelectTrigger id={id} className="min-w-0 flex-1">
            <SelectValue placeholder={t('placeholder')} />
          </SelectTrigger>
          <SelectContent>
            {CLOTHING_COLORS.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="h-3.5 w-3.5 rounded-full ring-1 ring-inset ring-black/10"
                    style={{ backgroundColor: c.hex }}
                  />
                  {colorLabel(c.value)}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Thumb-reachable and full width on a phone: these are the two ways that
          actually get the colour right, so they are not icon-only afterthoughts. */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <ColorEyedropper
          imageUrl={imageUrl ?? ''}
          disabled={!imageUrl}
          onColorSelect={(color, picked) => onPick({ color, hex: picked })}
          trigger={
            <span className="pointer-events-none flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full bg-secondary px-4 text-[14px] font-semibold text-secondary-foreground">
              <Palette className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
              {t('fromPhoto')}
            </span>
          }
          triggerClassName="min-w-0 flex-1 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
          triggerLabel={t('fromPhoto')}
        />
        <Button
          type="button"
          variant="secondary"
          className="min-h-[44px] flex-1 rounded-full"
          onClick={() => setWheelOpen(true)}
        >
          {t('fromWheel')}
        </Button>
      </div>
      {!imageUrl && <p className="text-[12.5px] text-muted-foreground">{t('needsPhoto')}</p>}

      <Dialog open={wheelOpen} onOpenChange={setWheelOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('wheelTitle')}</DialogTitle>
            <DialogDescription>{t('wheelHint')}</DialogDescription>
          </DialogHeader>
          <ColorWheel
            onChange={setWheelHex}
            label={t('wheelLabel')}
            lightnessLabel={t('lightness')}
          />
          <div className="flex items-center justify-between gap-3 rounded-lg bg-panel p-3">
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden
                className="h-8 w-8 shrink-0 rounded-full ring-1 ring-inset ring-black/10"
                style={{ backgroundColor: wheelHex }}
              />
              <span className="min-w-0 truncate text-[13px] font-semibold">
                {colorLabel(wheelMatch)}
              </span>
            </span>
            <Button
              type="button"
              onClick={() => {
                onPick({ color: wheelMatch, hex: wheelHex });
                setWheelOpen(false);
              }}
            >
              <Check className="h-4 w-4" strokeWidth={2} aria-hidden />
              {t('useShade')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
