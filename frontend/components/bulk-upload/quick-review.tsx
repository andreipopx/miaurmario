'use client';

import { useTranslations } from 'next-intl';
import { Check, ChevronUp, ListChecks, Pencil, Pipette } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ColorEyedropper } from '@/components/color-eyedropper';
import { swatchHex } from '@/lib/colors';
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
  /** `null` clears it: the garment is a plain one of its type after all. */
  subtype?: string | null;
  primaryColor?: string;
  /**
   * The shade sampled off this garment's photo. `undefined` means "unchanged";
   * `null` means the user picked a family off the swatches, so whatever shade was
   * stored no longer describes it.
   */
  primaryColorHex?: string | null;
  style?: string[];
  formality?: string;
}

/** Item plus whatever the user has changed but not saved yet. */
export function draftOf(item: Item, edit: ReviewEdit | undefined): StepperDraft {
  return {
    itemId: item.id,
    imageUrl: item.thumbnail_url ?? item.medium_url ?? item.image_url,
    // The eyedropper needs every pixel it can get, so it samples the biggest
    // image we are served rather than the grid thumbnail.
    fullImageUrl: item.image_url ?? item.medium_url ?? item.thumbnail_url,
    hasCutout: item.has_cutout,
    type: edit?.type ?? item.type,
    subtype: edit?.subtype !== undefined ? edit.subtype : item.subtype,
    primaryColor: edit?.primaryColor ?? item.primary_color,
    primaryColorHex:
      edit?.primaryColorHex !== undefined ? edit.primaryColorHex : item.primary_color_hex,
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
 * Tapping a tile opens its tags underneath it, in place: no navigation, and "la
 * siguiente" walks the grid without ever closing the editor, so a dozen garments
 * can be tagged in one sitting. Straightening is on the tile itself and saves on
 * the spot — it is the one change here that is not a draft.
 *
 * The pipette on the corner of each photo is the second target, because "this is
 * the wrong colour" is the fix people make most and pointing at the garment is
 * the way to make it. It opens the eyedropper without opening the editor.
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
  /** Whether this garment has a turn still being written. It never blocks the buttons. */
  rotating: (itemId: string) => boolean;
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
          // The garment's own shade when one was sampled, the palette's otherwise.
          const hex = swatchHex(draft.primaryColor, draft.primaryColorHex);
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
                  <div className={cn('relative min-w-0', open ? 'w-24 shrink-0' : 'w-full')}>
                    <button
                      type="button"
                      onClick={() => onOpen(open ? null : item.id)}
                      data-testid="bulk-review-tile"
                      data-missing={missing ? 'true' : 'false'}
                      aria-expanded={open}
                      aria-controls={panelId}
                      className="block w-full min-w-0 text-left transition-transform active:scale-[0.98]"
                    >
                      <GarmentThumb
                        src={draft.imageUrl}
                        color={draft.primaryColor}
                        colorHex={hex}
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
                    {/* A target of its own, on the corner of the photo: the tile
                        opens the tags, the pipette goes straight to the colour.
                        A button inside a button is not valid HTML, so it sits
                        beside the tile rather than inside it. */}
                    <ColorEyedropper
                      imageUrl={draft.fullImageUrl ?? draft.imageUrl ?? ''}
                      disabled={!draft.imageUrl}
                      onColorSelect={(color, picked) =>
                        onEdit(item.id, { primaryColor: color, primaryColorHex: picked })
                      }
                      triggerLabel={t('pickColour')}
                      triggerClassName="absolute right-1.5 top-1.5 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-background/90 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      trigger={<Pipette className="h-4 w-4" strokeWidth={2} aria-hidden />}
                    />
                  </div>

                  {open && (
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <p className="text-[14px] font-bold leading-tight">
                        {missing ? t('unknownType') : tagLabel('types', draft.type)}
                      </p>
                      <RotateButtons
                        onRotate={(direction) => onRotate(item.id, direction)}
                        busy={rotating(item.id)}
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
                      imageUrl={draft.fullImageUrl ?? draft.imageUrl}
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
