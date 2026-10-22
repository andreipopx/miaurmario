'use client';

/* eslint-disable @next/next/no-img-element -- signed garment thumbnails */

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { LazyStinky } from '@/components/native/lazy-stinky';
import { useStinkyPersona } from '@/components/stinky/stinky-persona';
import { useWrapped, type WrappedGarment } from '@/lib/hooks/use-habit';
import { useClothingTypeLabel } from '@/lib/clothing-type-label';
import { useColorLabel } from '@/lib/tag-labels';
import { clothingColorHex } from '@/lib/colors';
import { cn } from '@/lib/utils';

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <section className={cn('rounded-lg p-5', className)}>{children}</section>;
}

function Big({ children }: { children: React.ReactNode }) {
  return <p className="text-[44px] font-extrabold leading-none tracking-tight">{children}</p>;
}

function Garment({ g, caption }: { g: WrappedGarment; caption?: string }) {
  const typeLabel = useClothingTypeLabel();
  return (
    <figure className="w-24 shrink-0 space-y-1">
      <span className="relative block aspect-square overflow-hidden rounded-tile bg-background">
        <img src={g.photo.thumbnail_url || g.photo.image_url} alt="" className="absolute inset-0 h-full w-full object-contain p-1" />
      </span>
      <figcaption className="text-[12px] leading-tight">
        <span className="line-clamp-1 font-semibold">{g.name || typeLabel(g.type)}</span>
        {caption && <span className="text-muted-foreground">{caption}</span>}
      </figcaption>
    </figure>
  );
}

/**
 * «Tu mes con Stinky»: the month in your wardrobe — days with a look, the garment
 * of the month, how much of the wardrobe went out, cost per wear, the forgotten.
 */
