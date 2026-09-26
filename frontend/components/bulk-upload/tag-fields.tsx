'use client';

import { useTranslations } from 'next-intl';
import { Check, Pipette } from 'lucide-react';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ColorEyedropper } from '@/components/color-eyedropper';
import { SubtypeField } from '@/components/bulk-upload/subtype-field';
import { clothingColorHex, isLightColor, swatchHex } from '@/lib/colors';
import { useQuickTagChoices } from '@/lib/hooks/use-tag-usage';
import { subtypeAfterTypeChange } from '@/lib/subtypes';
import { useTagLabel } from '@/lib/tag-labels';
import { cn } from '@/lib/utils';
import {
  ALL_COLORS,
  ALL_TYPES,
  FORMALITY_LEVELS,
  QUICK_STYLES,
  toggleStyle,
} from '@/components/bulk-upload/tag-choices';

/** The tags the quick pass writes. Everything is optional and nullable. */
export interface TagDraft {
  type?: string | null;
  /** The more specific name inside the type: a halter top, a falda plisada. */
  subtype?: string | null;
  primaryColor?: string | null;
  /** The shade sampled off the photo, `#rrggbb`. Display only, beside the family. */
  primaryColorHex?: string | null;
  style?: string[] | null;
  formality?: string | null;
}

export interface TagChanges {
  type?: string;
  /**
   * `null` clears it, which is the commonest edit here: the tagger guesses subtype
   * badly (`wrap` for a halter top) and the user is mostly removing a wrong guess
   * or replacing it. `undefined` means the subtype was not touched.
   */
  subtype?: string | null;
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
 * Tipo, detalle, color, estilo, formalidad — one tap each, no hunting, and the
 * eyedropper beside the swatches for the colour the palette does not have a name
 * for.
 *
 * Shared by the one-at-a-time stepper and the review grid's inline editor so the
 * two can never drift: the same shortlists, the same vocabulary, the same
 * behaviour. Every control is a real button or select, so the whole thing is
 * tab-navigable and each target is at least 44 px.
 *
 * The type and colour buttons are this owner's own most-used values (see
 * `useQuickTagChoices`); the selects beside them always hold the full vocabulary.
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

  /** This owner's own most-used types and colours, defaults until they are known. */
  const { types: quickTypes, colors: quickColors } = useQuickTagChoices();
  /**
   * The selects offer the *whole* vocabulary, not the complement of the buttons.
   *
   * They used to hold "everything the shortlist does not", which was safe while the
   * shortlist was a constant. It is now this person's wardrobe, so a complement
   * computed from it would make the full list a moving target — a type could be
   * both off the button row and out of the select depending on what they own. Every
   * value is therefore always in the select; it only *displays* one the buttons are
   * not already showing, so the "más tipos" placeholder still means what it says.
   */
  const typeOptions = ALL_TYPES;
  const colorOptions = ALL_COLORS;
  const selectedType = draft.type ?? '';
  const selectedColor = draft.primaryColor ?? '';
  const styles = draft.style ?? [];

  /**
   * Picking a type may retire the subtype under it. `wrap` on a dress is not `wrap`
   * on a pair of jeans, and the commonest way to end up with nonsense is to correct
   * a wrong type and leave the tagger's subtype sitting beneath it.
   */
  const pickType = (type: string) => {
    const subtype = subtypeAfterTypeChange(type, draft.subtype);
    if (subtype === (draft.subtype ?? null)) {
      onChange({ type });
      return;
    }
    onChange({ type, subtype });
  };

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
          {quickTypes.map((type) => (
            <button
              key={type}
              type="button"
              aria-pressed={draft.type === type}
              onClick={() => pickType(type)}
              className={chip(draft.type === type)}
            >
              {tagLabel('types', type)}
            </button>
          ))}
        </div>
        <Select
          value={
            // Blank while a button already shows the answer, so the trigger reads
            // "más tipos" rather than echoing the chip beside it.
            quickTypes.includes(selectedType) || !typeOptions.includes(selectedType)
              ? ''
              : selectedType
          }
          onValueChange={pickType}
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

      {/* Right under the type, because that is what it is a detail of. */}
      <SubtypeField
        type={draft.type}
        value={draft.subtype}
        onChange={(subtype) => {
          onChange({ subtype });
          // Someone who bothered to name the detail is not done with this garment,
          // so the stepper must not skip out from under them on the next colour tap.
          onDetailsTouched?.();
        }}
        idPrefix={idPrefix}
      />

      <fieldset>
        <legend className="mb-2 text-[13px] font-semibold">{t('colorLegend')}</legend>
        <div className="flex flex-wrap gap-1.5">
          {quickColors.map((color) => {
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
            quickColors.includes(selectedColor) || !colorOptions.includes(selectedColor)
              ? ''
              : selectedColor
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
