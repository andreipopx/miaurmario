'use client';

import dynamic from 'next/dynamic';

// The tour and the style quiz are ~1,000 lines between them and open rarely (first
// run, or on request): load them after the screen is up, not as part of it.
export const LazyFeatureTour = dynamic(
  () => import('@/components/onboarding/feature-tour').then((m) => m.FeatureTour),
  { ssr: false }
);

export const LazyStyleQuizDialog = dynamic(
  () => import('@/components/style-quiz/style-quiz-dialog').then((m) => m.StyleQuizDialog),
  { ssr: false }
);
