'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { TransitionLink } from '@/components/native/transition-link';
import Image from 'next/image';
import { useFormatter, useTranslations } from 'next-intl';
import { useClothingTypeLabel } from '@/lib/clothing-type-label';
import { OutfitFlatLay } from '@/components/outfits/outfit-flat-lay';
import { addDays, isSameDay, startOfWeek } from 'date-fns';
import {
  BarChart3,
  CalendarDays,
  Camera,
  Check,
  ChevronRight,
  Cloud,
  CloudRain,
  CloudSnow,
  HeartHandshake,
  Loader2,
  MapPin,
  MessageCircle,
  Music,
  RefreshCw,
  Shirt,
  Sparkles,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import { useWeatherConditionLabel } from '@/lib/weather-condition';
import { useWeather, type Weather } from '@/lib/hooks/use-weather';
import { usePreferences } from '@/lib/hooks/use-preferences';
import { useItems } from '@/lib/hooks/use-items';
import { useOutfits } from '@/lib/hooks/use-outfits';
import { useFamily } from '@/lib/hooks/use-family';
import { useAuth } from '@/lib/hooks/use-auth';
import { displayValue, tempSymbol, TempUnit } from '@/lib/temperature';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { POP_BG, type PopColor } from '@/components/chip';
import { DayMoments } from '@/components/today/day-moments';
import { InstallHint } from '@/components/install/install-hint';
import { FirstStepsCard } from '@/components/onboarding/first-steps-card';
import {
  MIN_ITEMS_FOR_LOOKS,
  canSuggestLooks,
  wardrobeStage,
} from '@/lib/onboarding/first-run';
import { useWardrobeStats } from '@/lib/hooks/use-wardrobe-stats';

// -- Section header -------------------------------------------------------------

function SectionHeader({ title, href, cta }: { title: string; href?: string; cta?: string }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-4 px-1">
      <h2 className="min-w-0 text-lg font-bold tracking-tight">{title}</h2>
      {href && cta && (
        <Link
          href={href}
          className="-mr-2 inline-flex min-h-[44px] shrink-0 items-center whitespace-nowrap gap-1 rounded-full px-3 text-sm font-semibold text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {cta}
          <ChevronRight className="h-4 w-4" strokeWidth={2} aria-hidden />
        </Link>
      )}
    </div>
  );
}

// -- Quick actions ----------------------------------------------------------------

const QUICK_ACTIONS: { key: string; href: string; icon: LucideIcon; color: PopColor }[] = [
  // Straight to the batch uploader: one garment at a time is what left every
  // wardrobe empty.
  { key: 'quickUpload', href: '/dashboard/wardrobe?bulk=1', icon: Camera, color: 'amber' },
  { key: 'quickCreate', href: '/dashboard/outfits/new', icon: Shirt, color: 'pink' },
  { key: 'quickPlan', href: '/dashboard/history', icon: CalendarDays, color: 'sky' },
  { key: 'quickStats', href: '/dashboard/analytics', icon: BarChart3, color: 'mint' },
];

function QuickActions() {
  const t = useTranslations('dashboard.today');
  return (
    <nav aria-label={t('quickActions')} className="grid grid-cols-4 gap-2 sm:gap-3">
      {QUICK_ACTIONS.map(({ key, href, icon: Icon, color }) => (
        <Link
          key={key}
          href={href}
          className={cn(
            POP_BG[color],
            'flex h-[84px] flex-col items-center justify-center gap-1.5 rounded-quick px-1 text-center text-pop-foreground transition-transform duration-150 hover:-translate-y-0.5 active:scale-[0.97] active:brightness-95 sm:h-24',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
          )}
        >
          <Icon className="h-[22px] w-[22px]" strokeWidth={1.75} aria-hidden />
          <span className="text-[11.5px] font-semibold leading-tight sm:text-[13px]">{t(key)}</span>
        </Link>
      ))}
    </nav>
  );
}

// -- Week strip + weather -----------------------------------------------------------

function weatherIcon(weather: Weather): LucideIcon {
  const c = weather.condition.toLowerCase();
  if (c.includes('snow')) return CloudSnow;
  if (c.includes('rain') || c.includes('drizzle') || c.includes('shower') || c.includes('thunder')) return CloudRain;
  if (c.includes('sun') || c.includes('clear')) return Sun;
  return Cloud;
}

function WeatherBadge() {
  const t = useTranslations('dashboard.weather');
  const conditionLabel = useWeatherConditionLabel();
  const { data: weather, isLoading } = useWeather();
  const { data: prefs } = usePreferences();
  const { user } = useAuth();
  const unit: TempUnit = prefs?.temperature_unit === 'fahrenheit' ? 'fahrenheit' : 'celsius';

  if (isLoading) return <Skeleton className="h-5 w-24 rounded-full" />;
  if (!weather) {
    return (
      <Link
        href="/dashboard/settings"
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-2 text-sm font-semibold hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <MapPin className="h-4 w-4" strokeWidth={1.75} aria-hidden />
        {t('setLocationCta')}
      </Link>
    );
  }
  const Icon = weatherIcon(weather);
  const place = user?.location_name?.split(',')[0];
  return (
    <p className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-sm font-semibold" title={conditionLabel(weather)}>
      <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} aria-hidden />
      <span className="sr-only">{conditionLabel(weather)}, </span>
      {displayValue(weather.temperature, unit)}
      {tempSymbol(unit)}
      {place && <span className="min-w-0 max-w-[9rem] truncate">· {place}</span>}
    </p>
  );
}

