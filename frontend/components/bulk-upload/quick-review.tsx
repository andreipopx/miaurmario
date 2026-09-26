'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, ChevronUp, Layers, ListChecks, Pencil, Pipette, Undo2 } from 'lucide-react';

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
import {
  backsPromisedTo,
  mergeTargetsFor,
  pairKey,
  suggestedBackTarget,
  visibleInReview,
  type BackPairings,
} from '@/lib/bulk-upload/back-pairing';

export interface ReviewEdit {
  type?: string;
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
  backPairings = {},
  onPairBack,
  onUnpairBack,
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
  /**
   * The "esta es la espalda de aquella" answers so far. Drafts, exactly like the tag
   * edits: nothing is sent until the pass is saved, which is what makes "deshacer"
   * free and immediate here and nowhere else.
   */
  backPairings?: BackPairings;
  onPairBack?: (sourceId: string, targetId: string) => void;
  onUnpairBack?: (sourceId: string) => void;
}) {
  const t = useTranslations('bulkUpload.review');
  const tagLabel = useTagLabel();
  /** Which tile has its "¿de qué prenda es la espalda?" picker open. */
  const [pickingFor, setPickingFor] = useState<string | null>(null);
  /** Pairs the user said "no" to. Asked once, never again. */
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());

  const shown = visibleInReview(items, backPairings);
  const promised = backsPromisedTo(backPairings);
  const pending = shown.filter((item) => needsType(edits[item.id]?.type ?? item.type)).length;
  const nameOf = (item: Item) =>
    item.name || (needsType(item.type) ? t('unknownType') : tagLabel('types', item.type));

  const openIndex = shown.findIndex((item) => item.id === openId);
  const nextId = openIndex >= 0 && openIndex + 1 < shown.length ? shown[openIndex + 1].id : null;

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

      {/* The answers so far, with a way back out of each one. Above the grid rather
          than on the (now absent) tile: the garment being folded in has left the
          grid, so this is the only place "deshacer" can live. */}
      {Object.keys(backPairings).length > 0 && onUnpairBack && (
        <ul className="space-y-1.5" data-testid="bulk-review-pairings">
          {Object.entries(backPairings).map(([sourceId, pairing]) => {
            const source = items.find((i) => i.id === sourceId);
            const target = items.find((i) => i.id === pairing.targetId);
            if (!source || !target) return null;
            return (
              <li
                key={sourceId}
                className="flex min-w-0 items-center gap-2 rounded-tile bg-signature-soft px-3 py-2"
              >
                <Layers className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                  {t('backOfBadge', { name: nameOf(target) })}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  onClick={() => onUnpairBack(sourceId)}
                >
                  <Undo2 className="h-4 w-4" strokeWidth={2} aria-hidden />
                  {t('undo')}
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {shown.map((item, index) => {
          const draft = draftOf(item, edits[item.id]);
          const missing = needsType(draft.type);
          // The garment's own shade when one was sampled, the palette's otherwise.
          const hex = swatchHex(draft.primaryColor, draft.primaryColorHex);
          const open = openId === item.id;
          const panelId = `review-tags-${item.id}`;
          const picking = pickingFor === item.id;
          const targets = mergeTargetsFor(shown, backPairings, item.id);
          const gained = promised.get(item.id) ?? 0;
          // Only ever a question, and only when three cheap facts line up. Nothing
          // is decided here and no model is asked; see lib/bulk-upload/back-pairing.
          const hinted = onPairBack ? suggestedBackTarget(shown, index, dismissed, backPairings) : null;
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
                        busy={rotating === item.id}
                        size="sm"
                      />
                      <p className="text-[12px] leading-snug text-muted-foreground">
                        {(turns[item.id] ?? 0) > 0 ? t('rotated') : t('rotateHint')}
                      </p>
                    </div>
                  )}
                </div>

                {gained > 0 && (
                  <p className="flex items-center gap-1.5 px-2 pb-2 text-[12px] font-semibold text-signature">
                    <Layers className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                    <span className="min-w-0 truncate">{t('hasBack')}</span>
                  </p>
                )}

                {/* The quiet nudge. A question with two answers, and "no" is final:
                    being asked the same thing twice is worse than not being asked. */}
                {hinted && !picking && onPairBack && (
                  <div className="border-t border-border p-2" data-testid="bulk-review-hint">
                    <p className="text-[12px] font-semibold leading-snug">
                      {t('suggestBack')}
                    </p>
                    <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                      {nameOf(hinted)}
                    </p>
                    <div className="mt-1.5 flex gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        className="min-w-0 flex-1"
                        onClick={() => onPairBack(item.id, hinted.id)}
                      >
                        <span className="min-w-0 truncate">{t('suggestYes')}</span>
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="min-w-0 flex-1"
                        onClick={() =>
                          setDismissed((prev) => new Set(prev).add(pairKey(hinted.id, item.id)))
                        }
                      >
                        <span className="min-w-0 truncate">{t('suggestNo')}</span>
                      </Button>
                    </div>
                  </div>
                )}

                {onPairBack && !picking && (
                  <div className="border-t border-border p-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="w-full min-w-0 justify-start"
                      onClick={() => setPickingFor(item.id)}
                      aria-expanded={false}
                    >
                      <Layers className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                      <span className="min-w-0 truncate">{t('isBackOf')}</span>
                    </Button>
                  </div>
                )}

                {/* The picker: this batch's own thumbnails, nothing else. The other
                    half of a pair is in the same batch — that is what makes it a pair. */}
                {picking && onPairBack && (
                  <div className="space-y-2 border-t border-border p-2">
                    <p className="text-[12px] font-bold leading-snug">{t('isBackOfTitle')}</p>
                    <p className="text-[12px] leading-snug text-muted-foreground">
                      {t('isBackOfHint')}
                    </p>
                    {targets.length === 0 ? (
                      <p className="text-[12px] text-muted-foreground">{t('isBackOfNone')}</p>
                    ) : (
                      <ul className="flex flex-wrap gap-1.5">
                        {targets.map((target) => (
                          <li key={target.id}>
                            <button
                              type="button"
                              onClick={() => {
                                onPairBack(item.id, target.id);
                                setPickingFor(null);
                              }}
                              className="flex min-h-[44px] min-w-0 max-w-[10rem] items-center gap-1.5 rounded-full bg-panel px-2 py-1 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            >
                              <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full bg-background">
                                <GarmentThumb
                                  src={target.thumbnail_url ?? target.image_url}
                                  color={target.primary_color}
                                  colorHex={swatchHex(target.primary_color, target.primary_color_hex)}
                                  hasCutout={target.has_cutout}
                                  className="h-8 w-8"
                                  loading="lazy"
                                />
                              </span>
                              <span className="min-w-0 truncate text-[12px] font-semibold">
                                {nameOf(target)}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setPickingFor(null)}
                    >
                      {t('cancel')}
                    </Button>
                  </div>
                )}

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