export default function WrappedPage() {
  const t = useTranslations('wrapped');
  const locale = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const { name } = useStinkyPersona();
  const colorLabel = useColorLabel();
  const { data: w, isLoading } = useWrapped(params.get('mes'));

  const money = (v: string | null) =>
    v == null ? null : new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(Number(v));
  const monthName = w
    ? new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(new Date(`${w.month}T12:00:00Z`))
    : '';
  const thisMonth = new Date().toISOString().slice(0, 7);
  const go = (delta: number) => w && router.replace(`/dashboard/wrapped?mes=${shiftMonth(w.month.slice(0, 7), delta)}`);
  const pct = w && w.wardrobe_size ? Math.round((w.garments_worn / w.wardrobe_size) * 100) : 0;
  const top = w?.top[0];

  return (
    <div className="mx-auto max-w-xl space-y-4 pb-28 pt-2">
      <div className="flex items-center justify-between">
        <Button variant="ghost" asChild className="-ml-3 text-muted-foreground hover:text-foreground">
          <Link href="/dashboard">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {t('back')}
          </Link>
        </Button>
        {w && (
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" aria-label={t('prev')} onClick={() => go(-1)}>
              <ChevronLeft className="h-5 w-5" aria-hidden />
            </Button>
            <Button size="icon" variant="ghost" aria-label={t('next')} disabled={w.month.slice(0, 7) >= thisMonth} onClick={() => go(1)}>
              <ChevronRight className="h-5 w-5" aria-hidden />
            </Button>
          </div>
        )}
      </div>

      {isLoading || !w ? (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-44 rounded-lg" />
          ))}
        </div>
      ) : (
        <>
          <Card className="flex flex-col items-center bg-signature-soft text-center">
            <LazyStinky state="happy" settleTo="idle" size={120} label="" />
            <h1 className="mt-3 text-[26px] font-extrabold leading-tight tracking-tight first-letter:uppercase">
              {t('title', { month: monthName, name })}
            </h1>
            <p className="mt-1 text-[14px] text-muted-foreground">{t('subtitle', { meals: w.meals_total, level: w.level + 1 })}</p>
          </Card>

          <Card className="bg-panel">
            <Big>{w.days_logged}</Big>
            <p className="mt-1 text-[15px] font-semibold">{t('days', { count: w.days_logged })}</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {w.days_logged ? t('looks', { count: w.looks_worn }) : t('noDays', { name })}
            </p>
          </Card>

          {top && (
            <Card className="bg-panel">
              <p className="text-[13px] font-semibold text-muted-foreground">{t('garmentOfTheMonth')}</p>
              <div className="mt-3 flex items-center gap-4">
                <Garment g={top} />
                <p className="text-[15px] font-bold leading-snug">{t('topTimes', { count: top.count })}</p>
              </div>
              {w.top.length > 1 && (
                <div className="mt-4 flex gap-3">
                  {w.top.slice(1).map((g) => (
                    <Garment key={g.id} g={g} caption={t('times', { count: g.count })} />
                  ))}
                </div>
              )}
            </Card>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Card className="bg-panel">
              <Big>{pct}%</Big>
              <p className="mt-1 text-[13px] font-semibold leading-snug">{t('wardrobeUsed', { worn: w.garments_worn, total: w.wardrobe_size })}</p>
            </Card>
            <Card className="bg-panel">
              {w.top_color ? (
                <>
                  <span
                    className="block h-11 w-11 rounded-full border border-border"
                    style={{ background: clothingColorHex(w.top_color) ?? '#ccc' }}
                    aria-hidden
                  />
                  <p className="mt-2 text-[13px] font-semibold leading-snug">{t('color', { color: colorLabel(w.top_color).toLowerCase() })}</p>
                </>
              ) : (
                <p className="text-[13px] text-muted-foreground">{t('noColor')}</p>
              )}
            </Card>
          </div>

          {w.average_cost_per_wear && (
            <Card className="bg-panel">
              <p className="text-[13px] font-semibold text-muted-foreground">{t('costTitle')}</p>
              <Big>{money(w.average_cost_per_wear)}</Big>
              <p className="mt-1 text-[13px] text-muted-foreground">{t('costBody', { value: money(w.wardrobe_value) ?? '' })}</p>
              {w.best_value && (
                <div className="mt-4 flex items-center gap-4">
                  <Garment g={w.best_value} />
                  <p className="text-[14px] font-semibold leading-snug">
                    {t('bestValue', { cost: money(w.best_value.cost_per_wear) ?? '', count: w.best_value.count })}
                  </p>
                </div>
              )}
            </Card>
          )}

          {w.forgotten_count > 0 && (
            <Card className="bg-panel">
              <p className="text-[13px] font-semibold text-muted-foreground">{t('forgottenTitle')}</p>
              <p className="mt-1 text-[15px] font-bold">{t('forgotten', { count: w.forgotten_count })}</p>
              <div className="mt-3 flex gap-3">
                {w.forgotten.map((g) => (
                  <Link key={g.id} href={`/dashboard/wardrobe?item=${g.id}`}>
                    <Garment g={g} />
                  </Link>
                ))}
              </div>
              <Button asChild variant="secondary" size="sm" className="mt-4">
                <Link href={`/dashboard/wardrobe?item=${w.forgotten[0].id}`}>{t('forgottenCta')}</Link>
              </Button>
            </Card>
          )}

          <Card className="bg-panel">
            <p className="text-[15px] font-bold">{t('added', { count: w.added })}</p>
            {w.added > 0 && (
              <ul className="mt-2 flex flex-wrap gap-2">
                {Object.entries(w.added_by_way).map(([way, n]) => (
                  <li key={way} className="rounded-full bg-background px-3 py-1 text-[12.5px] font-semibold">
                    {t.has(`ways.${way}`) ? t(`ways.${way}`) : way} · {n}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-[13px] text-muted-foreground">{t('streak', { count: w.best_streak_weeks })}</p>
          </Card>
        </>
      )}
    </div>
  );
}
