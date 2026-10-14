'use client';

/* eslint-disable @next/next/no-img-element -- small garment thumbnails in the suitcase */

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowLeft, Check, CloudRain, Loader2, RefreshCw, Shirt, Trash2 } from 'lucide-react';

import { useConfirm } from '@/components/confirm-provider';
import { EmptyState } from '@/components/empty-state';
import { LazyStinky } from '@/components/native/lazy-stinky';
import { OutfitFlatLay } from '@/components/outfits/outfit-flat-lay';
import { Button } from '@/components/ui/button';
import { useDeleteTrip, usePackItem, useReplanTrip, useTrip, type Trip } from '@/lib/hooks/use-trips';
import { useGarmentWord } from '@/lib/garment-words';
import { dayItems, formatTripDates, formatTripDay, timesWorn, tripTemperatures } from '@/lib/trips';
import { cn } from '@/lib/utils';

function Suitcase({ trip }: { trip: Trip }) {
  const t = useTranslations('trips.detail');
  const pack = usePackItem(trip.id);
  const garmentWord = useGarmentWord();
  const byId = new Map(trip.items.map((i) => [i.id, i]));
  const worn = timesWorn(trip);
  const packed = trip.packing.filter((p) => p.packed).length;

  return (
    <section aria-labelledby="suitcase-title" className="space-y-3 rounded-lg bg-panel p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="suitcase-title" className="text-lg font-extrabold tracking-tight">
          {t('suitcase')}
        </h2>
        <span className="text-sm font-semibold text-muted-foreground">
          {t('packed', { packed, total: trip.packing.length })}
        </span>
      </div>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {trip.packing.map(({ item_id, packed: isPacked }) => {
          const item = byId.get(item_id);
          if (!item) return null;
          const name = item.name || garmentWord(item.type);
          const times = worn.get(item_id) ?? 0;
          return (
            <li key={item_id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={isPacked}
                aria-label={name}
                onClick={() => pack.mutate({ item_id, packed: !isPacked })}
                className={cn(
                  'relative flex w-full flex-col items-center gap-1 rounded-2xl bg-background p-2 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isPacked && 'opacity-55'
                )}
              >
                {/* The photo is positioned, so a tall one (jeans) can't stretch the square. */}
                <span className="relative block aspect-square w-full overflow-hidden">
                  {item.thumbnail_url || item.image_url ? (
                    <img
                      src={item.thumbnail_url || item.image_url || ''}
                      alt=""
                      className="absolute inset-0 h-full w-full object-contain"
                      loading="lazy"
                    />
                  ) : (
                    <Shirt className="m-auto h-8 w-8 text-muted-foreground" aria-hidden />
                  )}
                </span>
                <span className="line-clamp-1 text-[12px] font-semibold leading-tight">{name}</span>
                {times > 1 && <span className="text-[11px] text-muted-foreground">{t('timesWorn', { count: times })}</span>}
                <span
                  aria-hidden
                  className={cn(
                    'absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full border-[1.5px]',
                    isPacked ? 'border-foreground bg-foreground text-background' : 'border-border bg-background'
                  )}
                >
                  {isPacked && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {trip.extras.length > 0 && (
        <div className="pt-1">
          <p className="mb-2 text-sm font-bold">{t('extras')}</p>
          <ul className="flex flex-wrap gap-2">
            {trip.extras.map((e) => (
              <li key={e} className="rounded-full bg-background px-3 py-1.5 text-[13px] font-semibold">
                {e}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Days({ trip }: { trip: Trip }) {
  const t = useTranslations('trips.detail');
  const locale = useLocale();
  return (
    <section aria-labelledby="days-title" className="space-y-3">
      <h2 id="days-title" className="px-1 text-lg font-extrabold tracking-tight">
        {t('dayByDay')}
      </h2>
      <ol className="space-y-3">
        {trip.days.map((day) => {
          const w = day.weather;
          const temps = w ? tripTemperatures(w) : null;
          return (
            <li key={day.date} className="rounded-lg bg-panel p-3.5 sm:p-5">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="text-[16px] font-bold capitalize">{formatTripDay(day.date, locale)}</h3>
                <span className="flex items-center gap-1.5 rounded-full bg-background px-3 py-1 text-[13px] font-semibold">
                  {w && w.precipitation_chance >= 40 && <CloudRain className="h-3.5 w-3.5" aria-hidden />}
                  {w && temps
                    ? `${temps.min}–${temps.max} °C${w.condition_label ? ` · ${w.condition_label}` : ''}`
                    : t('noForecast')}
                </span>
              </div>
              <OutfitFlatLay items={dayItems(day, trip)} backToggle={false} label={formatTripDay(day.date, locale)} />
              {day.note && <p className="mt-2 text-sm text-muted-foreground">{day.note}</p>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** One trip: what Stinky packed, and the look for each day. */
export default function TripPage() {
  const t = useTranslations('trips.detail');
  const locale = useLocale();
  const router = useRouter();
  const confirm = useConfirm();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const { data: trip, isLoading, isError } = useTrip(id);
  const replan = useReplanTrip(id);
  const remove = useDeleteTrip();

  const back = (
    <Button variant="ghost" asChild className="-ml-3 text-muted-foreground hover:text-foreground">
      <Link href="/dashboard/trips">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t('back')}
      </Link>
    </Button>
  );

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl py-4">
        {back}
        <Loader2 className="mt-6 h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }
  if (isError || !trip) {
    return (
      <div className="mx-auto max-w-2xl py-4">
        {back}
        <EmptyState state="sad" title={t('notFound')} />
      </div>
    );
  }

  const deleteTrip = async () => {
    if (!(await confirm({ title: t('deleteConfirm', { place: trip.destination }), destructive: true }))) return;
    remove.mutate(trip.id, {
      onSuccess: () => {
        toast.success(t('deleted'));
        router.push('/dashboard/trips');
      },
    });
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5 py-2 sm:py-4">
      {back}
      <header className="px-1">
        <h1 className="text-[28px] font-extrabold leading-tight tracking-tight">{trip.destination}</h1>
        <p className="text-[15px] font-semibold text-muted-foreground">
          {formatTripDates(trip.start_date, trip.end_date, locale)} · {t('days', { count: trip.days_count })}
        </p>
        {trip.plans && <p className="mt-1 text-sm text-muted-foreground">{trip.plans}</p>}
      </header>

      {trip.status === 'planning' ? (
        <div className="flex flex-col items-center rounded-lg bg-signature-soft px-4 py-8 text-center" aria-live="polite">
          <LazyStinky state="thinking" size={112} label="" />
          <p className="mt-3 text-lg font-extrabold tracking-tight">{t('planning')}</p>
          <p className="mt-1 max-w-xs text-sm text-muted-foreground">{t('planningBody')}</p>
        </div>
      ) : trip.status === 'error' ? (
        <EmptyState
          state="sad"
          title={trip.error === 'wardrobe_too_small' ? t('tooSmall') : t('failed')}
          action={
            trip.error === 'wardrobe_too_small' ? (
              <Button asChild>
                <Link href="/dashboard/wardrobe?bulk=1">{t('upload')}</Link>
              </Button>
            ) : (
              <Button onClick={() => replan.mutate()} disabled={replan.isPending}>
                {t('retry')}
              </Button>
            )
          }
        />
      ) : (
        <>
          <Suitcase trip={trip} />
          <Days trip={trip} />
        </>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        {trip.status === 'ready' && (
          <Button variant="secondary" className="flex-1" onClick={() => replan.mutate()} disabled={replan.isPending}>
            {replan.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="h-4 w-4" aria-hidden />
            )}
            {t('replan')}
          </Button>
        )}
        <Button variant="outline" className="flex-1" onClick={deleteTrip} disabled={remove.isPending}>
          <Trash2 className="h-4 w-4" aria-hidden />
          {t('delete')}
        </Button>
      </div>
      {trip.status === 'ready' && trip.days.some((d) => !d.weather) && (
        <p className="px-1 text-center text-[13px] text-muted-foreground">{t('forecastLater')}</p>
      )}
    </div>
  );
}
