'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';

/**
 * One place to turn AI/tag values (always English — they are the data
 * contract with the tagger and the scorer) into display labels:
 * "tan" -> "Camel", "leather" -> "Cuero", "all-season" -> "Todo el año".
 *
 * Translations live in messages `tagValues.<kind>` (types reuse
 * `clothingTypes`). Unknown values fall back to a humanised version of the
 * raw value so new tagger output never renders blank.
 */
export type TagKind =
  | 'colors'
  | 'types'
  | 'patterns'
  | 'materials'
  | 'styles'
  // The more specific name inside a type: a halter top, a falda plisada. The
  // vocabulary lives in `lib/subtypes`; a subtype in no catalogue — an old
  // free-text entry, a word the model invented — falls through to the humanised
  // slug below rather than rendering blank.
  | 'subtypes'
  | 'formality'
  | 'seasons'
  | 'fit'
  | 'occasions';

export function humanizeTagValue(value: string): string {
  if (!value) return value;
  const text = value.replace(/[-_]+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function keyOf(value: string): string | null {
  const key = value?.trim().toLowerCase();
  // next-intl treats dots as nesting; tag values only use dashes.
  if (!key || key.includes('.')) return null;
  return key;
}

export function useTagLabel() {
  const t = useTranslations('tagValues');
  const tTypes = useTranslations('clothingTypes');
  return useCallback(
    (kind: TagKind, value: string | null | undefined): string => {
      if (!value) return '';
      const key = keyOf(value);
      if (key) {
        if (kind === 'types') {
          if (tTypes.has(key as never)) return tTypes(key as never);
        } else {
          const path = `${kind}.${key}`;
          if (t.has(path as never)) return t(path as never);
        }
      }
      return humanizeTagValue(value);
    },
    [t, tTypes]
  );
}

/** Convenience for the most common case. */
export function useColorLabel() {
  const label = useTagLabel();
  return useCallback((value: string | null | undefined) => label('colors', value), [label]);
}
