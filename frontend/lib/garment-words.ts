'use client';

import { useTranslations } from 'next-intl';

import { useStyleQuiz } from '@/lib/hooks/use-style-quiz';
import { useTagLabel } from '@/lib/tag-labels';

/**
 * What to call a garment, in the user's own vocabulary.
 *
 * Most clothing types have one obvious Spanish word (`jeans` → vaqueros), and
 * those come from `clothingTypes` as always. A handful genuinely differ by
 * which section of a shop you buy them in — a `shirt` is a *camisa* or a
 * *blusa* — and for those we use the answer to «¿qué ropa quieres que te
 * proponga?».
 *
 * If that question was never answered (or the user preferred not to say), this
 * is exactly `useTagLabel('types', …)`: nothing is guessed from a name, a
 * photo, a handle or what is already in the wardrobe.
 */
export function useGarmentWord() {
  const label = useTagLabel();
  const words = useTranslations('firstRun.styleQuiz.garmentWords');
  const { data } = useStyleQuiz();
  const pref = data?.profile.garment_pref;

  return (type: string | null | undefined): string => {
    const key = (type ?? '').trim().toLocaleLowerCase();
    if (key && (pref === 'masculina' || pref === 'femenina')) {
      const path = `${pref}.${key}`;
      if (words.has(path)) return words(path);
    }
    return label('types', type ?? '');
  };
}
