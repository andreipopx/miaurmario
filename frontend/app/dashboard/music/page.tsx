'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ExternalLink, Loader2, Music, Pause, Radio, Settings2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { StinkyTip } from '@/components/stinky-tip';
import { MusicPrefsCard } from '@/components/music/music-prefs-card';
import { Chip, POP_BG } from '@/components/chip';
import { MoodTimeline } from '@/components/music/mood-timeline';
import { cn } from '@/lib/utils';
import { capitalizeFirst, formatDateLocalized } from '@/lib/date-locale';
import { useSpotifyConnect } from '@/lib/hooks/use-spotify';
import { useMusicOverview, useMusicSyncOnMount } from '@/lib/hooks/use-music';
import {
  MUSIC_RANGES,
  moodColor,
  parseDay,
  relativeTime,
  sourceSettingsHref,
  type DayMood,
  type ListeningEventItem,
  type MusicOverview,
  type MusicRange,
  type MusicTrack,
  type NowPlaying,
  type OutfitDay,
  type TopArtist,
} from '@/lib/music';

const LASTFM_SETTINGS = '/dashboard/settings/integrations/lastfm';

function Cover({
  src,
  size,
  rounded = 'rounded-md',
  className,
}: {
  src: string | null | undefined;
  size: number;
  rounded?: string;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  return (
    <span
      className={cn('relative flex shrink-0 items-center justify-center overflow-hidden bg-panel', rounded, className)}
      style={{ width: size, height: size }}
    >
      {src && !broken ? (
        <Image src={src} alt="" fill sizes={`${size}px`} className="object-cover" onError={() => setBroken(true)} />
      ) : (
        <Music className="h-1/3 w-1/3 text-muted-foreground" aria-hidden />
      )}
    </span>
  );
}

function SectionTitle({ id, children, aside }: { id: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3 px-1">
      <h2 id={id} className="text-[15px] font-bold sm:text-lg">
        {children}
      </h2>
      {aside}
    </div>
  );
}

/** Stinky's line for a day: stored Spanish one-liner, or a localised template. */
function useOneLiner() {
  const t = useTranslations('music.oneLiner');
  const locale = useLocale();
  return (mood: DayMood) => {
    if (locale.startsWith('es') || mood.method === 'ai') return mood.one_liner;
    const artist = mood.dominant_artists[0];
    return artist ? t(`${mood.mood_key}.withArtist`, { artist }) : t(`${mood.mood_key}.plain`);
  };
}

export default function MusicPage() {
  const t = useTranslations('music');
  const [range, setRange] = useState<MusicRange>('7d');
  const overview = useMusicOverview(range);
  const connected = overview.data?.connected ?? false;
  const sync = useMusicSyncOnMount(connected);
  const connect = useSpotifyConnect();
  const data = overview.data;
  const manageHref = sourceSettingsHref(data?.source);
  const syncErrors = sync.data?.errors;
  const failedSource = syncErrors?.lastfm ? 'Last.fm' : syncErrors?.spotify ? 'Spotify' : null;

  const hasHistory = Boolean(data && (data.recent.length > 0 || data.moods.length > 0));

  return (
    <div className="mx-auto max-w-3xl space-y-7 py-2 sm:py-4">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        action={
          connected ? (
            <Button variant="outline" size="sm" asChild>
              <Link href={manageHref}>
                <Settings2 className="h-4 w-4" aria-hidden />
                {t('manage')}
              </Link>
            </Button>
          ) : undefined
        }
      />

      {overview.isLoading && !data ? (
        <div className="space-y-4" aria-busy="true" aria-label={t('loading')}>
          <Skeleton className="h-[104px] w-full" />
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-[220px] w-full" />
        </div>
      ) : overview.isError ? (
        <EmptyState state="sad" title={t('errorTitle')} description={t('errorBody')} />
      ) : data && !connected && !hasHistory ? (
        <EmptyState
          state="sleepy"
          title={t('emptyTitle')}
          description={
            data.configured || data.lastfm_configured ? t('emptyBody') : t('notConfigured')
          }
          action={
            data.configured || data.lastfm_configured ? (
              <div className="flex flex-wrap justify-center gap-2">
                {data.lastfm_configured && (
                  <Button asChild>
                    <Link href={LASTFM_SETTINGS}>{t('connectLastfmCta')}</Link>
                  </Button>
                )}
                {data.configured && (
                  <Button
                    variant={data.lastfm_configured ? 'outline' : 'default'}
                    onClick={() => connect.mutate()}
                    disabled={connect.isPending}
                  >
                    {connect.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                    {t('connectCta')}
                  </Button>
                )}
              </div>
            ) : (
              <Button variant="outline" asChild>
                <Link href={manageHref}>{t('manage')}</Link>
              </Button>
            )
          }
        />
      ) : data ? (
        <>
          <NowPlayingCard now={data.now_playing} last={data.recent[0] ?? null} syncing={sync.isPending} />
          {failedSource && (
            <p role="status" className="px-1 text-xs text-muted-foreground">
              {t('syncError', { source: failedSource })}
            </p>
          )}

          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label={t('rangeLabel')}>
            {MUSIC_RANGES.map((r) => (
              <Chip key={r} active={range === r} onClick={() => setRange(r)}>
                {t(`ranges.${r}`)}
              </Chip>
            ))}
          </div>

          <MoodSection data={data} />
          <TopsSection data={data} />
          <RecentSection items={data.recent} />
          <LooksSection days={data.outfit_days} />
          <MusicPrefsCard />
        </>
      ) : null}
    </div>
  );
}

function NowPlayingCard({
  now,
  last,
  syncing,
}: {
  now: NowPlaying | null;
  last: ListeningEventItem | null;
  syncing: boolean;
}) {
  const t = useTranslations('music');
  const locale = useLocale();
  const track = now ?? last;
  return (
    <section aria-labelledby="now-title" className="rounded-lg bg-panel p-3.5 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 id="now-title" className="text-[15px] font-bold sm:text-lg">
          {now ? t('nowPlaying') : t('lastPlayed')}
        </h2>
        {now ? (
          <span className="inline-flex h-[26px] items-center gap-1.5 rounded-full bg-background px-2.5 text-xs font-semibold">
            {now.is_playing ? (
              <Radio className="h-3.5 w-3.5 text-success" aria-hidden />
            ) : (
              <Pause className="h-3.5 w-3.5" aria-hidden />
            )}
            {now.is_playing ? t('playing') : t('paused')}
          </span>
        ) : syncing ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            {t('syncing')}
          </span>
        ) : null}
      </div>
      {track ? (
        <div className="mt-3 flex items-center gap-3.5">
          <Cover src={track.image_url} size={76} rounded="rounded-tile" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-extrabold leading-tight">{track.name}</p>
            <p className="truncate text-sm text-muted-foreground">{track.artists.join(', ')}</p>
            {!now && last && (
              <p className="mt-0.5 text-xs text-muted-foreground">{relativeTime(last.played_at, locale, t('justNow'))}</p>
            )}
          </div>
          {track.url && (
            <Button variant="ghost" size="icon" asChild>
              <a href={track.url} target="_blank" rel="noreferrer noopener" aria-label={track.url.includes('last.fm') ? t('openInLastfm') : t('openInSpotify')}>
                <ExternalLink className="h-[18px] w-[18px]" aria-hidden />
              </a>
            </Button>
          )}
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{t('nothingPlaying')}</p>
      )}
    </section>
  );
}

function StatTile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-tile bg-panel px-3 py-2.5">
      <dt className="text-[12px] font-medium text-muted-foreground">{label}</dt>
      <dd className="text-lg font-extrabold tracking-tight">{value}</dd>
    </div>
  );
}

