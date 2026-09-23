'use client';

import { useCallback, useMemo } from 'react';

import { useUpdateUserProfile, useUserProfile } from '@/lib/hooks/use-user';
import { type Sizes, mergeSizes, sizesFrom } from '@/lib/style-quiz/cards';

/**
 * «Tus tallas habituales»: arriba, abajo y calzado.
 *
 * They are **not** a new field. They are the `shirt_size` / `pants_size` /
 * `shoe_size` the settings form already stores in `body_measurements`, so the
 * quiz, Ajustes → Tu estilo, the stylist prompt and the shop-link import all
 * read and write the same three values. Saving merges rather than replaces:
 * height, weight and the rest are none of this hook's business.
 *
 * (The `inseam` field was deliberately dropped from the app; nothing here
 * brings it back.)
 */
export function useHabitualSizes() {
  const { data: profile, isLoading } = useUserProfile();
  const update = useUpdateUserProfile();
  const measurements = profile?.body_measurements;

  const saved = useMemo(() => sizesFrom(measurements), [measurements]);

  const save = useCallback(
    (next: Sizes) => {
      const merged = mergeSizes(measurements, next);
      // Match the settings form: nothing left means "no measurements", not "{}".
      return update.mutateAsync({ body_measurements: Object.keys(merged).length ? merged : null });
    },
    [measurements, update]
  );

  return { saved, save, isSaving: update.isPending, isLoading };
}
