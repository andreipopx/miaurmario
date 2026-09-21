'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Pipette, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ColorWheel, COLOR_WHEEL_INITIAL_HEX } from '@/components/color-wheel';
import { COLOR_PRESETS, clothingColorHex, isLightColor, nearestClothingColor } from '@/lib/colors';
import { useColorLabel } from '@/lib/tag-labels';
import { CLOTHING_COLORS } from '@/lib/types';
import { cn } from '@/lib/utils';

interface ColorPreferencesProps {
  /** Section title (e.g. "Colores favoritos"). */
  label: string;
  description?: string;
  selected: string[];
  onChange: (colors: string[]) => void;
  /** Favourites get a pink ring + tick; "avoid" gets a red ring + cross. */
  tone?: 'favorite' | 'avoid';
  className?: string;
}

/**
 * Favourite / avoid colour editor: removable chips with swatches for what's
 * chosen, the named palette as toggle swatches, a colour wheel that snaps to
 * the nearest named colour (CIEDE2000) and quick palettes that add several at
 * once. Values are always tag values from CLOTHING_COLORS.
 */
export function ColorPreferences({
  label,
  description,
  selected,
  onChange,
  tone = 'favorite',
  className,
}: ColorPreferencesProps) {
  const t = useTranslations('colorPicker');
  const colorLabel = useColorLabel();
  const [wheelOpen, setWheelOpen] = useState(false);
  const [pickedHex, setPickedHex] = useState(COLOR_WHEEL_INITIAL_HEX);
  const nearest = nearestClothingColor(pickedHex);

  const add = (values: string[]) => {
    const next = [...selected];
    for (const v of values) if (!next.includes(v)) next.push(v);
    onChange(next);
  };
  const remove = (value: string) => onChange(selected.filter((c) => c !== value));
  const toggle = (value: string) =>
    selected.includes(value) ? remove(value) : add([value]);

  const ringClass =
    tone === 'avoid' ? 'outline-destructive' : 'outline-signature';

  return (
    <section className={cn('space-y-4', className)} aria-label={label}>
      <div>
        <h3 className="text-[15px] font-bold">{label}</h3>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>

      {/* What's chosen, always visible */}
      <div className="flex min-h-[36px] flex-wrap gap-1.5" aria-live="polite">
        {selected.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('selectedNone')}</p>
        ) : (
          selected.map((value) => (
            <span
              key={value}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-panel pl-1.5 pr-1 text-sm font-semibold"
            >
              <span
                aria-hidden
                className="h-6 w-6 rounded-full ring-1 ring-inset ring-black/10 dark:ring-white/15"
                style={{ backgroundColor: clothingColorHex(value) ?? 'transparent' }}
              />
              {colorLabel(value)}
              <button
                type="button"
                onClick={() => remove(value)}
                aria-label={t('remove', { name: colorLabel(value) })}
                className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </span>
          ))
        )}
      </div>

      {/* Named palette */}
      <div className="space-y-2">
        <p className="eyebrow">{t('allColors')}</p>
        <div className="flex flex-wrap gap-2">
          {CLOTHING_COLORS.map((color) => {
            const isSelected = selected.includes(color.value);
            const name = colorLabel(color.value);
            const light = isLightColor(color.hex);
            return (
              <button
                key={color.value}
                type="button"
                onClick={() => toggle(color.value)}
                aria-pressed={isSelected}
                aria-label={name}
                title={name}
                className={cn(
                  'flex h-11 w-11 items-center justify-center rounded-full ring-1 ring-inset ring-black/10 transition-transform duration-150 dark:ring-white/15',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  isSelected
                    ? cn('scale-105 outline outline-[2.5px] outline-offset-2', ringClass)
                    : 'hover:scale-105'
                )}
                style={{ backgroundColor: color.hex }}
              >
                {isSelected &&
                  (tone === 'avoid' ? (
                    <X className={cn('h-5 w-5', light ? 'text-black' : 'text-white')} strokeWidth={2.5} />
                  ) : (
                    <Check className={cn('h-5 w-5', light ? 'text-black' : 'text-white')} strokeWidth={2.5} />
                  ))}
              </button>
            );
          })}
        </div>
      </div>

      {/* Quick palettes */}
      <div className="space-y-2">
        <p className="eyebrow">{t('presets')}</p>
        <div className="flex flex-wrap gap-2">
          {COLOR_PRESETS.map((preset) => {
            const name = t(`presetNames.${preset.id}` as 'presetNames.earth');
            const allIn = preset.colors.every((c) => selected.includes(c));
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => add(preset.colors)}
                disabled={allIn}
                aria-label={t('presetAria', {
                  name,
                  colors: preset.colors.map((c) => colorLabel(c)).join(', '),
                })}
                className={cn(
                  'inline-flex h-11 items-center gap-2 rounded-full border-[1.5px] border-border bg-background pl-2 pr-3.5 text-sm font-semibold transition-colors',
                  'hover:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  'disabled:cursor-default disabled:opacity-50'
                )}
              >
                <span aria-hidden className="flex -space-x-1.5">
                  {preset.colors.slice(0, 4).map((c) => (
                    <span
                      key={c}
                      className="h-5 w-5 rounded-full ring-2 ring-background"
                      style={{ backgroundColor: clothingColorHex(c) }}
                    />
                  ))}
                </span>
                {name}
                {allIn ? <Check className="h-4 w-4" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Colour wheel */}
      <div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-expanded={wheelOpen}
          onClick={() => setWheelOpen((o) => !o)}
        >
          <Pipette className="h-4 w-4" strokeWidth={1.75} />
          {wheelOpen ? t('wheelClose') : t('wheelOpen')}
        </Button>
        {wheelOpen && (
          <div className="mt-3 flex flex-col items-center gap-4 rounded-lg bg-panel p-4 sm:flex-row sm:items-center sm:gap-6">
            <ColorWheel
              onChange={setPickedHex}
              label={t('wheelLabel')}
              lightnessLabel={t('lightness')}
            />
            <div className="flex w-full flex-col items-center gap-3 sm:items-start">
              <div className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="h-12 w-12 rounded-full ring-1 ring-inset ring-black/10 dark:ring-white/15"
                  style={{ backgroundColor: pickedHex }}
                />
                <span aria-hidden className="text-muted-foreground">→</span>
                <span
                  aria-hidden
                  className="h-12 w-12 rounded-full ring-1 ring-inset ring-black/10 dark:ring-white/15"
                  style={{ backgroundColor: clothingColorHex(nearest) }}
                />
              </div>
              <p className="text-sm font-semibold" aria-live="polite">
                {t('closestTo', { name: colorLabel(nearest) })}
              </p>
              <Button
                type="button"
                variant={tone === 'avoid' ? 'default' : 'signature'}
                onClick={() => {
                  if (selected.includes(nearest)) {
                    toast.message(t('alreadyAdded', { name: colorLabel(nearest) }));
                    return;
                  }
                  add([nearest]);
                }}
              >
                <Plus className="h-4 w-4" />
                {t('add', { name: colorLabel(nearest) })}
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
