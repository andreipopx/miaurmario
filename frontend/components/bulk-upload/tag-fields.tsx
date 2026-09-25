'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Pipette } from 'lucide-react';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ColorEyedropper } from '@/components/color-eyedropper';
import { clothingColorHex, isLightColor, swatchHex } from '@/lib/colors';
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

/** The tags the quick pass writes. Everything is optional and nullable. */
export interface TagDraft {
  type?: string | null;
  primaryColor?: string | null;
  /** The shade sampled off the photo, `#rrggbb`. Display only, beside the family. */
  primaryColorHex?: string | null;
  style?: string[] | null;
  formality?: string | null;
}

export interface TagChanges {
  type?: string;
  primaryColor?: string;
  /**
   * `null` is meaningful: the user picked a family off the swatches, so whatever
   * shade was sampled against the old family no longer describes the garment.
   * `undefined` means the shade was not touched.
   */
  primaryColorHex?: string | null;
  style?: string[];
  formality?: string;
}

/**
 * Tipo, color, estilo, formalidad — one tap each, no hunting, and the eyedropper
 * beside the swatches for the colour the palette does not have a name for.
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
  imageUrl,
  idPrefix,
}: {
  draft: TagDraft;
  onChange: (changes: TagChanges) => void;
  onDetailsTouched?: () => void;
  /** Called after a colour is chosen, for callers that advance on it. */
  onColorPicked?: () => void;
  /**
   * The biggest photo of this garment we are served. Given one, the colour row
   * also offers the eyedropper: pointing at the garment is how people fix a
   * colour, and it keeps the real shade rather than the nearest family.
   */
  imageUrl?: string | null;
  idPrefix: string;
}) {
  const t = useTranslations('bulkUpload.stepper');
  const tagLabel = useTagLabel();

  const typeOptions = useMemo(() => OTHER_TYPES, []);
  const colorOptions = useMemo(() => OTHER_COLORS, []);
  const styles = draft.style ?? [];
  /** The shade sampled off this garment, if there is one to show. */
  const measured = swatchHex(null, draft.primaryColorHex);

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
                  // Off the swatches the user named a family and nothing more, so a
                  // shade sampled against the old family is dropped rather than
                  // left to contradict it.
                  onChange({ primaryColor: color, primaryColorHex: null });
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
          {imageUrl && (
            <ColorEyedropper
              imageUrl={imageUrl}
              onColorSelect={(primaryColor, hex) => {
                onChange({ primaryColor, primaryColorHex: hex });
                onColorPicked?.();
              }}
              triggerLabel={t('pickColour')}
              triggerClassName="h-11 w-11 shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              trigger={
                <span
                  className="flex h-full w-full items-center justify-center rounded-full border border-dashed border-foreground/40"
                  style={measured ? { backgroundColor: measured } : undefined}
                >
                  <Pipette
                    className={cn(
                      'h-5 w-5',
                      measured && !isLightColor(measured) ? 'text-white' : 'text-foreground'
                    )}
                    strokeWidth={2}
                    aria-hidden
                  />
                </span>
              }
            />
          )}
        </div>
        <Select
          value={
            (colorOptions as readonly string[]).includes(draft.primaryColor ?? '')
              ? (draft.primaryColor as string)
              : ''
          }
          onValueChange={(primaryColor) => {
            onChange({ primaryColor, primaryColorHex: null });
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
