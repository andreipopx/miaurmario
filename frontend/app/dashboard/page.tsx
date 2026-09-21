'use client';

import { useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useTranslations, useLocale } from 'next-intl';
import Link from 'next/link';
import Image from 'next/image';
import { Sparkles, ArrowRight, Cloud, Droplets, HeartHandshake, ChevronRight } from 'lucide-react';
import { useWeather } from '@/lib/hooks/use-weather';
import { usePreferences } from '@/lib/hooks/use-preferences';
import { useItems } from '@/lib/hooks/use-items';
import { useOutfits, usePendingOutfits } from '@/lib/hooks/use-outfits';
import { useFamily } from '@/lib/hooks/use-family';
import { displayValue, tempSymbol, TempUnit } from '@/lib/temperature';
import { Skeleton } from '@/components/ui/skeleton';

// -- Small editorial primitives ------------------------------------------------

function SectionHeader({
  eyebrow,
  title,
  href,
  cta,
}: {
  eyebrow?: string;
  title: string;
  href?: string;
  cta?: string;
}) {
  return (
    <div className="flex items-end justify-between gap-4 mb-6">
      <div>
        {eyebrow && <p className="label-editorial mb-2">{eyebrow}</p>}
        <h2 className="font-display text-2xl sm:text-3xl leading-tight">{title}</h2>
      </div>
      {href && cta && (
        <Link
          href={href}
          className="label-editorial link-editorial text-primary hover:text-primary"
        >
          {cta}
        </Link>
      )}
    </div>
  );
}

function GoldRule() {
  return <div className="divider-gold my-14 sm:my-20" />;
}

// -- Hero: outfit del día / el estilista ---------------------------------------

function EditorialGreeting() {
  const t = useTranslations('dashboard.editorial.editorialGreeting');
  const locale = useLocale();
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? t('morning') : hour < 20 ? t('afternoon') : t('evening');
  const formatted = now.toLocaleDateString(locale === 'es' ? 'es-ES' : 'en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  return (
    <div className="space-y-2">
      <p className="label-editorial text-gold">{greeting}</p>
      <h1 className="font-display italic font-black text-display-xl leading-none">
        {formatted[0].toUpperCase() + formatted.slice(1)}
      </h1>
    </div>
  );
}

