'use client';

import {
  Shirt,
  Sparkles,
  TrendingUp,
  Activity,
  Lightbulb,
  PieChart,
  BarChart,
  type LucideIcon,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { POP_BG, type PopColor } from '@/components/chip';
import { SectionIcon } from '@/components/analytics/section-icon';
import { WardrobeNumbers } from '@/components/analytics/wardrobe-numbers';
import { useAnalytics } from '@/lib/hooks/use-analytics';
import { cn } from '@/lib/utils';
import Image from 'next/image';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useClothingTypeLabel } from '@/lib/clothing-type-label';
import { useColorLabel } from '@/lib/tag-labels';

function StatCard({
  title,
  value,
  description,
  icon: Icon,
  color,
  trend,
}: {
  title: string;
  value: string | number;
  description: string;
  icon: LucideIcon;
  color: PopColor;
  trend?: 'up' | 'down' | 'neutral';
}) {
  return (
    <div className="rounded-lg bg-panel p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-muted-foreground">{title}</p>
        <span
          aria-hidden
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-pop-foreground',
            POP_BG[color]
          )}
        >
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </span>
      </div>
      <div className="mt-2 text-[28px] font-extrabold leading-none tracking-[-0.02em]">{value}</div>
      <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
        {trend === 'up' && <TrendingUp className="h-3.5 w-3.5 text-success" />}
        {trend === 'down' && <TrendingUp className="h-3.5 w-3.5 rotate-180 text-destructive" />}
        {description}
      </p>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-[132px] rounded-lg" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {[1, 2].map((c) => (
          <Card key={c}>
            <CardHeader>
              <Skeleton className="h-5 w-32 rounded-full" />
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-6 w-full rounded-full" />
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function ColorBar({ color, percentage }: { color: string; percentage: number }) {
  const colorLabel = useColorLabel();
  // Garment colour swatches — these represent the clothes' actual colours, not UI tokens.
  const colorMap: Record<string, string> = {
    black: 'bg-gray-900',
    white: 'bg-white',
    gray: 'bg-gray-500',
    grey: 'bg-gray-500',
    navy: 'bg-blue-900',
    blue: 'bg-blue-500',
    red: 'bg-red-500',
    green: 'bg-green-500',
    yellow: 'bg-yellow-400',
    orange: 'bg-orange-500',
    purple: 'bg-purple-500',
    pink: 'bg-pink-500',
    brown: 'bg-amber-700',
    beige: 'bg-amber-200',
    cream: 'bg-amber-100',
    khaki: 'bg-yellow-700',
    olive: 'bg-lime-700',
    teal: 'bg-teal-500',
    burgundy: 'bg-red-900',
    maroon: 'bg-red-800',
    coral: 'bg-orange-400',
    salmon: 'bg-red-300',
  };

  const bgColor = colorMap[color.toLowerCase()] || 'bg-muted';

  return (
    <div className="flex items-center gap-3">
      <div
        aria-hidden
        className={cn('h-6 w-6 shrink-0 rounded-full ring-1 ring-inset ring-black/10 dark:ring-white/15', bgColor)}
      />
      <div className="flex-1">
        <div className="mb-1 flex justify-between text-sm">
          <span className="font-semibold">{colorLabel(color)}</span>
          <span className="text-muted-foreground">{percentage.toFixed(1)}%</span>
        </div>
        <Progress value={percentage} className="h-2" />
      </div>
    </div>
  );
}

