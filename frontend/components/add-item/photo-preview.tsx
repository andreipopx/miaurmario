'use client';

/* eslint-disable @next/next/no-img-element -- a local object URL, not a remote asset */

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Crop, RotateCcw, RotateCw, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ImageCropper } from '@/components/shared/image-cropper';
import { cn } from '@/lib/utils';
import { isWholeImage, normaliseQuarters, turnedSize, type CropRect } from '@/lib/image-crop';

/** What the add form sends with the photo, beyond the bytes. */
export interface PhotoFraming {
  /** Quarter turns clockwise. */
  quarters: number;
  /** In pixels of the turned photo, or null for "keep the whole thing". */
  crop: CropRect | null;
}

export const NO_FRAMING: PhotoFraming = { quarters: 0, crop: null };

/**
 * The photo, the way it will be saved.
 *
 * Two things the owner needed and could not do: straighten a photo his phone had
 * stored sideways, and cut a pair of trousers out of a picture of the whole room.
 * Both live here, next to the photo, rather than behind an edit toggle on a page
 * that does not exist until the garment is saved.
 *
 * The turns and the crop are sent to the server rather than applied to the bytes
 * here: no canvas re-encode (so no quality lost, and HEIC still works), and the
 * duplicate check sees the same pixels that get stored.
 */
export function PhotoPreview({
  src,
  framing,
  onFramingChange,
  onClear,
}: {
  src: string;
  framing: PhotoFraming;
  onFramingChange: (framing: PhotoFraming) => void;
  onClear: () => void;
}) {
  const t = useTranslations('wardrobe.add');
  const tCrop = useTranslations('imageCrop');
  const [cropping, setCropping] = useState(false);
  /** The live rect from the cropper, only committed when the user says so. */
  const [draft, setDraft] = useState<CropRect | null>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);

  const turn = (by: number) => {
    // A turn invalidates the crop: its coordinates were in the old frame.
    onFramingChange({ quarters: normaliseQuarters(framing.quarters + by), crop: null });
  };

  const onCropChange = useCallback((rect: CropRect | null) => setDraft(rect), []);

  const applyCrop = () => {
    const display = natural ? turnedSize(natural, framing.quarters) : null;
    // "The whole photo" is not a crop; sending it would be a no-op the server
    // still has to validate, and the badge would lie about having cropped.
    const crop = draft && display && isWholeImage(display, draft) ? null : draft;
    onFramingChange({ ...framing, crop });
    setCropping(false);
  };

  const turned = framing.quarters % 2 === 1;

  if (cropping) {
    return (
      <div className="space-y-3 rounded-tile bg-panel p-3">
        <p className="text-[13px] font-semibold leading-snug">{tCrop('title')}</p>
        <ImageCropper src={src} quarters={framing.quarters} onChange={onCropChange} />
        <div className="flex gap-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={() => setCropping(false)}>
            {tCrop('cancel')}
          </Button>
          <Button type="button" className="flex-1" onClick={applyCrop} disabled={!draft}>
            <Check className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
            {tCrop('apply')}
          </Button>
        </div>
        <p className="text-[12px] leading-snug text-muted-foreground">{tCrop('keyboardHint')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-tile bg-panel">
        <div className="flex h-48 items-center justify-center p-3">
          <img
            src={src}
            alt={t('previewAlt')}
            onLoad={(e) =>
              setNatural({
                width: e.currentTarget.naturalWidth,
                height: e.currentTarget.naturalHeight,
              })
            }
            className={cn(
              'max-h-full max-w-full object-contain transition-transform duration-200 motion-reduce:transition-none',
              // A quarter turn would overflow the box at full size, so the turned
              // photo is scaled to the shorter side.
              turned && 'max-h-[70%]'
            )}
            style={{ transform: `rotate(${framing.quarters * 90}deg)` }}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="absolute right-2 top-2 border-0 bg-background/90 shadow-sm"
          onClick={onClear}
          aria-label={t('removePhoto')}
        >
          <X className="h-4 w-4" strokeWidth={1.75} />
        </Button>
        {framing.crop && (
          <span className="absolute left-2 top-2 rounded-full bg-success px-2 py-1 text-[11px] font-bold text-success-foreground">
            {tCrop('cropped')}
          </span>
        )}
      </div>

      {/* One row, three 44px targets: straighten, straighten the other way, crop. */}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={tCrop('tools')}>
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className="h-11 w-11 shrink-0"
          onClick={() => turn(-1)}
          aria-label={tCrop('rotateLeft')}
          title={tCrop('rotateLeft')}
        >
          <RotateCcw className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className="h-11 w-11 shrink-0"
          onClick={() => turn(1)}
          aria-label={tCrop('rotateRight')}
          title={tCrop('rotateRight')}
        >
          <RotateCw className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="h-11 min-w-0 flex-1"
          onClick={() => setCropping(true)}
        >
          <Crop className="h-[18px] w-[18px] shrink-0" strokeWidth={2} aria-hidden />
          <span className="min-w-0 truncate">{framing.crop ? tCrop('recrop') : tCrop('crop')}</span>
        </Button>
      </div>

      <p className="text-[12px] leading-snug text-muted-foreground" aria-live="polite">
        {framing.quarters || framing.crop ? tCrop('willSave') : tCrop('asIs')}
      </p>
    </div>
  );
}
