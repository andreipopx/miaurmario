'use client';

import { useTranslations } from 'next-intl';
import { Check, ChevronUp, ListChecks, Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { clothingColorHex } from '@/lib/colors';
import { useTagLabel } from '@/lib/tag-labels';
import { cn } from '@/lib/utils';
import type { Item } from '@/lib/types';
import { asTagList, needsType } from '@/components/bulk-upload/tag-choices';
import { GarmentThumb } from '@/components/bulk-upload/garment-thumb';
import { RotateButtons } from '@/components/bulk-upload/rotate-buttons';
import { TagFields, type TagChanges } from '@/components/bulk-upload/tag-fields';
import type { StepperDraft } from '@/components/bulk-upload/tag-stepper';

export interface ReviewEdit {
  type?: string;
  primaryColor?: string;
  style?: string[];
  formality?: string;
}

/** Item plus whatever the user has changed but not saved yet. */
export function draftOf(item: Item, edit: ReviewEdit | undefined): StepperDraft {
  return {
    itemId: item.id,
    imageUrl: item.thumbnail_url ?? item.medium_url ?? item.image_url,
    hasCutout: item.has_cutout,
    type: edit?.type ?? item.type,
    primaryColor: edit?.primaryColor ?? item.primary_color,
    style: edit?.style ?? asTagList(item.tags?.style ?? item.style),
    formality: edit?.formality ?? item.tags?.formality ?? item.formality,
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
 * Tapping a tile opens the four tags underneath it, in place: no navigation, and
 * "la siguiente" walks the grid without ever closing the editor, so a dozen
 * garments can be tagged in one sitting. Straightening is on the tile itself and
 * saves on the spot — it is the one change here that is not a draft.
 */
export function QuickReview({
  items,
  edits,
  openId,
  onOpen,
  onEdit,
  onRotate,
  rotating,
  turns = {},
  onStartStepper,
}: {
  items: readonly Item[];
  edits: Readonly<Record<string, ReviewEdit>>;
  /** Which tile has its editor open, if any. */
  openId: string | null;
  onOpen: (itemId: string | null) => void;
  onEdit: (itemId: string, changes: TagChanges) => void;
  onRotate: (itemId: string, direction: 'cw' | 'ccw') => void;
  rotating: string | null;
  turns?: Readonly<Record<string, number>>;
  onStartStepper: () => void;
}) {
  const t = useTranslations('bulkUpload.review');
  const tagLabel = useTagLabel();
  const pending = items.filter((item) => needsType(edits[item.id]?.type ?? item.type)).length;

  const openIndex = items.findIndex((item) => item.id === openId);
  const nextId = openIndex >= 0 && openIndex + 1 < items.length ? items[openIndex + 1].id : null;

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
        {items.map((item) => {
          const draft = draftOf(item, edits[item.id]);
          const missing = needsType(draft.type);
          const hex = draft.primaryColor ? clothingColorHex(draft.primaryColor) : undefined;
          const open = openId === item.id;
          const panelId = `review-tags-${item.id}`;
          return (
            <li key={item.id} className={cn(open && 'col-span-full')}>
              <div
                className={cn(
                  'overflow-hidden rounded-tile bg-panel',
                  missing && !open && 'ring-2 ring-signature'
                )}
              >
                <div className={cn(open && 'flex items-start gap-3 p-2')}>
                  <button
                    type="button"
                    onClick={() => onOpen(open ? null : item.id)}
                    data-testid="bulk-review-tile"
                    data-missing={missing ? 'true' : 'false'}
                    aria-expanded={open}
                    aria-controls={panelId}
                    className={cn(
                      'block min-w-0 text-left transition-transform active:scale-[0.98]',
                      open ? 'w-24 shrink-0' : 'w-full'
                    )}
                  >
                    <GarmentThumb
                      src={draft.imageUrl}
                      color={draft.primaryColor}
                      hasCutout={draft.hasCutout}
                      quarterTurns={turns[item.id] ?? 0}
                      className={cn('aspect-square w-full', open && 'rounded-tile')}
                      loading="lazy"
                    />
                    {!open && (
                      <span className="flex items-start gap-1.5 p-2">
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
                          <span className="block truncate text-[12px] text-muted-foreground">
                            {draft.formality ? tagLabel('formality', draft.formality) : t('noFormality')}
                          </span>
                        </span>
                        {missing ? (
                          <Pencil className="mt-0.5 h-3.5 w-3.5 shrink-0 text-signature" strokeWidth={2} aria-hidden />
                        ) : (
                          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" strokeWidth={2} aria-hidden />
                        )}
                      </span>
                    )}
                  </button>

                  {open && (
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <p className="text-[14px] font-bold leading-tight">
                        {missing ? t('unknownType') : tagLabel('types', draft.type)}
                      </p>
                      <RotateButtons
                        onRotate={(direction) => onRotate(item.id, direction)}
                        busy={rotating === item.id}
                        size="sm"
                      />
                      <p className="text-[12px] leading-snug text-muted-foreground">
                        {(turns[item.id] ?? 0) > 0 ? t('rotated') : t('rotateHint')}
                      </p>
                    </div>
                  )}
                </div>

                {open && (
                  <div id={panelId} className="space-y-4 border-t border-border p-3">
                    <TagFields
                      draft={draft}
                      idPrefix={`review-${item.id}`}
                      onChange={(changes) => onEdit(item.id, changes)}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        className="min-w-0 flex-1"
                        onClick={() => onOpen(null)}
                      >
                        <ChevronUp className="h-[18px] w-[18px] shrink-0" strokeWidth={2} aria-hidden />
                        <span className="min-w-0 truncate">{t('closeTags')}</span>
                      </Button>
                      {nextId && (
                        <Button
                          type="button"
                          className="min-w-0 flex-1"
                          onClick={() => onOpen(nextId)}
                        >
                          <span className="min-w-0 truncate">{t('nextGarment')}</span>
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
