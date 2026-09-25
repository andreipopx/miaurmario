'use client';

import { Hourglass } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { SectionIcon } from '@/components/analytics/section-icon';
import { type UsageSummary } from '@/lib/hooks/use-analytics';

/**
 * «Tu armario en números»: how much of the wardrobe actually gets worn.
 *
 * With too little data it says so in one sentence and shows nothing else — a
 * percentage over two garments and one wear would be a made-up finding. Nothing
 * here tells the owner to buy anything; it reports and it stops.
 */
export function WardrobeNumbers({ usage }: { usage: UsageSummary }) {
  const t = useTranslations('analytics.numbers');
  const idleMonths = Math.round(usage.idle_days / 30);
  const longIdleMonths = Math.round(usage.long_idle_days / 30);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SectionIcon icon={Hourglass} color="amber" />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!usage.enough_data ? (
          <div className="space-y-1">
            <p className="text-sm font-bold">{t('notEnoughTitle')}</p>
            <p className="text-sm text-muted-foreground">{t('notEnough')}</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-panel p-4">
                <p className="text-sm font-semibold text-muted-foreground">{t('idleShare')}</p>
                <p className="mt-1 text-[28px] font-extrabold leading-none tracking-[-0.02em]">
                  {usage.idle_percentage.toFixed(0)}%
                </p>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {t('idleShareHelp', { months: idleMonths })} •{' '}
                  {t('ofItems', { count: usage.tracked_items })}
                </p>
                <Progress value={usage.idle_percentage} className="mt-2 h-2 bg-background" />
              </div>
              <div className="rounded-lg bg-panel p-4">
                <p className="text-sm font-semibold text-muted-foreground">{t('neverWorn')}</p>
                <p className="mt-1 text-[28px] font-extrabold leading-none tracking-[-0.02em]">
                  {usage.never_worn}
                </p>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {t('neverWornHelp', { count: usage.never_worn })}
                </p>
              </div>
            </div>

            <dl className="space-y-2 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground">{t('idle3m')}</dt>
                <dd className="font-bold">{usage.idle_3m}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground">{t('idle6m')}</dt>
                <dd className="font-bold">{usage.idle_6m}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground">
                  {t('recent')}{' '}
                  <span className="text-xs">({t('recentHelp', { days: usage.recent_days })})</span>
                </dt>
                <dd className="font-bold">{usage.worn_recently}</dd>
              </div>
            </dl>

            {usage.idle_3m === 0 && (
              <p className="text-sm text-muted-foreground">
                {t('allMoving', { months: longIdleMonths })}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {t('trackedSince', { days: usage.tracking_days })}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
