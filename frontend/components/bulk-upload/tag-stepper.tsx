'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { clothingColorHex, isLightColor } from '@/lib/colors';
import { useTagLabel } from '@/lib/tag-labels';
import {
  OTHER_COLORS,
  OTHER_TYPES,
  QUICK_COLORS,
  QUICK_TYPES,
  needsType,
} from '@/components/bulk-upload/tag-choices';

export interface StepperDraft {
  itemId: string;
  imageUrl?: string;
  type?: string | null;
  primaryColor?: string | null;
}

interface TagStepperProps {
  drafts: readonly StepperDraft[];
  startAt?: number;
  onChange: (itemId: string, changes: { type?: string; primaryColor?: string }) => void;
  onDone: () => void;
}

/**
 * One garment at a time: "what is it" and "what colour", both one tap.
 *
 * Picking a colour advances on its own, so a batch of twenty is twenty pairs of
 * taps and nothing else. Left and right arrows move between garments for anyone
 * doing this on a keyboard.
 */
export function TagStepper({ drafts, startAt = 0, onChange, onDone }: TagStepperProps) {
  const t = useTranslations('bulkUpload.stepper');
  const tagLabel = useTagLabel();
  const [index, setIndex] = useState(() => Math.min(Math.max(0, startAt), Math.max(0, drafts.length - 1)));

  const current = drafts[index];
  const total = drafts.length;

  const goNext = useCallback(() => {
    setIndex((i) => {
      if (i + 1 >= total) {
        onDone();
        return i;
      }
      return i + 1;
    });
  }, [onDone, total]);

  const goBack = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

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

  const typeOptions = useMemo(() => OTHER_TYPES, []);
  const colorOptions = useMemo(() => OTHER_COLORS, []);

  if (!current) return null;

  const pickType = (type: string) => onChange(current.itemId, { type });
  const pickColor = (primaryColor: string) => {
    onChange(current.itemId, { primaryColor });
    // The colour is the last thing asked, so choosing it means "done with this one".
    goNext();
  };

  return (
    <div className="space-y-4" data-testid="bulk-stepper">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-semibold text-muted-foreground">
          {t('position', { current: index + 1, total })}
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={goNext}>
          {t('skip')}
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <div className="h-24 w-24 shrink-0 overflow-hidden rounded-tile bg-panel">
          {current.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={current.imageUrl} alt="" className="h-full w-full object-cover" aria-hidden />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-[15px] font-bold leading-tight">
            {needsType(current.type) ? t('whatIsIt') : tagLabel('types', current.type)}
          </p>
          <p className="text-[13px] text-muted-foreground">
            {current.primaryColor ? tagLabel('colors', current.primaryColor) : t('noColorYet')}
          </p>
        </div>
      </div>

      <fieldset>
        <legend className="mb-2 text-[13px] font-semibold">{t('typeLegend')}</legend>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              aria-pressed={current.type === type}
              onClick={() => pickType(type)}
              className={`min-h-[44px] rounded-full px-3 text-[14px] font-semibold transition-colors active:scale-[0.97] ${
                current.type === type
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-panel text-foreground hover:bg-secondary'
              }`}
            >
              {tagLabel('types', type)}
            </button>
          ))}
        </div>
        <Select
          value={(typeOptions as readonly string[]).includes(current.type ?? '') ? (current.type as string) : ''}
          onValueChange={pickType}
        >
          <SelectTrigger className="mt-2 h-11" aria-label={t('moreTypes')}>
            <SelectValue placeholder={t('moreTypes')} />
          </SelectTrigger>
          <SelectContent>
            {typeOptions.map((type) => (
              <SelectItem key={type} value={type}>
                {tagLabel('types', type)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-[13px] font-semibold">{t('colorLegend')}</legend>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_COLORS.map((color) => {
            const hex = clothingColorHex(color) ?? '#CCCCCC';
            const active = current.primaryColor === color;
            return (
              <button
                key={color}
                type="button"
                aria-pressed={active}
                aria-label={tagLabel('colors', color)}
                title={tagLabel('colors', color)}
                onClick={() => pickColor(color)}
                className={`flex h-11 w-11 items-center justify-center rounded-full border transition-transform active:scale-[0.94] ${
                  active ? 'border-foreground ring-2 ring-ring ring-offset-2' : 'border-border'
                }`}
                style={{ backgroundColor: hex }}
              >
                {active && (
                  <Check
                    className={`h-5 w-5 ${isLightColor(hex) ? 'text-foreground' : 'text-white'}`}
                    strokeWidth={2.5}
                    aria-hidden
                  />
                )}
              </button>
            );
          })}
        </div>
        <Select
          value={
            (colorOptions as readonly string[]).includes(current.primaryColor ?? '')
              ? (current.primaryColor as string)
              : ''
          }
          onValueChange={pickColor}
        >
          <SelectTrigger className="mt-2 h-11" aria-label={t('moreColors')}>
            <SelectValue placeholder={t('moreColors')} />
          </SelectTrigger>
          <SelectContent>
            {colorOptions.map((color) => (
              <SelectItem key={color} value={color}>
                {tagLabel('colors', color)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </fieldset>

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
