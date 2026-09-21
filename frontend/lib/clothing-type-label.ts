'use client';

import { useTranslations } from 'next-intl';

/**
 * Localized label for a clothing type value ("t-shirt" → "Camiseta").
 * Falls back to the raw value (capitalised) for types the backend invents.
 */
export function useClothingTypeLabel() {
  const t = useTranslations('clothingTypes');
  return (type: string): string => {
    // next-intl treats dots as nesting; our values only use dashes.
    if (type && !type.includes('.') && t.has(type as never)) return t(type as never);
    return type ? type.charAt(0).toUpperCase() + type.slice(1).replace(/[-_]/g, ' ') : type;
  };
}
