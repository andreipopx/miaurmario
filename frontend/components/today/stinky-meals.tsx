'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ChevronRight } from 'lucide-react';

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
      window.setTimeout(() => setEating(false), 700);
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
  const wearing = habit.unlocked.length > 0 && !habit.accessory;
  const title = habit.fed_today ? t('fedTitle') : habit.welcome_back ? t('backTitle') : t('hungryTitle');

  return (
    <section aria-labelledby="stinky-meals-title" className="rounded-lg bg-panel px-4 py-3.5" data-testid="stinky-meals">
      <div className="flex items-center justify-between gap-3">
        <h2 id="stinky-meals-title" className="min-w-0 truncate text-[15px] font-bold">
          {title}
        </h2>
        <Link href="/dashboard/wrapped" className="flex shrink-0 items-center text-[13px] font-semibold text-muted-foreground">
          {t('month')}
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
      <div className="mt-2.5 flex items-end justify-between gap-3">
        <ol className="flex gap-1.5" aria-label={t('weekLabel', { count: habit.week_days.length, goal: habit.weekly_goal })}>
          {days.map((d) => {
            const done = logged.has(d);
            const isToday = d === habit.today;
            return (
              <li key={d} className="flex flex-col items-center gap-1">
                <span
                  className={cn(
                    'h-6 w-6 rounded-full transition-transform duration-300',
                    done ? 'bg-foreground' : isToday ? 'border-2 border-foreground' : 'bg-background',
                    done && isToday && eating && 'scale-125',
                    d > habit.today && 'opacity-50'
                  )}
                  aria-label={done ? t('dayDone') : undefined}
                />
                <span className={cn('text-[10.5px] uppercase', isToday ? 'font-bold' : 'text-muted-foreground')} aria-hidden>
                  {weekday(d)}
                </span>
              </li>
            );
          })}
        </ol>
        <p className="pb-4 text-right text-[12.5px] leading-tight text-muted-foreground">
          <span className="block font-semibold text-foreground">{t('streakShort', { count: habit.streak_weeks })}</span>
          {reward ? t('toReward', { count: reward.at - habit.meals, item: tAcc(reward.accessory) }) : t('maxLevel')}
        </p>
      </div>
      {(wearing || !habit.fed_today) && (
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px] font-semibold">
          {wearing && (
            <Link href="/dashboard/stinky/customize#armario" className="underline-offset-4 hover:underline">
              {t('dressHim', { item: tAcc(habit.unlocked[habit.unlocked.length - 1]) })}
            </Link>
          )}
          {!habit.fed_today && (
            <Link href="/dashboard/selfie" className="text-muted-foreground underline-offset-4 hover:underline">
              {t('woreSomethingElse')}
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
