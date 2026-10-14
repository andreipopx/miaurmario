'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ChevronRight, Loader2, Plane, Plus } from 'lucide-react';

import { PageHeader } from '@/components/page-header';
import { LocationPicker } from '@/components/settings/location-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { getErrorMessage } from '@/lib/api';
import type { SavedLocation } from '@/lib/geo';
import { useCreateTrip, useTrips, type TripSummary } from '@/lib/hooks/use-trips';
import { formatTripDates } from '@/lib/trips';

const MAX_DAYS = 14;

function isoDay(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function TripRow({ trip }: { trip: TripSummary }) {
  const t = useTranslations('trips');
  const locale = useLocale();
  return (
    <li>
      <Link
        href={`/dashboard/trips/${trip.id}`}
        className="pressable flex min-h-[72px] items-center gap-3 rounded-lg bg-panel p-3.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-pop-sky text-pop-foreground">
          <Plane className="h-6 w-6" strokeWidth={2} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[16px] font-bold">{trip.destination}</span>
          <span className="block text-sm text-muted-foreground">
            {formatTripDates(trip.start_date, trip.end_date, locale)}
            {trip.status === 'planning'
              ? ` · ${t('planningShort')}`
              : trip.to_pack > 0
                ? ` · ${t('packedCount', { packed: trip.packed, total: trip.to_pack })}`
                : ''}
          </span>
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    </li>
  );
}

function NewTripForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations('trips.form');
  const router = useRouter();
  const create = useCreateTrip();
  const [place, setPlace] = useState<SavedLocation>({ name: '', lat: null, lon: null });
  const [start, setStart] = useState(isoDay(7));
  const [end, setEnd] = useState(isoDay(10));
  const [plans, setPlans] = useState('');

  const days = start && end ? Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1 : 0;
  const problem = !place.name || place.lat === null || place.lon === null
    ? t('needPlace')
    : days < 1
      ? t('badDates')
      : days > MAX_DAYS
        ? t('tooLong', { max: MAX_DAYS })
        : null;

  const submit = () => {
    if (problem || place.lat === null || place.lon === null) return;
    create.mutate(
      {
        destination: place.name.split(',')[0].trim() || place.name,
        country: place.name.includes(',') ? place.name.split(',').slice(-1)[0].trim() : null,
        latitude: place.lat,
        longitude: place.lon,
        timezone: place.timezone ?? null,
        start_date: start,
        end_date: end,
        plans: plans.trim() || null,
      },
      {
        onSuccess: (trip) => {
          onDone();
          router.push(`/dashboard/trips/${trip.id}`);
        },
        onError: (err) => toast.error(getErrorMessage(err, t('failed'))),
      }
    );
  };

  return (
    <section className="space-y-5 rounded-lg bg-panel p-4 sm:p-5" aria-labelledby="new-trip-title">
      <h2 id="new-trip-title" className="text-lg font-extrabold tracking-tight">
        {t('title')}
      </h2>
      <div className="space-y-2">
        <Label htmlFor="trip-place" className="font-bold">
          {t('where')}
        </Label>
        <LocationPicker id="trip-place" value={place} onChange={setPlace} showAdvanced={false} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="trip-start" className="font-bold">
            {t('from')}
          </Label>
          <Input id="trip-start" type="date" value={start} min={isoDay(0)} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="trip-end" className="font-bold">
            {t('to')}
          </Label>
          <Input id="trip-end" type="date" value={end} min={start || isoDay(0)} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="trip-plans" className="font-bold">
          {t('plans')}
        </Label>
        <Textarea
          id="trip-plans"
          value={plans}
          maxLength={500}
          rows={3}
          placeholder={t('plansPlaceholder')}
          onChange={(e) => setPlans(e.target.value)}
        />
        <p className="text-[13px] text-muted-foreground">{t('plansHint')}</p>
      </div>
      {problem && place.name && <p className="text-sm font-semibold text-destructive">{problem}</p>}
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1 bg-background" onClick={onDone}>
          {t('cancel')}
        </Button>
        <Button variant="signature" className="flex-1" onClick={submit} disabled={!!problem || create.isPending}>
          {create.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {t('submit')}
        </Button>
      </div>
    </section>
  );
}

/** «Modo viaje»: your trips, and a new one. */
export default function TripsPage() {
  const t = useTranslations('trips');
  const { data, isLoading } = useTrips();
  const [creating, setCreating] = useState(false);
  const upcoming = data?.upcoming ?? [];
  const past = data?.past ?? [];

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-2 sm:py-4">
      <PageHeader title={t('title')} description={t('subtitle')} />

      {creating ? (
        <NewTripForm onDone={() => setCreating(false)} />
      ) : (
        <Button size="lg" className="w-full" onClick={() => setCreating(true)}>
          <Plus className="h-[18px] w-[18px]" strokeWidth={2.25} aria-hidden />
          {t('new')}
        </Button>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        </div>
      ) : upcoming.length === 0 && past.length === 0 ? (
        !creating && <p className="px-1 text-center text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <>
          {upcoming.length > 0 && (
            <section className="space-y-2">
              <h2 className="px-1 text-sm font-bold uppercase tracking-wide text-muted-foreground">{t('upcoming')}</h2>
              <ul className="space-y-2">
                {upcoming.map((trip) => (
                  <TripRow key={trip.id} trip={trip} />
                ))}
              </ul>
            </section>
          )}
          {past.length > 0 && (
            <section className="space-y-2">
              <h2 className="px-1 text-sm font-bold uppercase tracking-wide text-muted-foreground">{t('past')}</h2>
              <ul className="space-y-2">
                {past.map((trip) => (
                  <TripRow key={trip.id} trip={trip} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
