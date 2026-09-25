'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { clothingColorHex, isLightColor } from '@/lib/colors';
import { useTagLabel } from '@/lib/tag-labels';
import { cn } from '@/lib/utils';
import {
  FORMALITY_LEVELS,
  OTHER_COLORS,
  OTHER_TYPES,
  QUICK_COLORS,
  QUICK_STYLES,
  QUICK_TYPES,
  toggleStyle,
} from '@/components/bulk-upload/tag-choices';

/** The four tags the quick pass writes. Everything is optional and nullable. */
export interface TagDraft {
  type?: string | null;
  primaryColor?: string | null;
  style?: string[] | null;
  formality?: string | null;
}

export interface TagChanges {
  type?: string;
  primaryColor?: string;
  style?: string[];
  formality?: string;
}

/**
 * Tipo, color, estilo, formalidad — one tap each, no hunting.
 *
 * Shared by the one-at-a-time stepper and the review grid's inline editor so the
 * two can never drift: the same shortlists, the same vocabulary, the same
 * behaviour. Every control is a real button or select, so the whole thing is
 * tab-navigable and each target is at least 44 px.
 *
 * `onDetailsTouched` fires when style or formality is changed, which is how the
 * stepper knows not to skip to the next garment under the user's fingers.
 */
export function TagFields({
  draft,
  onChange,
  onDetailsTouched,
  onColorPicked,
  idPrefix,
}: {
  draft: TagDraft;
  onChange: (changes: TagChanges) => void;
  onDetailsTouched?: () => void;
  /** Called after a colour is chosen, for callers that advance on it. */
  onColorPicked?: () => void;
  idPrefix: string;
}) {
  const t = useTranslations('bulkUpload.stepper');
  const tagLabel = useTagLabel();

  const typeOptions = useMemo(() => OTHER_TYPES, []);
  const colorOptions = useMemo(() => OTHER_COLORS, []);
  const styles = draft.style ?? [];

  const chip = (active: boolean) =>
    cn(
      'min-h-[44px] rounded-full px-3 text-[14px] font-semibold transition-colors active:scale-[0.97]',
      active ? 'bg-primary text-primary-foreground' : 'bg-panel text-foreground hover:bg-secondary'
    );

  return (
    <div className="space-y-4" data-testid="tag-fields">
      <fieldset>
        <legend className="mb-2 text-[13px] font-semibold">{t('typeLegend')}</legend>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              aria-pressed={draft.type === type}
              onClick={() => onChange({ type })}
              className={chip(draft.type === type)}
            >
              {tagLabel('types', type)}
            </button>
          ))}
        </div>
        <Select
          value={(typeOptions as readonly string[]).includes(draft.type ?? '') ? (draft.type as string) : ''}
          onValueChange={(type) => onChange({ type })}
        >
          <SelectTrigger className="mt-2 h-11" aria-label={t('moreTypes')} id={`${idPrefix}-more-types`}>
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
            const active = draft.primaryColor === color;
            return (
              <button
                key={color}
                type="button"
                aria-pressed={active}
                aria-label={tagLabel('colors', color)}
                title={tagLabel('colors', color)}
                onClick={() => {
                  onChange({ primaryColor: color });
                  onColorPicked?.();
                }}
                className={cn(
                  'flex h-11 w-11 items-center justify-center rounded-full border transition-transform active:scale-[0.94]',
                  active ? 'border-foreground ring-2 ring-ring ring-offset-2' : 'border-border'
                )}
                style={{ backgroundColor: hex }}
              >
                {active && (
                  <Check
                    className={cn('h-5 w-5', isLightColor(hex) ? 'text-foreground' : 'text-white')}
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
            (colorOptions as readonly string[]).includes(draft.primaryColor ?? '')
              ? (draft.primaryColor as string)
              : ''
          }
          onValueChange={(primaryColor) => {
            onChange({ primaryColor });
            onColorPicked?.();
          }}
        >
          <SelectTrigger className="mt-2 h-11" aria-label={t('moreColors')} id={`${idPrefix}-more-colors`}>
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

      <fieldset>
        <legend className="mb-2 text-[13px] font-semibold">
          {t('styleLegend')}{' '}
          <span className="font-normal text-muted-foreground">{t('styleHint')}</span>
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_STYLES.map((style) => {
            const active = styles.includes(style);
            return (
              <button
                key={style}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  onChange({ style: toggleStyle(styles, style) });
                  onDetailsTouched?.();
                }}
                className={chip(active)}
              >
                {tagLabel('styles', style)}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-[13px] font-semibold">{t('formalityLegend')}</legend>
        <div className="flex flex-wrap gap-1.5">
          {FORMALITY_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              aria-pressed={draft.formality === level}
              onClick={() => {
                onChange({ formality: level });
                onDetailsTouched?.();
              }}
              className={chip(draft.formality === level)}
            >
              {tagLabel('formality', level)}
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
