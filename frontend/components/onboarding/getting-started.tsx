'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Check, ChevronRight, X } from 'lucide-react';
import { toast } from 'sonner';

import { useStinkyPersona } from '@/components/stinky/stinky-persona';
import { useNotificationPreferences, useUpdateNotificationPreferences } from '@/lib/hooks/use-notifications';
import { useOutfits } from '@/lib/hooks/use-outfits';
import { useSeenTips } from '@/lib/hooks/use-seen-tips';
import { openStyleQuiz, useStyleQuiz } from '@/lib/hooks/use-style-quiz';
import {
  GETTING_STARTED_KEY,
  gettingStartedSteps,
  showGettingStarted,
  type GettingStartedStep,
} from '@/lib/onboarding/getting-started';
import type { WardrobeStage } from '@/lib/onboarding/first-run';
import { isDefaultPersona } from '@/lib/stinky-persona';
import { cn } from '@/lib/utils';

const HREF: Partial<Record<GettingStartedStep, string>> = {
  wardrobe: '/dashboard/wardrobe?bulk=1',
  firstLook: '#today-look-title',
  cat: '/dashboard/stinky/customize',
  tomorrow: '/dashboard/notifications',
};

/** «Primeros pasos» on Hoy (see lib/onboarding/getting-started.ts for the rules). */
export function GettingStarted({ stage, target }: { stage: WardrobeStage; target: number }) {
  const t = useTranslations('firstRun.gettingStarted');
  const persona = useStinkyPersona();
  const { seen, markSeen } = useSeenTips();
  const quiz = useStyleQuiz();
  const looks = useOutfits({}, 1, 1);
  const prefs = useNotificationPreferences();
  const updatePrefs = useUpdateNotificationPreferences();

  // Wait for what the steps are read from: a card that ticks itself a second
  // after appearing reads as a glitch.
  if (!quiz.data || !looks.data || !prefs.data) return null;
  const state = {
    stage,
    quizAnswered: quiz.data.answered,
    hasLook: looks.data.total > 0,
    catNamed: !isDefaultPersona(persona),
    tomorrowOn: prefs.data.push.tomorrow_look || prefs.data.email.tomorrow_look,
  };
  if (!showGettingStarted(state, seen)) return null;
  const steps = gettingStartedSteps(state);
  const done = steps.filter((s) => s.done).length;

  /** «Tu look de mañana» in one tap when this phone already gets notifications. */
  const enableTomorrow = () =>
    updatePrefs.mutate(
      { push: { tomorrow_look: true } },
      { onSuccess: () => toast.success(t('tomorrowOn')) }
    );
  const pushReady = prefs.data.push_available && prefs.data.push_devices > 0;

  return (
    <section aria-labelledby="getting-started-title" className="rounded-lg bg-panel p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="getting-started-title" className="text-[17px] font-extrabold tracking-tight">
            {t('title')}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('progress', { done, total: steps.length })}</p>
        </div>
        <button
          type="button"
          onClick={() => markSeen([GETTING_STARTED_KEY])}
          aria-label={t('hide')}
          className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" strokeWidth={2} aria-hidden />
        </button>
      </div>

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={done}
        aria-label={t('progress', { done, total: steps.length })}
        className="mt-3 h-2 w-full overflow-hidden rounded-full bg-background"
      >
        <div className="h-full rounded-full bg-foreground transition-[width] duration-500" style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>

      <ol className="mt-3 space-y-1.5">
        {steps.map(({ key, done: isDone }) => {
          const body = (
            <>
              <span
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-[1.5px]',
                  isDone ? 'border-foreground bg-foreground text-background' : 'border-border'
                )}
                aria-hidden
              >
                {isDone && <Check className="h-4 w-4" strokeWidth={2.75} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn('block text-[15px] font-bold leading-tight', isDone && 'text-muted-foreground line-through')}>
                  {t(`steps.${key}.title`)}
                </span>
                {!isDone && (
                  <span className="block text-[13px] text-muted-foreground">{t(`steps.${key}.body`, { target })}</span>
                )}
              </span>
              {!isDone && <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />}
            </>
          );
          const rowClass =
            'flex min-h-[52px] w-full items-center gap-3 rounded-2xl px-2 py-2 text-left transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
          if (isDone) {
            return (
              <li key={key} className="flex items-center gap-3 px-2 py-1.5">
                {body}
              </li>
            );
          }
          if (key === 'style') {
            return (
              <li key={key}>
                <button type="button" className={rowClass} onClick={() => openStyleQuiz('fresh')}>
                  {body}
                </button>
              </li>
            );
          }
          if (key === 'tomorrow' && pushReady) {
            return (
              <li key={key}>
                <button type="button" className={rowClass} onClick={enableTomorrow} disabled={updatePrefs.isPending}>
                  {body}
                </button>
              </li>
            );
          }
          return (
            <li key={key}>
              <Link href={HREF[key] ?? '/dashboard'} className={rowClass}>
                {body}
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
