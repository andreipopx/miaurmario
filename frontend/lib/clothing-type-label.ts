'use client';

import { useCallback } from 'react';
import { useTagLabel } from '@/lib/tag-labels';

/**
 * Localized label for a clothing type value ("t-shirt" → "Camiseta").
 * Falls back to the raw value (capitalised) for types the backend invents.
 */
export function useClothingTypeLabel() {
  const label = useTagLabel();
  return useCallback((type: string): string => label('types', type), [label]);
}