function WeekStrip() {
  const t = useTranslations('dashboard.today');
  const format = useFormatter();
  const days = useMemo(() => {
    const today = new Date();
    const monday = startOfWeek(today, { weekStartsOn: 1 });
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(monday, i);
      return { date: d, isToday: isSameDay(d, today) };
    });
  }, []);

  return (
    <section aria-labelledby="week-title">
      <div className="flex items-center justify-between gap-3 px-1">
        <h2 id="week-title" className="shrink-0 text-[15px] font-bold">
          {t('thisWeek')}
        </h2>
        <WeatherBadge />
      </div>
      <ol className="mt-2 flex justify-between">
        {days.map(({ date, isToday }) => {
          const short = format.dateTime(date, { weekday: 'short' }).replace('.', '');
          return (
            <li key={date.toISOString()} className="min-w-0">
              <Link
                href="/dashboard/history"
                aria-current={isToday ? 'date' : undefined}
                aria-label={format.dateTime(date, { weekday: 'long', day: 'numeric', month: 'long' })}
                className="flex w-11 min-w-0 max-w-full flex-col items-center gap-1.5 rounded-full py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="text-xs font-medium capitalize text-muted-foreground" aria-hidden>
                  {short}
                </span>
                <span
                  aria-hidden
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-full text-[15px] font-bold',
                    isToday ? 'bg-signature text-signature-foreground' : 'text-foreground'
                  )}
                >
                  {date.getDate()}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// -- Secondary sections ---------------------------------------------------------------

function WardrobeSection() {
  const t = useTranslations('dashboard.editorial');
  const typeLabel = useClothingTypeLabel();
  const { data, isLoading } = useItems({}, 1, 8);
  const total = data?.total ?? 0;
  const items = data?.items ?? [];

  return (
    <section>
      <SectionHeader
        title={isLoading ? t('sectionWardrobe') : t('wardrobeCount', { count: total })}
        href="/dashboard/wardrobe"
        cta={t('browseWardrobe')}
      />
      {isLoading ? (
        <div className="grid grid-cols-4 gap-2 sm:gap-3">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="aspect-square w-full rounded-tile" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex items-center justify-between gap-4 rounded-lg bg-panel p-4">
          <p className="text-sm font-medium text-muted-foreground">{t('wardrobeEmpty')}</p>
          <Button asChild variant="signature" size="sm">
            <Link href="/dashboard/wardrobe?add=1">{t('wardrobeEmptyCta')}</Link>
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-2 sm:gap-3">
          {items.slice(0, 4).map((item) => (
            <Link
              key={item.id}
              href={`/dashboard/wardrobe?item=${item.id}`}
              className="group relative block aspect-square overflow-hidden rounded-tile bg-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {item.thumbnail_url ? (
                <Image
                  src={item.thumbnail_url}
                  alt={item.name || typeLabel(item.type)}
                  fill
                  className="object-contain p-1.5 mix-blend-multiply transition-transform duration-300 group-hover:scale-105 dark:mix-blend-normal"
                  sizes="(max-width: 640px) 25vw, 15vw"
                />
              ) : (
                <span className="sr-only">{item.name || typeLabel(item.type)}</span>
              )}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

/** Occasions are English slugs on the wire; never show one raw. */
function useOccasionLabel() {
  const tOccasions = useTranslations('suggest.occasions');
  return (occasion: string) =>
    tOccasions.has(occasion as never) ? tOccasions(occasion as never) : occasion;
}

function OutfitsSection() {
  const t = useTranslations('dashboard.editorial');
  const occasionLabel = useOccasionLabel();
  const { data, isLoading } = useOutfits({ status: 'accepted' }, 1, 6);
  const outfits = data?.outfits ?? [];

  return (
    <section>
      <SectionHeader title={t('sectionOutfits')} href="/dashboard/outfits" cta={t('browseOutfits')} />
      {isLoading ? (
        <div className="flex gap-3 overflow-hidden">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-40 w-32 flex-shrink-0 rounded-tile" />
          ))}
        </div>
      ) : outfits.length === 0 ? (
        <div className="flex items-center justify-between gap-4 rounded-lg bg-panel p-4">
          <p className="text-sm font-medium text-muted-foreground">{t('outfitsEmpty')}</p>
          <Button asChild variant="signature" size="sm">
            <Link href="/dashboard/suggest">{t('outfitsEmptyCta')}</Link>
          </Button>
        </div>
      ) : (
        <div className="-mx-4 flex gap-3 overflow-x-auto scrollbar-none px-4 pb-1 sm:mx-0 sm:px-0">
          {outfits.map((o) => (
            <TransitionLink
              key={o.id}
              href={`/dashboard/outfits/${o.id}`}
              className="pressable group w-32 flex-shrink-0 rounded-tile focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-40"
            >
              <OutfitFlatLay items={o.items} max={5} sizes="160px" />
              <p className="mt-1.5 px-1 text-sm font-semibold first-letter:uppercase">
                {occasionLabel(o.occasion)}
              </p>
            </TransitionLink>
          ))}
        </div>
      )}
    </section>
  );
}

function LibrarySection() {
  const t = useTranslations('dashboard.editorial');
  const format = useFormatter();
  const occasionLabel = useOccasionLabel();
  const { data, isLoading } = useOutfits({ was_worn: true }, 1, 5);
  const items = data?.outfits ?? [];

  return (
    <section>
      <SectionHeader title={t('sectionLibrary')} href="/dashboard/history" cta={t('browseLibrary')} />
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex items-center justify-between gap-4 rounded-lg bg-panel p-4">
          <p className="text-sm font-medium text-muted-foreground">{t('libraryEmpty')}</p>
          <Button asChild variant="secondary" size="sm" className="bg-background">
            <Link href="/dashboard/history">{t('libraryEmptyCta')}</Link>
          </Button>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((o) => (
            <li key={o.id}>
              <TransitionLink
                href={`/dashboard/outfits/${o.id}`}
                className="pressable flex min-h-[56px] items-center justify-between rounded-2xl bg-panel px-4 py-3 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div>
                  <p className="text-[15px] font-bold first-letter:uppercase">{occasionLabel(o.occasion)}</p>
                  {o.scheduled_for && (
                    <p className="text-xs text-muted-foreground">
                      {format.dateTime(new Date(o.scheduled_for + 'T00:00:00'), { day: 'numeric', month: 'long' })}
                    </p>
                  )}
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} aria-hidden />
              </TransitionLink>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FamilyAside() {
  const tFam = useTranslations('dashboard.familyFeed');
  const { data: family, isLoading, isError } = useFamily();
  if (isLoading) return null;

  const noFamily = isError || !family;
  // Hidden from the nav for now (it overlaps with Amigos): only people who are
  // already in a family see this card, nobody is invited into one from here.
  if (noFamily) return null;
  const memberCount = family?.members.length ?? 0;

  return (
    <aside className="rounded-lg bg-signature-soft p-5">
      <p className="text-sm font-bold">{tFam('title')}</p>
      <p className="mt-2 text-xl font-extrabold tracking-tight">{noFamily ? tFam('noFamilyTitle') : family.name}</p>
      <p className="mt-1 flex items-center gap-2 text-sm text-foreground/75">
        {noFamily ? (
          tFam('noFamilyBody')
        ) : (
          <>
            <HeartHandshake className="h-4 w-4" strokeWidth={1.75} aria-hidden />
            {memberCount === 1
              ? tFam('membersOne', { count: memberCount, name: family.name })
              : tFam('membersOther', { count: memberCount, name: family.name })}
          </>
        )}
      </p>
      <Button asChild size="sm" className="mt-4">
        <Link href={noFamily ? '/dashboard/family' : '/dashboard/family/feed'}>
          {noFamily ? tFam('noFamilyCta') : tFam('browse')}
        </Link>
      </Button>
    </aside>
  );
}

// -- Page ---------------------------------------------------------------------

export default function DashboardPage() {
  // Same query as WardrobeSection (shared cache): how far the wardrobe is from the engine's minimum.
  const { data: wardrobe, isSuccess } = useItems({}, 1, 8);
  const { data: stats } = useWardrobeStats();
  const total = wardrobe?.total ?? 0;
  const counts = {
    total: stats?.total ?? total,
    usable: stats?.usable ?? total,
    untyped: stats?.untyped ?? 0,
    minForLooks: stats?.min_for_looks ?? MIN_ITEMS_FOR_LOOKS,
    varietyTarget: stats?.variety_target ?? MIN_ITEMS_FOR_LOOKS,
  };
  const stage = isSuccess ? wardrobeStage(counts) : 'ready';
  // Once the engine can build something, the day's plan and the nudge coexist:
  // the card is progress, not a blocker.
  const showMoments = stage === 'ready' || canSuggestLooks(counts);

  return (
    <div className="space-y-6 lg:space-y-8">
      <InstallHint />
      <QuickActions />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr] lg:gap-8">
        <div className="space-y-5">
          <WeekStrip />
          {showMoments && <DayMoments />}
          {stage !== 'ready' && <FirstStepsCard count={total} />}
        </div>
        <div className="space-y-6 lg:space-y-8">
          {stage !== 'empty' && <WardrobeSection />}
          <FamilyAside />
        </div>
      </div>
      <OutfitsSection />
      <LibrarySection />
    </div>
  );
}
