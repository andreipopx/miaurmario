'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Camera, ChevronRight, Gift, Shield } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { LazyStinky } from '@/components/native/lazy-stinky';
import { useStinkyPersona } from '@/components/stinky/stinky-persona';
import { useHabit, useHabitFollowsChanges, type Habit } from '@/lib/hooks/use-habit';
import { haptic } from '@/lib/native/haptics';
import { cn } from '@/lib/utils';

/** Monday-first days of the week the habit's `today` falls in, as ISO dates. */
export function weekOf(todayIso: string): string[] {
  const today = new Date(`${todayIso}T12:00:00Z`);
  const offset = (today.getUTCDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() - offset + i);
    return d.toISOString().slice(0, 10);
  });
}

/** The next accessory his meals will unlock, and at how many meals. */
export function nextReward(habit: Habit): { accessory: string; at: number } | null {
  const next = Object.entries(habit.accessories)
    .filter(([, level]) => level > habit.level)
    .sort((a, b) => a[1] - b[1])[0];
  if (!next) return null;
  return { accessory: next[0], at: habit.levels[next[1]] };
}

/**
 * Hoy: Stinky eats the looks you log. One meal a day (Me lo pongo, Qué llevo…),
 * the week's days, the streak in weeks, and what the next meals unlock. Never a
 * guilt trip: after a gap he is glad you are back.
 */
export function StinkyMeals() {
  const t = useTranslations('habit');
  const tAcc = useTranslations('habit.accessories');
  const tWrapped = useTranslations('wrapped');
  const locale = useLocale();
  const { name } = useStinkyPersona();
  const { data: habit } = useHabit();
  useHabitFollowsChanges();

  // The moment a look is logged today: he eats it (and says so once).
  const [eating, setEating] = useState(false);
  const before = useRef<Habit | null>(null);
  useEffect(() => {
    if (!habit) return;
    const prev = before.current;
    before.current = habit;
    if (!prev || prev.today !== habit.today) return;
    if (!prev.fed_today && habit.fed_today) {
      setEating(true);
      haptic(18);
      const unlocked = habit.unlocked.filter((a) => !prev.unlocked.includes(a));
      if (unlocked.length) {
        toast.success(t('levelUp', { level: habit.level + 1 }), {
          description: t('unlockedNow', { item: tAcc(unlocked[0]) }),
        });
      } else {
        toast.success(t('ate', { name }));
      }
    }
  }, [habit, name, t, tAcc]);

  if (!habit) return null;

  const days = weekOf(habit.today);
  const logged = new Set(habit.week_days);
  const weekday = (iso: string) =>
    new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));
  const reward = nextReward(habit);
  const toNext = habit.next_level_at != null ? habit.next_level_at - habit.meals : 0;
  const span = habit.next_level_at != null ? habit.next_level_at - habit.level_starts_at : 1;
  const pct = habit.next_level_at != null ? Math.round(((habit.meals - habit.level_starts_at) / span) * 100) : 100;
  const wearing = habit.unlocked.length > 0 && !habit.accessory;

  const mood = eating ? 'bite' : habit.fed_today ? 'idle' : habit.welcome_back ? 'sleepy' : 'idle';
  const title = habit.fed_today ? t('fedTitle') : habit.welcome_back ? t('backTitle') : t('hungryTitle');
  const body = habit.fed_today
    ? habit.week_met
      ? t('fedWeekMet', { goal: habit.weekly_goal })
      : t('fedBody', { left: habit.weekly_goal - habit.week_days.length })
    : habit.welcome_back
      ? t('backBody')
      : t('hungryBody');

  return (
    <section aria-labelledby="stinky-meals-title" className="rounded-lg bg-panel p-4 sm:p-5" data-testid="stinky-meals">
      <div className="flex gap-4">
        <div className="flex h-[92px] w-[92px] shrink-0 items-center justify-center rounded-full bg-signature-soft">
          <LazyStinky state={mood} settleTo="idle" size={84} label="" onDone={() => setEating(false)} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="stinky-meals-title" className="text-[17px] font-extrabold leading-tight tracking-tight">
            {title}
          </h2>
          <p className="mt-1 text-[13.5px] leading-snug text-muted-foreground">{body}</p>
          <ol className="mt-3 flex gap-1.5" aria-label={t('weekLabel', { count: habit.week_days.length, goal: habit.weekly_goal })}>
            {days.map((d) => {
              const done = logged.has(d);
              const isToday = d === habit.today;
              const future = d > habit.today;
              return (
                <li key={d} className="flex flex-col items-center gap-1">
                  <span
                    className={cn(
                      'flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold',
                      done
                        ? 'bg-foreground text-background'
                        : isToday
                          ? 'border-2 border-foreground bg-background'
                          : 'bg-background',
                      future && 'opacity-50'
                    )}
                    aria-label={done ? t('dayDone') : undefined}
                  >
                    {done ? '✓' : ''}
                  </span>
                  <span className={cn('text-[11px] uppercase', isToday ? 'font-bold' : 'text-muted-foreground')} aria-hidden>
                    {weekday(d)}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-quick bg-background p-3">
          <p className="text-[12px] font-semibold text-muted-foreground">{t('streak')}</p>
          <p className="text-[17px] font-extrabold">{t('weeks', { count: habit.streak_weeks })}</p>
          <p className="mt-0.5 flex items-center gap-1 text-[11.5px] text-muted-foreground">
            <Shield className="h-3 w-3 shrink-0" aria-hidden />
            {habit.comodin_left_this_month ? t('comodinLeft') : t('comodinUsed')}
          </p>
        </div>
        <div className="rounded-quick bg-background p-3">
          <p className="text-[12px] font-semibold text-muted-foreground">{t('level', { level: habit.level + 1 })}</p>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-panel" aria-hidden>
            <div className="h-full rounded-full bg-foreground" style={{ width: `${Math.max(6, pct)}%` }} />
          </div>
          <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">
            {reward
              ? t('toReward', { count: reward.at - habit.meals, item: tAcc(reward.accessory) })
              : toNext > 0
                ? t('toLevel', { count: toNext })
                : t('maxLevel')}
          </p>
        </div>
      </div>

      <Link
        href="/dashboard/wrapped"
        className="mt-3 flex items-center justify-between rounded-quick bg-background px-3 py-2.5 text-[13.5px] font-semibold"
      >
        {tWrapped('cta', { name })}
        <ChevronRight className="h-4 w-4" aria-hidden />
      </Link>

      {(wearing || !habit.fed_today) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {wearing && (
            <Button asChild size="sm" variant="signature">
              <Link href="/dashboard/stinky/customize#armario">
                <Gift className="h-4 w-4" aria-hidden />
                {t('dressHim', { item: tAcc(habit.unlocked[habit.unlocked.length - 1]) })}
              </Link>
            </Button>
          )}
          {!habit.fed_today && (
            <Button asChild size="sm" variant="secondary">
              <Link href="/dashboard/selfie">
                <Camera className="h-4 w-4" aria-hidden />
                {t('woreSomethingElse')}
              </Link>
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
