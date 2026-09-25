'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowLeft, ArrowRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { swatchHex } from '@/lib/colors';
import { useTagLabel } from '@/lib/tag-labels';
import { needsType } from '@/components/bulk-upload/tag-choices';
import { TagFields, type TagChanges } from '@/components/bulk-upload/tag-fields';
import { GarmentThumb } from '@/components/bulk-upload/garment-thumb';
import { RotateButtons } from '@/components/bulk-upload/rotate-buttons';

export interface StepperDraft {
  itemId: string;
  imageUrl?: string;
  /** The largest image we are served, for sampling; the tile shows a thumbnail. */
  fullImageUrl?: string;
  hasCutout?: boolean;
  type?: string | null;
  primaryColor?: string | null;
  primaryColorHex?: string | null;
  style?: string[] | null;
  formality?: string | null;
}

interface TagStepperProps {
  drafts: readonly StepperDraft[];
  startAt?: number;
  onChange: (itemId: string, changes: TagChanges) => void;
  onRotate?: (itemId: string, direction: 'cw' | 'ccw') => void;
  rotating?: string | null;
  turns?: Readonly<Record<string, number>>;
  onDone: () => void;
}

/**
 * One garment at a time: what is it, what colour, what style, how formal.
 *
 * The fast path is untouched — tipo then color, one tap each, and picking the
 * colour moves on by itself, so a batch of twenty is twenty pairs of taps. Style
 * and formality sit right below, and touching either one cancels the auto-advance
 * for that garment: someone who is filling all four in does not want the screen
 * moving under their fingers.
 *
 * Left and right arrows move between garments for anyone on a keyboard.
 */
export function TagStepper({
  drafts,
  startAt = 0,
  onChange,
  onRotate,
  rotating,
  turns = {},
  onDone,
}: TagStepperProps) {
  const t = useTranslations('bulkUpload.stepper');
  const tagLabel = useTagLabel();
  const [index, setIndex] = useState(() => Math.min(Math.max(0, startAt), Math.max(0, drafts.length - 1)));
  /** Reset for every garment: see the auto-advance note above. */
  const detailsTouched = useRef(false);

  const current = drafts[index];
  const total = drafts.length;

  const goNext = useCallback(() => {
    detailsTouched.current = false;
    setIndex((i) => {
      if (i + 1 >= total) {
        onDone();
        return i;
      }
      return i + 1;
    });
  }, [onDone, total]);

  const goBack = useCallback(() => {
    detailsTouched.current = false;
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest('[role="listbox"]')) return;
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        goNext();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goBack();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goBack, goNext]);

  if (!current) return null;

  // The user's own shade when they sampled one, otherwise the palette's: the plate
  // under the garment and the label beside it both read off the same value.
  const currentHex = swatchHex(current.primaryColor, current.primaryColorHex);

  return (
    <div className="space-y-4" data-testid="bulk-stepper">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-[13px] font-semibold text-muted-foreground">
          {t('position', { current: index + 1, total })}
        </p>
        <Button type="button" variant="ghost" size="sm" className="shrink-0" onClick={goNext}>
          {t('skip')}
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <GarmentThumb
          src={current.imageUrl}
          color={current.primaryColor}
          colorHex={currentHex}
          hasCutout={current.hasCutout}
          quarterTurns={turns[current.itemId] ?? 0}
          className="h-24 w-24 shrink-0 rounded-tile"
        />
        <div className="min-w-0 space-y-1.5">
          <p className="text-[15px] font-bold leading-tight">
            {needsType(current.type) ? t('whatIsIt') : tagLabel('types', current.type)}
          </p>
          <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            {currentHex ? (
              <span
                aria-hidden
                className="h-3 w-3 shrink-0 rounded-full border border-border"
                style={{ backgroundColor: currentHex }}
              />
            ) : null}
            {current.primaryColor ? tagLabel('colors', current.primaryColor) : t('noColorYet')}
          </p>
          {onRotate && (
            <RotateButtons
              onRotate={(direction) => onRotate(current.itemId, direction)}
              busy={rotating === current.itemId}
            />
          )}
        </div>
      </div>

      <TagFields
        draft={current}
        imageUrl={current.fullImageUrl ?? current.imageUrl}
        idPrefix={`stepper-${current.itemId}`}
        onChange={(changes) => onChange(current.itemId, changes)}
        onDetailsTouched={() => {
          detailsTouched.current = true;
        }}
        onColorPicked={() => {
          // The colour is the last thing asked on the fast path, so choosing it
          // means "done with this one" — unless the user is filling in the rest.
          if (!detailsTouched.current) goNext();
        }}
      />

      <div className="flex items-center justify-between gap-2 pt-1">
        <Button type="button" variant="secondary" onClick={goBack} disabled={index === 0}>
          <ArrowLeft className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
          {t('back')}
        </Button>
        <Button type="button" onClick={goNext}>
          {index + 1 >= total ? t('finish') : t('next')}
          <ArrowRight className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
        </Button>
      </div>
    </div>
  );
}