function MoodSection({ data }: { data: MusicOverview }) {
  const t = useTranslations('music');
  const oneLiner = useOneLiner();
  const latest = data.moods.length ? data.moods[data.moods.length - 1] : null;
  const maxShare = data.genres[0]?.share || 1;
  return (
    <section aria-labelledby="mood-title" className="space-y-3">
      <SectionTitle id="mood-title">{t('moodTitle')}</SectionTitle>
      {latest ? (
        <>
          <StinkyTip className="bg-signature-soft">{oneLiner(latest)}</StinkyTip>
          <dl className="grid grid-cols-3 gap-2">
            <StatTile label={t('statPlays')} value={data.stats.plays} />
            <StatTile label={t('statMinutes')} value={data.stats.minutes} />
            <StatTile label={t('statArtists')} value={data.stats.unique_artists} />
          </dl>
          <MoodTimeline moods={data.moods} start={data.start} end={data.end} />
          {data.genres.length > 0 && (
            <div className="space-y-2 pt-1">
              <h3 className="px-1 text-sm font-bold">{t('genresTitle')}</h3>
              <ul className="space-y-1.5">
                {data.genres.slice(0, 5).map((g, i) => (
                  <li key={g.genre} className="flex items-center gap-2.5">
                    <span className="w-28 shrink-0 truncate text-[13px] font-medium capitalize">{g.genre}</span>
                    <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-panel">
                      <span
                        className={cn('block h-full rounded-full', POP_BG[(['amber', 'sky', 'pink', 'mint'] as const)[i % 4]])}
                        style={{ width: `${Math.max(6, (g.share / maxShare) * 100)}%` }}
                      />
                    </span>
                    <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                      {Math.round(g.share * 100)}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <p className="px-1 text-sm text-muted-foreground">{t('moodEmpty')}</p>
      )}
    </section>
  );
}

function TopsSection({ data }: { data: MusicOverview }) {
  const t = useTranslations('music');
  const source =
    data.top_source === 'spotify'
      ? t('sourceSpotify')
      : data.top_source === 'lastfm'
        ? t('sourceLastfm')
        : t('sourceHistory');
  return (
    <section aria-labelledby="tops-title" className="space-y-4">
      <SectionTitle id="tops-title" aside={<span className="text-xs text-muted-foreground">{source}</span>}>
        {t('topArtists')}
      </SectionTitle>
      {data.top_artists.length ? (
        <ul className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
          {data.top_artists.map((a: TopArtist, i) => (
            <li key={`${a.name}-${i}`} className="w-[84px] shrink-0 text-center">
              <Cover src={a.image_url} size={84} rounded="rounded-full" />
              <p className="mt-1.5 truncate text-[13px] font-semibold">{a.name}</p>
              {a.plays ? (
                <p className="text-[11px] text-muted-foreground">{t('playsCount', { count: a.plays })}</p>
              ) : a.genres[0] ? (
                <p className="truncate text-[11px] text-muted-foreground">{a.genres[0]}</p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-1 text-sm text-muted-foreground">{t('topsEmpty')}</p>
      )}

      <h3 className="px-1 pt-1 text-[15px] font-bold sm:text-lg">{t('topTracks')}</h3>
      {data.top_tracks.length ? (
        <ol className="space-y-1">
          {data.top_tracks.slice(0, 10).map((track: MusicTrack, i) => (
            <li key={`${track.track_id}-${i}`} className="flex min-h-[52px] items-center gap-3 rounded-tile px-1 py-1">
              <span className="w-5 shrink-0 text-center text-sm font-extrabold tabular-nums text-muted-foreground">{i + 1}</span>
              <Cover src={track.image_url} size={44} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{track.name}</p>
                <p className="truncate text-xs text-muted-foreground">{track.artists.join(', ')}</p>
              </div>
              {track.plays ? (
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{t('playsCount', { count: track.plays })}</span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="px-1 text-sm text-muted-foreground">{t('topsEmpty')}</p>
      )}
    </section>
  );
}

const RECENT_PREVIEW = 8;

function RecentSection({ items }: { items: ListeningEventItem[] }) {
  const t = useTranslations('music');
  const locale = useLocale();
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, RECENT_PREVIEW);
  return (
    <section aria-labelledby="recent-title" className="space-y-2">
      <SectionTitle id="recent-title">{t('recentTitle')}</SectionTitle>
      {items.length ? (
        <>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {shown.map((ev) => (
              <li key={ev.id} className="flex min-h-[60px] items-center gap-3 px-3 py-2">
                <Cover src={ev.image_url} size={44} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{ev.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{ev.artists.join(', ')}</p>
                </div>
                <time dateTime={ev.played_at} className="shrink-0 text-xs text-muted-foreground">
                  {relativeTime(ev.played_at, locale, t('justNow'))}
                </time>
              </li>
            ))}
          </ul>
          {items.length > RECENT_PREVIEW && (
            <Button variant="secondary" size="sm" className="w-full" onClick={() => setExpanded((v) => !v)}>
              {expanded ? t('showLess') : t('showAll', { count: items.length })}
            </Button>
          )}
        </>
      ) : (
        <p className="px-1 text-sm text-muted-foreground">{t('recentEmpty')}</p>
      )}
    </section>
  );
}

function LooksSection({ days }: { days: OutfitDay[] }) {
  const t = useTranslations('music');
  const locale = useLocale();
  return (
    <section aria-labelledby="looks-title" className="space-y-2">
      <SectionTitle id="looks-title">{t('looksTitle')}</SectionTitle>
      <p className="px-1 text-sm text-muted-foreground">{t('looksSubtitle')}</p>
      {days.length ? (
        <ul className="space-y-3">
          {days.map((day) => (
            <li key={day.date} className="rounded-lg bg-panel p-3.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-bold">
                  {capitalizeFirst(formatDateLocalized(parseDay(day.date), 'weekdayLong', locale))}
                </p>
                {day.mood && (
                  <span
                    className={cn(
                      'inline-flex h-[26px] items-center rounded-full px-2.5 text-xs font-bold text-pop-foreground',
                      POP_BG[moodColor(day.mood.mood_key)]
                    )}
                  >
                    {t(`moods.${day.mood.mood_key}`)}
                  </span>
                )}
              </div>
              <div className="mt-2.5 flex gap-2 overflow-x-auto">
                {day.outfits.map((o) => (
                  <Link
                    key={o.id}
                    href={`/dashboard/outfits/${o.id}`}
                    aria-label={o.name || t('viewLook')}
                    className="grid h-[92px] w-[92px] shrink-0 grid-cols-2 grid-rows-2 gap-0.5 overflow-hidden rounded-tile bg-background p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {o.thumbnails.slice(0, 4).map((src, i) => (
                      <span key={i} className="relative overflow-hidden rounded-[8px] bg-panel">
                        <Image src={src} alt="" fill sizes="46px" className="object-contain" />
                      </span>
                    ))}
                  </Link>
                ))}
              </div>
              {day.tracks.length > 0 ? (
                <ul className="mt-2.5 space-y-1">
                  {day.tracks.map((tr) => (
                    <li key={tr.track_id} className="flex items-center gap-2 text-[13px]">
                      <Music className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="truncate">
                        <span className="font-semibold">{tr.name}</span>
                        {tr.artist ? <span className="text-muted-foreground"> · {tr.artist}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">{t('looksNoMusic')}</p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-1 text-sm text-muted-foreground">{t('looksEmpty')}</p>
      )}
    </section>
  );
}
