'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Input } from '@/components/ui/input';
import { isKnownSubtype, subtypesFor } from '@/lib/subtypes';
import { useTagLabel } from '@/lib/tag-labels';
import { cn } from '@/lib/utils';

/**
 * The subtype row: one tap for the detail this type actually comes in, and an
 * "otro" box for the one it does not.
 *
 * Subtype used to be a free-text input, which is why the wardrobe is full of the
 * tagger's guesses — it answered `wrap` for a halter top and nobody was ever
 * going to type over it. Buttons are the fix: the right word is one tap away, and
 * the escape hatch stays for a garment the vocabulary has not met.
 *
 * Deliberately free of any bulk-upload context: it takes a type, a value and a
 * setter, so it drops into the review grid, the stepper and a plain edit form
 * alike. Every control is a real `<button>` or `<input>`, at least 44 px tall, and
 * the row wraps, so it survives 320 px at 125 %.
 */
export function SubtypeField({
  type,
  value,
  onChange,
  idPrefix,
  className,
}: {
  /** The garment's type. Decides which buttons appear; may be absent. */
  type?: string | null;
  /** The stored subtype: a slug from the map, a legacy free-text word, or nothing. */
  value?: string | null;
  /** `null` clears the subtype. Callers store the string exactly as given. */
  onChange: (subtype: string | null) => void;
  /** Namespace for this instance's ids; the review grid renders one per garment. */
  idPrefix?: string;
  className?: string;
}) {
  const t = useTranslations('bulkUpload.stepper');
  const tagLabel = useTagLabel();
  const options = subtypesFor(type);
  const fallbackId = useId();
  const prefix = idPrefix ?? fallbackId;
  const otherInput = useRef<HTMLInputElement>(null);

  const stored = value?.trim() ?? '';
  const known = isKnownSubtype(type, stored);

  /**
   * The "otro" box is open whenever it holds the answer: because the stored value
   * is not one of this type's buttons — an old free-text subtype, or a word this
   * type does not offer — or because the user asked for it.
   */
  const [otherOpen, setOtherOpen] = useState(Boolean(stored) && !known);
  /**
   * The box keeps its own copy of the text. Rendering straight off `value` would
   * mean the parent re-renders the whole review grid on every keystroke, and would
   * eat a trailing space as the round trip trims it.
   */
  const [draft, setDraft] = useState(known ? '' : stored);
  /** The last text we pushed up, so its echo back down is not mistaken for a new garment. */
  const emitted = useRef<string | null>(null);

  // A different garment arrived (the grid reuses a row, the stepper advances, the
  // type changed under us): resync, or the last garment's word sits in the box.
  useEffect(() => {
    if (emitted.current !== null && emitted.current.trim() === stored) return;
    emitted.current = null;
    setDraft(known ? '' : stored);
    setOtherOpen(Boolean(stored) && !known);
  }, [stored, known]);

  // Nothing to detail yet. A lone "otro" button under an unanswered "¿qué prenda
  // es?" is noise, so the row appears with the type — unless something is already
  // stored, which must stay visible and editable whatever the type says.
  if (!type && !stored) return null;

  const chip = (active: boolean) =>
    cn(
      'min-h-[44px] rounded-full px-3 text-[14px] font-semibold transition-colors active:scale-[0.97]',
      active ? 'bg-primary text-primary-foreground' : 'bg-panel text-foreground hover:bg-secondary'
    );

  const emit = (next: string) => {
    emitted.current = next;
    setDraft(next);
    onChange(next.trim() ? next : null);
  };

  return (
    <fieldset className={className} data-testid="subtype-field">
      <legend className="mb-2 text-[13px] font-semibold">
        {t('subtypeLegend')}{' '}
        <span className="font-normal text-muted-foreground">{t('subtypeHint')}</span>
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((subtype) => {
          const active = !otherOpen && stored === subtype;
          return (
            <button
              key={subtype}
              type="button"
              aria-pressed={active}
              onClick={() => {
                emitted.current = null;
                setOtherOpen(false);
                setDraft('');
                // Tapping the pressed one again clears it: a subtype is optional, and
                // a row of buttons with no way back out is a trap.
                onChange(active ? null : subtype);
              }}
              className={chip(active)}
            >
              {tagLabel('subtypes', subtype)}
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={otherOpen}
          aria-expanded={otherOpen}
          aria-controls={`${prefix}-subtype-other`}
          onClick={() => {
            if (otherOpen) {
              emitted.current = null;
              setOtherOpen(false);
              setDraft('');
              onChange(null);
              return;
            }
            // Whatever is stored is the sensible starting point, so a legacy
            // "boho-wrap" is edited rather than retyped from nothing.
            setDraft(stored);
            emitted.current = stored;
            setOtherOpen(true);
            requestAnimationFrame(() => otherInput.current?.focus());
          }}
          className={chip(otherOpen)}
        >
          {t('subtypeOther')}
        </button>
      </div>
      {otherOpen && (
        <div className="mt-2">
          <label className="sr-only" htmlFor={`${prefix}-subtype-other`}>
            {t('subtypeOtherLabel')}
          </label>
          <Input
            ref={otherInput}
            id={`${prefix}-subtype-other`}
            name={`${prefix}-subtype-other`}
            className="h-11"
            value={draft}
            // The column is String(50); refusing the 51st character here beats a
            // silent truncation on the server.
            maxLength={50}
            placeholder={t('subtypeOtherPlaceholder')}
            onChange={(event) => emit(event.target.value)}
          />
        </div>
      )}
    </fieldset>
  );
}
