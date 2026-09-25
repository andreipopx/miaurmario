'use client';

import { useTranslations } from 'next-intl';
import { Check, ListChecks, Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { clothingColorHex } from '@/lib/colors';
import { useTagLabel } from '@/lib/tag-labels';
import type { Item } from '@/lib/types';
import { needsType } from '@/components/bulk-upload/tag-choices';
import type { StepperDraft } from '@/components/bulk-upload/tag-stepper';

export interface ReviewEdit {
  type?: string;
  primaryColor?: string;
}

/** Item plus whatever the user has changed but not saved yet. */
export function draftOf(item: Item, edit: ReviewEdit | undefined): StepperDraft {
  return {
    itemId: item.id,
    imageUrl: item.thumbnail_url ?? item.medium_url ?? item.image_url,
    type: edit?.type ?? item.type,
    primaryColor: edit?.primaryColor ?? item.primary_color,
  };
}

/**
 * The grid after a batch: confirm what the tagger guessed, fix what it got wrong,
 * and leave everything else alone.
 *
 * Garments the stylist cannot use yet — no type — come first and are marked, so
 * the pass is a short list of real work rather than a wall of thumbnails. Nothing
 * here is required: closing the sheet leaves the garments in the wardrobe.
 */
export function QuickReview({
  items,
  edits,
  onEditOne,
  onStartStepper,
}: {
  items: readonly Item[];
  edits: Readonly<Record<string, ReviewEdit>>;
  onEditOne: (index: number) => void;
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
          const hex = draft.primaryColor ? clothingColorHex(draft.primaryColor) : undefined;
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onEditOne(index)}
                data-testid="bulk-review-tile"
                data-missing={missing ? 'true' : 'false'}
                className={`w-full overflow-hidden rounded-tile bg-panel text-left transition-transform active:scale-[0.98] ${
                  missing ? 'ring-2 ring-signature' : ''
                }`}
              >
                <div className="aspect-square w-full bg-background">
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
                </div>
                <div className="flex items-start gap-1.5 p-2">
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
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
