'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MAX_SIZE_LENGTH, type SizeKey, type Sizes } from '@/lib/style-quiz/cards';

/**
 * The three habitual sizes, as free text — every shop numbers them
 * differently, so there is no dropdown to be wrong about. All three are
 * optional and each one can be left blank.
 *
 * Deliberately about the garment, not the person: "arriba / abajo / calzado",
 * no measurement, no comment.
 */
const FIELDS: readonly { key: SizeKey; label: string; placeholder: string; testId: string }[] = [
  { key: 'shirt_size', label: 'top', placeholder: 'placeholderTop', testId: 'size-top' },
  { key: 'pants_size', label: 'bottom', placeholder: 'placeholderBottom', testId: 'size-bottom' },
  { key: 'shoe_size', label: 'shoe', placeholder: 'placeholderShoe', testId: 'size-shoe' },
];

export interface SizeFieldsProps {
  values: Sizes;
  onChange: (values: Sizes) => void;
}

export function SizeFields({ values, onChange }: SizeFieldsProps) {
  const t = useTranslations('firstRun.styleQuiz.sizes');
  const uid = useId();

  return (
    <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-3">
      {FIELDS.map(({ key, label, placeholder, testId }) => (
        <div key={key} className="min-w-0">
          <Label htmlFor={`${uid}-${key}`} className="block">
            {t(label)}
          </Label>
          <Input
            id={`${uid}-${key}`}
            data-testid={testId}
            value={values[key] ?? ''}
            maxLength={MAX_SIZE_LENGTH}
            placeholder={t(placeholder)}
            autoComplete="off"
            enterKeyHint="done"
            onChange={(e) => onChange({ ...values, [key]: e.target.value })}
            className="mt-1 w-full"
          />
        </div>
      ))}
    </div>
  );
}

/** "arriba M · abajo 42 · calzado 41" — for the reminder at a shop link. */
export function useSizeSummary() {
  const t = useTranslations('firstRun.styleQuiz.sizes');
  return (values: Sizes) =>
    FIELDS.filter(({ key }) => values[key]?.trim())
      .map(({ key, label }) => `${t(label).toLocaleLowerCase()} ${values[key]!.trim()}`)
      .join(' · ');
}
