'use client';

import {
  Brain,
  Lightbulb,
  TrendingUp,
  Activity,
  Sparkles,
  RefreshCw,
  ThumbsUp,
  ThumbsDown,
  Shirt,
  X,
  Heart,
  Cloud,
  Calendar,
  Snowflake,
  Leaf,
  CloudSun,
  Sun,
} from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { POP_BG, type PopColor } from '@/components/chip';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import {
  useLearning,
  useRecomputeLearning,
  useGenerateInsights,
  useAcknowledgeInsight,
  type ItemPair,
  type StyleInsight,
  type LearnedColorScore,
} from '@/lib/hooks/use-learning';
import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useColorLabel } from '@/lib/tag-labels';

function StatCard({
  title,
  value,
  description,
  icon: Icon,
  trend,
  color,
}: {
  title: string;
  value: string | number;
  description: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number | string }>;
  trend?: 'up' | 'down' | 'neutral';
  color: PopColor;
}) {
  return (
    <div className="space-y-3 rounded-lg bg-panel p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-muted-foreground">{title}</p>
        <span
          aria-hidden
          className={cn('flex h-9 w-9 items-center justify-center rounded-full text-pop-foreground', POP_BG[color])}
        >
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </span>
      </div>
      <div>
        <div className="text-[28px] font-extrabold leading-none tracking-tight">{value}</div>
        <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
          {trend === 'up' && <TrendingUp className="h-3 w-3 text-success" aria-hidden />}
          {trend === 'down' && <TrendingUp className="h-3 w-3 rotate-180 text-destructive" aria-hidden />}
          {description}
        </p>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-[120px] rounded-lg" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-32" />
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-6 w-full rounded-full" />
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-32" />
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-6 w-full rounded-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

const colorMap: Record<string, string> = {
  black: 'bg-gray-900',
  white: 'bg-white border border-border',
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
};

const WEATHER_STYLE: Record<string, { icon: React.ComponentType<{ className?: string; strokeWidth?: number | string }>; bg: string }> = {
  cold: { icon: Snowflake, bg: 'bg-pop-sky' },
  cool: { icon: Leaf, bg: 'bg-pop-mint' },
  mild: { icon: CloudSun, bg: 'bg-pop-pink' },
  hot: { icon: Sun, bg: 'bg-pop-amber' },
};

function ColorPreferenceBar({ colorScore }: { colorScore: LearnedColorScore }) {
  const colorLabel = useColorLabel();
  const bgColor = colorMap[colorScore.color.toLowerCase()] || 'bg-muted';
  const score = colorScore.score;
  const percentage = Math.abs(score) * 100;
  const isPositive = score >= 0;

  return (
    <div className="flex items-center gap-3">
      <div aria-hidden className={cn('h-5 w-5 shrink-0 rounded-full', bgColor)} />
      <div className="flex-1">
        <div className="mb-1 flex justify-between gap-2 text-sm">
          <span className="font-semibold">{colorLabel(colorScore.color)}</span>
          <span className="flex items-center gap-1 text-muted-foreground">
            {isPositive ? (
              <ThumbsUp className="h-3.5 w-3.5 text-success" strokeWidth={1.75} aria-hidden />
            ) : (
              <ThumbsDown className="h-3.5 w-3.5 text-destructive" strokeWidth={1.75} aria-hidden />
            )}
            {colorScore.interpretation}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-panel">
          <div
            className={cn('h-full rounded-full', isPositive ? 'bg-pop-mint' : 'bg-destructive')}
            style={{ width: `${Math.min(percentage, 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function ItemPairCard({ pair }: { pair: ItemPair }) {
  const t = useTranslations('learning');
  const successRate = pair.times_paired > 0
    ? Math.round((pair.times_accepted / pair.times_paired) * 100)
    : 0;

  return (
    <div className="flex items-center gap-4 rounded-lg bg-panel p-3">
      <div className="flex flex-1 items-center gap-2">
        {/* Item 1 */}
        <Link
          href={`/dashboard/wardrobe/${pair.item1.id}`}
          className="relative h-14 w-14 shrink-0 overflow-hidden rounded-quick bg-background ring-ring ring-offset-2 ring-offset-panel transition-all hover:ring-2 focus-visible:outline-none focus-visible:ring-2"
        >
          {pair.item1.thumbnail_url ? (
            <Image
              src={pair.item1.thumbnail_url}
              alt={pair.item1.name || pair.item1.type}
              fill
              className="object-cover"
              sizes="56px"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Shirt className="h-6 w-6 text-muted-foreground" strokeWidth={1.75} aria-hidden />
            </div>
          )}
        </Link>

        {/* Plus sign */}
        <div aria-hidden className="text-lg font-bold text-muted-foreground">+</div>

        {/* Item 2 */}
        <Link
          href={`/dashboard/wardrobe/${pair.item2.id}`}
          className="relative h-14 w-14 shrink-0 overflow-hidden rounded-quick bg-background ring-ring ring-offset-2 ring-offset-panel transition-all hover:ring-2 focus-visible:outline-none focus-visible:ring-2"
        >
          {pair.item2.thumbnail_url ? (
            <Image
              src={pair.item2.thumbnail_url}
              alt={pair.item2.name || pair.item2.type}
              fill
              className="object-cover"
              sizes="56px"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Shirt className="h-6 w-6 text-muted-foreground" strokeWidth={1.75} aria-hidden />
            </div>
          )}
        </Link>
      </div>

      <div className="text-right">
        <div className="flex items-center gap-1 justify-end">
          <Heart className="h-4 w-4 fill-signature text-signature" aria-hidden />
          <span className="font-bold">{successRate}%</span>
        </div>
        <div className="text-xs text-muted-foreground">
          {t('timesPaired', { count: pair.times_paired })}
        </div>
      </div>
    </div>
  );
}

function InsightCard({
  insight,
  onAcknowledge
}: {
  insight: StyleInsight;
  onAcknowledge: (id: string) => void;
}) {
  const t = useTranslations('learning');
  const categoryIcons: Record<string, React.ComponentType<{ className?: string; strokeWidth?: number | string }>> = {
    color: Sparkles,
    style: Heart,
    overall: Activity,
    weather: Cloud,
    occasion: Calendar,
  };

  // Pop colour per insight type (ink icon on top).
  const typeColors: Record<string, string> = {
    positive: 'bg-pop-mint',
    negative: 'bg-pop-amber',
    suggestion: 'bg-pop-sky',
    pattern: 'bg-pop-pink',
  };

  const Icon = categoryIcons[insight.category] || Lightbulb;
  const iconBg = typeColors[insight.insight_type] || 'bg-background';

  return (
    <div className="relative rounded-lg bg-panel p-4">
      <button
        type="button"
        onClick={() => onAcknowledge(insight.id)}
        className="absolute right-1.5 top-1.5 flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={t('dismiss')}
        title={t('dismiss')}
      >
        <X className="h-4 w-4" strokeWidth={1.75} />
      </button>
      <div className="flex items-start gap-3 pr-10">
        <span
          aria-hidden
          className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-pop-foreground', iconBg)}
        >
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <div>
          <h4 className="font-bold">{insight.title}</h4>
          <p className="mt-1 text-sm text-muted-foreground">{insight.description}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="capitalize">
              {insight.category}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {t('confidence', { percent: Math.round(insight.confidence * 100) })}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function NoLearningData({ onRecompute, isRefreshing }: { onRecompute: () => void; isRefreshing: boolean }) {
  const t = useTranslations('learning');
  return (
    <div className="space-y-2">
      <EmptyState
        state="sleepy"
        title={t('noDataTitle')}
        description={t('noDataBody')}
        action={
          <>
            <Button asChild>
              <Link href="/dashboard/suggest">
                <Sparkles className="h-4 w-4" strokeWidth={1.75} />
                {t('getOutfitSuggestions')}
              </Link>
            </Button>
            <Button variant="secondary" onClick={onRecompute} disabled={isRefreshing}>
              <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} strokeWidth={1.75} />
              {isRefreshing ? t('computing') : t('computeNow')}
            </Button>
          </>
        }
      />
      <p className="text-center text-xs text-muted-foreground">{t('alreadyGaveFeedback')}</p>
    </div>
  );
}

export default function LearningPage() {
  const t = useTranslations('learning');
  const locale = useLocale();
  const tWeather = useTranslations('learning.weather');
  const { data, isLoading, isError } = useLearning();
  const recompute = useRecomputeLearning();
  const generateInsights = useGenerateInsights();
  const acknowledgeInsight = useAcknowledgeInsight();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRecompute = async () => {
    setIsRefreshing(true);
    try {
      await recompute.mutateAsync();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleGenerateInsights = async () => {
    await generateInsights.mutateAsync();
  };

  const handleAcknowledgeInsight = (insightId: string) => {
    acknowledgeInsight.mutate(insightId);
  };

  if (isLoading) {
    return (
      <div className="space-y-6 py-2 sm:py-4">
        <PageHeader title={t('title')} description={t('subtitleLoading')} />
        <LoadingSkeleton />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="space-y-6 py-2 sm:py-4">
        <PageHeader title={t('title')} />
        <EmptyState state="sad" title={t('loadError')} />
      </div>
    );
  }

  const { profile, best_pairs, insights, preference_suggestions } = data;

  return (
    <div className="space-y-6 py-2 sm:py-4">
      <PageHeader
        title={t('title')}
        description={profile.has_learning_data ? t('subtitleWithData') : t('subtitleNoData')}
        action={
          profile.has_learning_data ? (
            <Button variant="secondary" onClick={handleRecompute} disabled={isRefreshing}>
              <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} strokeWidth={1.75} />
              {t('recompute')}
            </Button>
          ) : undefined
        }
      />

      {!profile.has_learning_data ? (
        <NoLearningData onRecompute={handleRecompute} isRefreshing={isRefreshing} />
      ) : (
        <>
          {/* Stats Cards */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              title={t('feedbackGiven')}
              value={profile.feedback_count}
              description={t('outfitsRated', { count: profile.outfits_rated })}
              icon={Activity}
              color="amber"
            />
            <StatCard
              title={t('acceptanceRate')}
              value={profile.overall_acceptance_rate
                ? `${Math.round(profile.overall_acceptance_rate * 100)}%`
                : '-'}
              description={profile.overall_acceptance_rate
                ? t('suggestionsAccepted')
                : t('notEnoughData')}
              icon={TrendingUp}
              color="sky"
              trend={profile.overall_acceptance_rate && profile.overall_acceptance_rate > 0.5 ? 'up' : undefined}
            />
            <StatCard
              title={t('averageRating')}
              value={profile.average_rating ? profile.average_rating.toFixed(1) : '-'}
              description={profile.average_rating ? t('outOfFiveStars') : t('rateMoreOutfits')}
              icon={Sparkles}
              color="pink"
            />
            <StatCard
              title={t('styleRating')}
              value={profile.average_style_rating ? profile.average_style_rating.toFixed(1) : '-'}
              description={profile.average_style_rating ? t('styleSatisfaction') : t('rateOutfitStyles')}
              icon={Heart}
              color="mint"
            />
          </div>

          {/* Active Insights */}
          {insights.length > 0 && (
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
                <div className="space-y-1.5">
                  <CardTitle className="flex items-center gap-2">
                    <Lightbulb className="h-5 w-5" strokeWidth={1.75} aria-hidden />
                    {t('styleInsights')}
                  </CardTitle>
                  <CardDescription>{t('styleInsightsSubtitle')}</CardDescription>
                </div>
                <Button variant="secondary" size="sm" className="h-11 sm:h-9" onClick={handleGenerateInsights}>
                  <RefreshCw className="h-4 w-4" strokeWidth={1.75} />
                  {t('newInsights')}
                </Button>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {insights.map((insight) => (
                    <InsightCard
                      key={insight.id}
                      insight={insight}
                      onAcknowledge={handleAcknowledgeInsight}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* Color Preferences */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5" strokeWidth={1.75} aria-hidden />
                  {t('learnedColorPrefs')}
                </CardTitle>
                <CardDescription>{t('learnedColorPrefsSubtitle')}</CardDescription>
              </CardHeader>
              <CardContent>
                {profile.color_preferences.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    {t('notEnoughColorFeedback')}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {profile.color_preferences.slice(0, 8).map((colorScore) => (
                      <ColorPreferenceBar key={colorScore.color} colorScore={colorScore} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Style Preferences */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Heart className="h-5 w-5" strokeWidth={1.75} aria-hidden />
                  {t('learnedStylePrefs')}
                </CardTitle>
                <CardDescription>{t('learnedStylePrefsSubtitle')}</CardDescription>
              </CardHeader>
              <CardContent>
                {profile.style_preferences.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    {t('notEnoughStyleFeedback')}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {profile.style_preferences.map((styleScore) => {
                      const isPositive = styleScore.score >= 0;
                      const percentage = Math.abs(styleScore.score) * 100;
                      return (
                        <div key={styleScore.style} className="flex items-center justify-between gap-3">
                          <span className="font-semibold capitalize">{styleScore.style}</span>
                          <div className="flex items-center gap-2">
                            <Progress
                              value={percentage}
                              className={cn('h-2 w-24', !isPositive && '[&>div]:bg-destructive')}
                            />
                            <span className="text-sm text-muted-foreground w-12 text-right">
                              {isPositive ? '+' : ''}{(styleScore.score * 100).toFixed(0)}%
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Best Item Pairs */}
          {best_pairs.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Heart className="h-5 w-5 fill-signature text-signature" aria-hidden />
                  {t('bestCombinations')}
                </CardTitle>
                <CardDescription>{t('bestCombinationsSubtitle')}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {best_pairs.map((pair, index) => (
                    <ItemPairCard key={index} pair={pair} />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Occasion Patterns */}
          {profile.occasion_patterns.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5" strokeWidth={1.75} aria-hidden />
                  {t('occasionPatterns')}
                </CardTitle>
                <CardDescription>{t('occasionPatternsSubtitle')}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {profile.occasion_patterns.map((pattern) => (
                    <div key={pattern.occasion} className="rounded-lg bg-panel p-4">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <h4 className="font-bold capitalize">{pattern.occasion}</h4>
                        <Badge variant="mint">
                          {t('successPercent', { percent: Math.round(pattern.success_rate * 100) })}
                        </Badge>
                      </div>
                      {pattern.preferred_colors.length > 0 && (
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-xs text-muted-foreground">{t('preferredColors')}</span>
                          <div className="flex gap-1">
                            {pattern.preferred_colors.map((color) => (
                              <div
                                key={color}
                                className={cn('h-4 w-4 rounded-full', colorMap[color.toLowerCase()] || 'bg-background')}
                                title={color}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Weather Preferences */}
          {profile.weather_preferences.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Cloud className="h-5 w-5" strokeWidth={1.75} aria-hidden />
                  {t('weatherPreferences')}
                </CardTitle>
                <CardDescription>{t('weatherPreferencesSubtitle')}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                  {profile.weather_preferences.map((pref) => (
                    <div key={pref.weather_type} className="flex flex-col items-center rounded-lg bg-panel p-4 text-center">
                      <span
                        aria-hidden
                        className={cn(
                          'mb-2 flex h-11 w-11 items-center justify-center rounded-full text-pop-foreground',
                          WEATHER_STYLE[pref.weather_type]?.bg ?? 'bg-background'
                        )}
                      >
                        {(() => {
                          const WIcon = WEATHER_STYLE[pref.weather_type]?.icon ?? Cloud;
                          return <WIcon className="h-5 w-5" strokeWidth={1.75} />;
                        })()}
                      </span>
                      <h4 className="font-bold capitalize">
                        {['cold', 'cool', 'mild', 'hot'].includes(pref.weather_type)
                          ? tWeather(pref.weather_type as 'cold' | 'cool' | 'mild' | 'hot')
                          : pref.weather_type}
                      </h4>
                      <p className="text-sm text-muted-foreground mt-1">
                        {t('layers', { count: pref.preferred_layers.toFixed(1) })}
                      </p>
                      <Badge variant="outline" className="mt-2 bg-background">
                        {t('successPercent', { percent: Math.round(pref.success_rate * 100) })}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Preference Suggestions */}
          {preference_suggestions.updated && preference_suggestions.suggestions && (
            <Card className="border-0 bg-signature-soft">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Lightbulb className="h-5 w-5" strokeWidth={1.75} aria-hidden />
                  {t('suggestedPrefs')}
                </CardTitle>
                <CardDescription>
                  {t('suggestedPrefsSubtitle')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {preference_suggestions.suggestions.suggested_favorite_colors && (
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-sm font-semibold">{t('addToFavorites')}</span>
                      <div className="flex flex-wrap gap-2">
                        {preference_suggestions.suggestions.suggested_favorite_colors.map((color) => (
                          <Badge key={color} variant="outline" className="bg-background capitalize">
                            <span aria-hidden className={cn('h-3 w-3 rounded-full', colorMap[color.toLowerCase()] || 'bg-muted')} />
                            {color}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {preference_suggestions.suggestions.suggested_avoid_colors && (
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-sm font-semibold">{t('addToAvoid')}</span>
                      <div className="flex flex-wrap gap-2">
                        {preference_suggestions.suggestions.suggested_avoid_colors.map((color) => (
                          <Badge key={color} variant="destructive" className="capitalize">
                            <span aria-hidden className={cn('h-3 w-3 rounded-full ring-1 ring-white/60', colorMap[color.toLowerCase()] || 'bg-muted')} />
                            {color}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div className="mt-4">
                  <Button asChild>
                    <Link href="/dashboard/settings">{t('updatePreferences')}</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Last Updated */}
          {profile.last_computed_at && (
            <p className="text-center text-xs text-muted-foreground">
              {t('lastUpdated', { date: new Date(profile.last_computed_at).toLocaleString(locale) })}
            </p>
          )}
        </>
      )}
    </div>
  );
}
