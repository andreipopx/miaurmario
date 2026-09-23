'use client';

import { useTranslations } from 'next-intl';
import { CareComposition, CareInfo } from '@/lib/types';

/**
 * Care data is stored in English slugs and hint codes (the same shape whether
 * AI read the label or the user typed it), so every screen localises it here.
 */

function humanize(value: string): string {
  return value.replace(/[-_]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/** "cotton" -> "Algodón" */
export function useFiberLabel() {
  const t = useTranslations('wardrobe.care');
  return (fiber: string): string => {
    const key = `fibers.${fiber}`;
    return t.has(key) ? t(key) : humanize(fiber);
  };
}

/** "wash_30" -> "Lavar a 30°", "no_tumble" -> "Nada de secadora" */
export function useCareHintLabel() {
  const t = useTranslations('wardrobe.care');
  return (hint: string): string => {
    const [prefix, value] = [hint.slice(0, hint.indexOf('_') + 1), hint.slice(hint.indexOf('_') + 1)];
    if (prefix === 'wash_' && /^\d+$/.test(value)) {
      return t('hints.washTemp', { temp: value });
    }
    if (prefix === 'iron_' && /^\d+$/.test(value)) {
      return t('hints.ironTemp', { temp: value });
    }
    const key = `hints.${hint}`;
    return t.has(key) ? t(key) : humanize(hint);
  };
}

/** "60% algodón, 40% poliéster" for the composition field and the detail view. */
export function useCompositionText() {
  const fiberLabel = useFiberLabel();
  return (composition: CareComposition[] | undefined | null): string =>
    (composition ?? [])
      .map((entry) =>
        entry.percent == null ? fiberLabel(entry.fiber) : `${entry.percent}% ${fiberLabel(entry.fiber)}`
      )
      .join(', ');
}

/** Hint codes for care we hold locally (the backend computes the same list). */
export function localCareHints(care: CareInfo | null | undefined): string[] {
  if (!care) return [];
  const hints: string[] = [];
  const wash = care.wash;
  const dry = care.dry;
  const iron = care.iron;
  const professional = care.professional;

  if (wash?.do_not_wash) hints.push('do_not_wash');
  else if (wash?.hand_wash) hints.push('hand_wash');
  else if (wash?.max_temp_c) hints.push(`wash_${wash.max_temp_c}`);
  else if (wash?.machine) hints.push('machine_wash');
  if (wash?.cycle === 'gentle' || wash?.cycle === 'delicate') hints.push(`cycle_${wash.cycle}`);
  if (dry?.tumble_dry === false) hints.push('no_tumble');
  else if (dry?.tumble_dry && dry.tumble_heat) hints.push(`tumble_${dry.tumble_heat}`);
  if (dry?.flat_dry) hints.push('flat_dry');
  else if (dry?.line_dry) hints.push('line_dry');
  if (iron?.allowed === false) hints.push('no_iron');
  else if (iron?.max_temp_c) hints.push(`iron_${iron.max_temp_c}`);
  if (professional?.dry_clean) hints.push('dry_clean');
  else if (professional?.dry_clean === false) hints.push('no_dry_clean');
  if (care.bleach === 'none') hints.push('no_bleach');
  return hints;
}