function ItemCard({ item }: { item: { id: string; name: string | null; type: string; thumbnail_url: string | null; wear_count: number } }) {
  const typeLabel = useClothingTypeLabel();
  return (
    <Link
      href={`/dashboard/wardrobe?item=${item.id}`}
      className="flex min-h-[44px] items-center gap-3 rounded-[18px] p-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-[14px] bg-panel">
        {item.thumbnail_url ? (
          <Image
            src={item.thumbnail_url}
            alt={item.name || typeLabel(item.type)}
            fill
            className="object-contain p-1"
            sizes="48px"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Shirt className="h-6 w-6 text-muted-foreground" strokeWidth={1.75} />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{item.name || typeLabel(item.type)}</p>
        <p className="text-sm text-muted-foreground">{typeLabel(item.type)}</p>
      </div>
      <Badge variant="secondary">{item.wear_count}x</Badge>
    </Link>
  );
}

function AcceptanceTrendChart({ data }: { data: { period: string; rate: number; total: number }[] }) {
  const maxTotal = Math.max(...data.map((d) => d.total), 1);

  return (
    <div className="space-y-2.5">
      {data.map((week, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="w-16 flex-shrink-0 text-xs text-muted-foreground">{week.period}</span>
          <div className="flex flex-1 items-center gap-2">
            <div
              className="relative h-4 overflow-hidden rounded-full bg-panel"
              style={{ width: `${(week.total / maxTotal) * 100}%`, minWidth: week.total > 0 ? '20px' : '0' }}
            >
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-signature"
                style={{ width: `${week.rate}%` }}
              />
            </div>
            {week.total > 0 && (
              <span className="text-xs font-semibold text-muted-foreground">{week.rate.toFixed(0)}%</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AnalyticsPage() {
  const t = useTranslations('analytics');
  const typeLabel = useClothingTypeLabel();
  const { data, isLoading, isError } = useAnalytics(60);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('title')} description={t('subtitleAlt')} />
        <LoadingSkeleton />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('title')} description={t('subtitleAlt')} />
        <EmptyState state="sad" title={t('loadError')} />
      </div>
    );
  }

  const { wardrobe, usage, color_distribution, type_distribution, most_worn, least_worn, never_worn, acceptance_trend, insights } = data;

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitleAlt')} />

      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          title={t('totalItemsShort')}
          value={wardrobe.total_items}
          description={t('readyToWear', { count: wardrobe.items_by_status.ready })}
          icon={Shirt}
          color="amber"
        />
        <StatCard
          title={t('outfitsGenerated')}
          value={wardrobe.total_outfits}
          description={t('thisWeekCount', { count: wardrobe.outfits_this_week })}
          icon={Sparkles}
          color="sky"
        />
        <StatCard
          title={t('acceptanceRateShort')}
          value={wardrobe.acceptance_rate ? `${wardrobe.acceptance_rate}%` : '-'}
          description={wardrobe.acceptance_rate ? t('suggestionsAccepted') : t('noDataYet')}
          icon={TrendingUp}
          color="pink"
          trend={wardrobe.acceptance_rate && wardrobe.acceptance_rate > 50 ? 'up' : undefined}
        />
        <StatCard
          title={t('totalWears')}
          value={wardrobe.total_wears}
          description={wardrobe.average_rating ? t('avgRatingValue', { value: wardrobe.average_rating }) : t('trackYourOutfits')}
          icon={Activity}
          color="mint"
        />
      </div>

      {/* Insights */}
      {insights.length > 0 && (
        <div className="rounded-lg bg-signature-soft p-5 sm:p-6">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <Lightbulb className="h-5 w-5" strokeWidth={1.75} />
            {t('insights')}
          </h2>
          <ul className="mt-3 space-y-2">
            {insights.map((insight, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span aria-hidden className="mt-[7px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-foreground" />
                <span>{insight}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Tu armario en números */}
      <WardrobeNumbers usage={usage} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Color Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SectionIcon icon={PieChart} color="pink" />
              {t('colorDistribution')}
            </CardTitle>
            <CardDescription>{t('colorDistributionSubtitle')}</CardDescription>
          </CardHeader>
          <CardContent>
            {color_distribution.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noColorData')}</p>
            ) : (
              <div className="space-y-3">
                {color_distribution.slice(0, 8).map((color) => (
                  <ColorBar key={color.color} color={color.color} percentage={color.percentage} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Type Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SectionIcon icon={BarChart} color="sky" />
              {t('itemTypes')}
            </CardTitle>
            <CardDescription>{t('itemTypesSubtitle')}</CardDescription>
          </CardHeader>
          <CardContent>
            {type_distribution.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noItemsYet')}</p>
            ) : (
              <div className="space-y-3">
                {type_distribution.map((type) => (
                  <div key={type.type} className="flex items-center justify-between gap-3">
                    <span className="font-semibold">{typeLabel(type.type)}</span>
                    <div className="flex items-center gap-2">
                      <Progress value={type.percentage} className="h-2 w-24" />
                      <span className="w-10 text-right text-sm text-muted-foreground">
                        {type.count}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Most Worn */}
        <Card>
          <CardHeader>
            <CardTitle>{t('mostWornShort')}</CardTitle>
            <CardDescription>{t('yourFavorites')}</CardDescription>
          </CardHeader>
          <CardContent className="px-3 sm:px-4">
            {most_worn.length === 0 ? (
              <p className="px-2 text-sm text-muted-foreground">{t('startTracking')}</p>
            ) : (
              <div className="space-y-1">
                {most_worn.map((item) => (
                  <ItemCard key={item.id} item={item} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Least Worn */}
        <Card>
          <CardHeader>
            <CardTitle>{t('leastWornShort')}</CardTitle>
            <CardDescription>{t('considerWearing')}</CardDescription>
          </CardHeader>
          <CardContent className="px-3 sm:px-4">
            {least_worn.length === 0 ? (
              <p className="px-2 text-sm text-muted-foreground">{t('keepTracking')}</p>
            ) : (
              <div className="space-y-1">
                {least_worn.map((item) => (
                  <ItemCard key={item.id} item={item} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Never Worn */}
        <Card>
          <CardHeader>
            <CardTitle>{t('neverWorn')}</CardTitle>
            <CardDescription>{t('timeToTry')}</CardDescription>
          </CardHeader>
          <CardContent className="px-3 sm:px-4">
            {never_worn.length === 0 ? (
              <p className="px-2 text-sm text-muted-foreground">{t('allItemsWorn')}</p>
            ) : (
              <div className="space-y-1">
                {never_worn.map((item) => (
                  <ItemCard key={item.id} item={item} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Acceptance Trend */}
      {acceptance_trend.length > 0 && acceptance_trend.some((trend) => trend.total > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>{t('acceptanceRateTrend')}</CardTitle>
            <CardDescription>{t('acceptanceRateTrendSubtitle')}</CardDescription>
          </CardHeader>
          <CardContent>
            <AcceptanceTrendChart data={acceptance_trend} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
