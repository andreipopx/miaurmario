'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MAX_CHIPS, addChip, removeChip } from '@/lib/style-quiz/cards';

export interface ChipFieldProps {
  label: string;
  hint?: string;
  placeholder?: string;
  values: string[];
  onChange: (values: string[]) => void;
  /** `data-testid` for the text input, so tests can target one field of several. */
  testId?: string;
}

/**
 * Free-text answers as chips: type, press Enter (or the + button), remove with
 * the × on each chip. No fixed list — brands, references and "nunca me pongo"
 * are the user's own words.
 */
export function ChipField({ label, hint, placeholder, values, onChange, testId }: ChipFieldProps) {
  const t = useTranslations('firstRun.styleQuiz');
  const [draft, setDraft] = useState('');
  const inputId = useId();
  const full = values.length >= MAX_CHIPS;

  const commit = () => {
    const next = addChip(values, draft);
    if (next.length !== values.length) onChange(next);
    setDraft('');
  };

  return (
    <div className="min-w-0">
      <Label htmlFor={inputId} className="block">
        {label}
      </Label>
      {hint && <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{hint}</p>}

      <div className="mt-2 flex gap-2">
        <Input
          id={inputId}
          data-testid={testId}
          value={draft}
          disabled={full}
          placeholder={full ? t('chipsFull') : placeholder}
          enterKeyHint="done"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter adds without submitting anything; comma is a natural separator.
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              commit();
            }
          }}
          className="min-w-0 flex-1"
        />
        <Button type="button" size="icon" variant="outline" onClick={commit} disabled={full || !draft.trim()} aria-label={t('addChip')}>
          <Plus className="h-4 w-4" strokeWidth={2} aria-hidden />
        </Button>
      </div>

      {values.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {values.map((value) => (
            <li key={value}>
              <button
                type="button"
                onClick={() => onChange(removeChip(values, value))}
                aria-label={t('removeChip', { value })}
                className="inline-flex min-h-[36px] max-w-full items-center gap-1.5 rounded-full border-[1.5px] border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0 break-words text-left">{value}</span>
                <X className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2.5} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
