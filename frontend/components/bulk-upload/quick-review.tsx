'use client';

import { useTranslations } from 'next-intl';
import { Check, ListChecks, Palette, Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ColorEyedropper } from '@/components/color-eyedropper';
import { swatchHex } from '@/lib/colors';
import { useTagLabel } from '@/lib/tag-labels';
import type { Item } from '@/lib/types';
import { needsType } from '@/components/bulk-upload/tag-choices';
import type { StepperDraft } from '@/components/bulk-upload/tag-stepper';

export interface ReviewEdit {
  type?: string;
  primaryColor?: string;
  /**
   * The shade sampled off this garment's photo. `undefined` means "unchanged";
   * `null` means the user picked a family off the swatches, so whatever shade was
   * stored no longer describes it.
   */
  primaryColorHex?: string | null;
}

/** Item plus whatever the user has changed but not saved yet. */
export function draftOf(item: Item, edit: ReviewEdit | undefined): StepperDraft {
  return {
    itemId: item.id,
    imageUrl: item.thumbnail_url ?? item.medium_url ?? item.image_url,
    // The eyedropper needs every pixel it can get, so it samples the biggest
    // image we are served rather than the grid thumbnail.
    fullImageUrl: item.image_url ?? item.medium_url ?? item.thumbnail_url,
    type: edit?.type ?? item.type,
    primaryColor: edit?.primaryColor ?? item.primary_color,
    primaryColorHex:
      edit?.primaryColorHex !== undefined ? edit.primaryColorHex : item.primary_color_hex,
  };
}

/**
 * The grid after a batch: confirm what the tagger guessed, fix what it got wrong,
 * and leave everything else alone.
 *
 * Garments the stylist cannot use yet — no type — come first and are marked, so
 * the pass is a short list of real work rather than a wall of thumbnails. Nothing
 * here is required: closing the sheet leaves the garments in the wardrobe.
 *
 * Tapping the photo samples its colour; the row underneath opens the one-by-one
 * editor. Two targets, because "this is the wrong colour" is the fix people make
 * most and pointing at the garment is the way to make it.
 */
export function QuickReview({
  items,
  edits,
  onEditOne,
  onPickColor,
  onStartStepper,
}: {
  items: readonly Item[];
  edits: Readonly<Record<string, ReviewEdit>>;
  onEditOne: (index: number) => void;
  onPickColor: (itemId: string, color: string, hex: string) => void;
  onStartStepper: () => void;
}) {
  const t = useTranslations('bulkUpload.review');
  const tagLabel = useTagLabel();
  const pending = items.filter((item) => needsType(edits[item.id]?.type ?? item.type)).length;

  return (
    <div className="space-y-3" data-testid="bulk-review">
      <div className="rounded-lg bg-panel p-3">
        <p className="text-[14px] font-semibold leading-snug">
          {pending > 0 ? t('needsWork', { count: pending }) : t('allGood')}
        </p>
        <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{t('hint')}</p>
        <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={onStartStepper}>
          <ListChecks className="h-4 w-4" strokeWidth={2} aria-hidden />
          {t('oneByOne')}
        </Button>
      </div>

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {items.map((item, index) => {
          const draft = draftOf(item, edits[item.id]);
          const missing = needsType(draft.type);
          const hex = swatchHex(draft.primaryColor, draft.primaryColorHex);
          return (
            <li key={item.id}>
              <div
                data-testid="bulk-review-tile"
                data-missing={missing ? 'true' : 'false'}
                className={`overflow-hidden rounded-tile bg-panel ${
                  missing ? 'ring-2 ring-signature' : ''
                }`}
              >
                <ColorEyedropper
                  imageUrl={draft.fullImageUrl ?? draft.imageUrl ?? ''}
                  disabled={!draft.imageUrl}
                  onColorSelect={(color, picked) => onPickColor(item.id, color, picked)}
                  triggerLabel={t('pickColour')}
                  triggerClassName="relative block w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  trigger={
                    <span className="relative block aspect-square w-full bg-background">
                      {draft.imageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={draft.imageUrl}
                          alt=""
                          className="h-full w-full object-cover"
                          aria-hidden
                          loading="lazy"
                        />
                      )}
                      {/* Says out loud that the photo is tappable — a bare
                          thumbnail looks like decoration. */}
                      <span className="absolute bottom-1.5 right-1.5 flex h-8 w-8 items-center justify-center rounded-full bg-background/90 text-foreground">
                        <Palette className="h-4 w-4" strokeWidth={2} aria-hidden />
                      </span>
                    </span>
                  }
                />
                <button
                  type="button"
                  onClick={() => onEditOne(index)}
                  data-testid="bulk-review-edit"
                  className="flex w-full items-start gap-1.5 p-2 text-left transition-transform active:scale-[0.98]"
                >
                  {hex ? (
                    <span
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border border-border"
                      style={{ backgroundColor: hex }}
                      aria-hidden
                    />
                  ) : null}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">
                      {missing ? t('unknownType') : tagLabel('types', draft.type)}
                    </span>
                    <span className="block truncate text-[12px] text-muted-foreground">
                      {draft.primaryColor ? tagLabel('colors', draft.primaryColor) : t('noColour')}
                    </span>
                  </span>
                  {missing ? (
                    <Pencil className="mt-0.5 h-3.5 w-3.5 shrink-0 text-signature" strokeWidth={2} aria-hidden />
                  ) : (
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" strokeWidth={2} aria-hidden />
                  )}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