function OutfitOfTheDayHero() {
  const t = useTranslations('dashboard.editorial');
  const tSuggest = useTranslations('suggest');
  const { data: pending, isLoading } = usePendingOutfits(1);
  const featured = pending?.outfits?.[0];
  const { data: weather } = useWeather();
  const { data: prefs } = usePreferences();
  const unit: TempUnit = prefs?.temperature_unit === 'fahrenheit' ? 'fahrenheit' : 'celsius';

  return (
    <section className="grid gap-8 lg:grid-cols-[3fr_2fr] lg:gap-14 items-start">
      {/* Left: image or placeholder */}
      <div className="aspect-[3/4] bg-card border border-border-solid/40 relative overflow-hidden img-zoom">
        {featured?.items?.length ? (
          <div className="grid grid-cols-2 grid-rows-2 gap-px w-full h-full">
            {featured.items.slice(0, 4).map((item) => (
              <div key={item.id} className="relative bg-muted">
                {item.thumbnail_url ? (
                  <Image
                    src={item.thumbnail_url}
                    alt={item.name || item.type}
                    fill
                    className="object-cover"
                    sizes="(max-width: 1024px) 100vw, 60vw"
                  />
                ) : (
                  <div className="w-full h-full" />
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center px-8 py-12">
            {isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : (
              <>
                <p className="label-editorial text-gold mb-6">{t('outfitOfTheDay')}</p>
                <p className="font-display italic text-2xl sm:text-3xl leading-tight mb-4 max-w-sm">
                  {t('stylistWorking')}
                </p>
                <p className="font-editorial italic text-base text-muted-foreground max-w-md">
                  {t('stylistWorkingBody')}
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {/* Right: metadata + CTA */}
      <div className="flex flex-col gap-6 lg:pt-8">
        <p className="font-editorial italic text-2xl text-muted-foreground leading-snug">
          {t('outfitOfTheDay')}
        </p>

        {weather && (
          <div className="space-y-2">
            <p className="label-editorial">{tSuggest('locationNotSetShortBody') !== 'suggest.locationNotSetShortBody' ? 'Clima' : 'Clima'}</p>
            <div className="flex items-baseline gap-3">
              <Cloud className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
              <span className="font-display text-3xl">
                {displayValue(weather.temperature, unit)}{tempSymbol(unit)}
              </span>
              <span className="text-sm text-muted-foreground capitalize">{weather.condition_label || weather.condition}</span>
            </div>
            {weather.precipitation_chance > 0 && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                <Droplets className="h-3 w-3" strokeWidth={1.5} />
                {weather.precipitation_chance}% ·
              </p>
            )}
          </div>
        )}

        <div className="pt-4">
          <Link
            href="/dashboard/suggest"
            className="inline-flex items-center gap-3 group text-primary"
          >
            <span className="label-editorial link-editorial text-primary">
              {tSuggest('generate') !== 'suggest.generate' ? 'El estilista' : 'The stylist'}
            </span>
            <ArrowRight className="h-4 w-4 transition-transform duration-200 ease-editorial group-hover:translate-x-1" strokeWidth={1.5} />
          </Link>
        </div>
      </div>
    </section>
  );
}

// -- Editorial section cards ---------------------------------------------------

function WardrobeSection() {
  const t = useTranslations('dashboard.editorial');
  const { data, isLoading } = useItems({}, 1, 8);
  const total = data?.total ?? 0;
  const items = data?.items ?? [];

  return (
    <section>
      <SectionHeader
        eyebrow={t('sectionWardrobe')}
        title={isLoading ? '…' : t('wardrobeCount', { count: total })}
        href="/dashboard/wardrobe"
        cta={t('browseWardrobe')}
      />

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-5">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="aspect-[3/4] w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="border border-dashed border-border-solid/60 p-10 text-center">
          <p className="font-editorial italic text-xl text-muted-foreground mb-4">{t('wardrobeEmpty')}</p>
          <Link href="/dashboard/wardrobe" className="link-editorial label-editorial text-primary">
            {t('wardrobeEmptyCta')}
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-5">
          {items.slice(0, 4).map((item) => (
            <Link key={item.id} href={`/dashboard/wardrobe/${item.id}`} className="group block">
              <div className="aspect-[3/4] bg-muted relative overflow-hidden img-zoom">
                {item.thumbnail_url ? (
                  <Image
                    src={item.thumbnail_url}
                    alt={item.name || item.type}
                    fill
                    className="object-cover"
                    sizes="(max-width: 640px) 50vw, 25vw"
                  />
                ) : null}
              </div>
              <p className="mt-2 text-xs text-muted-foreground truncate group-hover:text-primary transition-colors">
                {item.name || item.type}
              </p>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function OutfitsSection() {
  const t = useTranslations('dashboard.editorial');
  const { data, isLoading } = useOutfits({ status: 'accepted' }, 1, 6);
  const outfits = data?.outfits ?? [];

  return (
    <section>
      <SectionHeader
        eyebrow={t('sectionOutfits')}
        title={t('sectionOutfits')}
        href="/dashboard/outfits"
        cta={t('browseOutfits')}
      />

      {isLoading ? (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-40 w-32 flex-shrink-0" />)}
        </div>
      ) : outfits.length === 0 ? (
        <div className="border border-dashed border-border-solid/60 p-10 text-center">
          <p className="font-editorial italic text-xl text-muted-foreground mb-4">{t('outfitsEmpty')}</p>
          <Link href="/dashboard/suggest" className="link-editorial label-editorial text-primary">
            {t('outfitsEmptyCta')}
          </Link>
        </div>
      ) : (
        <div className="flex gap-3 sm:gap-4 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0">
          {outfits.map((o) => (
            <Link key={o.id} href={`/dashboard/outfits/${o.id}`} className="flex-shrink-0 w-32 sm:w-40 group">
              <div className="aspect-[3/4] bg-muted relative overflow-hidden img-zoom">
                <div className="grid grid-cols-2 grid-rows-2 gap-px w-full h-full">
                  {o.items.slice(0, 4).map((item) => (
                    <div key={item.id} className="relative bg-background">
                      {item.thumbnail_url ? (
                        <Image
                          src={item.thumbnail_url}
                          alt={item.name || item.type}
                          fill
                          className="object-cover"
                          sizes="160px"
                        />
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground capitalize group-hover:text-primary transition-colors">
                {o.occasion}
              </p>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function LibrarySection() {
  const t = useTranslations('dashboard.editorial');
  const { data, isLoading } = useOutfits({ was_worn: true }, 1, 5);
  const items = data?.outfits ?? [];

  return (
    <section>
      <SectionHeader
        eyebrow={t('sectionLibrary')}
        title={t('sectionLibrary')}
        href="/dashboard/history"
        cta={t('browseLibrary')}
      />

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="border border-dashed border-border-solid/60 p-10 text-center">
          <p className="font-editorial italic text-xl text-muted-foreground mb-4">{t('libraryEmpty')}</p>
          <Link href="/dashboard/history" className="link-editorial label-editorial text-primary">
            {t('libraryEmptyCta')}
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-border-solid/40">
          {items.map((o) => (
            <li key={o.id}>
              <Link href={`/dashboard/outfits/${o.id}`} className="flex items-center justify-between py-4 hover:text-primary transition-colors group">
                <div>
                  <p className="font-display text-lg capitalize">{o.occasion}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {o.scheduled_for
                      ? new Date(o.scheduled_for).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })
                      : ''}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" strokeWidth={1.5} />
              </Link>
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

  if (isError || !family) {
    return (
      <aside className="border border-border-solid/60 p-6 sm:p-8">
        <p className="label-editorial text-gold mb-3">{tFam('title')}</p>
        <p className="font-display text-xl leading-tight mb-3">{tFam('noFamilyTitle')}</p>
        <p className="text-sm text-muted-foreground mb-6">{tFam('noFamilyBody')}</p>
        <Link href="/dashboard/family" className="link-editorial label-editorial text-primary">
          {tFam('noFamilyCta')}
        </Link>
      </aside>
    );
  }

  const memberCount = family.members.length;
  const memberText = memberCount === 1
    ? tFam('membersOne', { count: memberCount, name: family.name })
    : tFam('membersOther', { count: memberCount, name: family.name });

  return (
    <aside className="border border-border-solid/60 p-6 sm:p-8">
      <p className="label-editorial text-gold mb-3">{tFam('title')}</p>
      <p className="font-display text-xl leading-tight mb-2">{family.name}</p>
      <p className="text-sm text-muted-foreground mb-6 flex items-center gap-2">
        <HeartHandshake className="h-4 w-4" strokeWidth={1.5} /> {memberText}
      </p>
      <Link href="/dashboard/family/feed" className="link-editorial label-editorial text-primary">
        {tFam('browse')}
      </Link>
    </aside>
  );
}

// -- Page ---------------------------------------------------------------------

export default function DashboardPage() {
  const { data: session } = useSession();
  const t = useTranslations('dashboard');
  const tCommon = useTranslations('common');
  const firstName = session?.user?.name?.split(' ')[0] || tCommon('user');

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-10 py-10 sm:py-16">
      <div className="mb-14 sm:mb-20">
        <EditorialGreeting />
        <p className="font-editorial italic text-2xl text-muted-foreground mt-6">
          {t('welcome', { name: firstName })}
        </p>
      </div>

      <OutfitOfTheDayHero />

      <GoldRule />
      <WardrobeSection />

      <GoldRule />
      <OutfitsSection />

      <GoldRule />
      <div className="grid gap-14 lg:grid-cols-[3fr_2fr]">
        <LibrarySection />
        <FamilyAside />
      </div>

      <div className="h-24" />
    </div>
  );
}
