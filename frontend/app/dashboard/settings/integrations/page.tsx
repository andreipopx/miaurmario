'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowRight, AudioLines, Check, Info, Music, Pin } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/page-header';
import { cn } from '@/lib/utils';
import { usePinterestStatus } from '@/lib/hooks/use-pinterest';
import { useLastfmStatus } from '@/lib/hooks/use-lastfm';
import { useSpotifyStatus } from '@/lib/hooks/use-spotify';

type Key = 'lastfm' | 'spotify' | 'pinterest';

const ICON: Record<Key, typeof Music> = {
  lastfm: AudioLines,
  spotify: Music,
  pinterest: Pin,
};

const ICON_BG: Record<Key, string> = {
  lastfm: 'bg-pop-amber',
  spotify: 'bg-pop-mint',
  pinterest: 'bg-pop-pink',
};

/** Pinterest is waiting on Pinterest, not on this server — say so. */
const UNAVAILABLE_LABEL: Record<Key, 'status.pending' | 'status.unavailable'> = {
  lastfm: 'status.unavailable',
  spotify: 'status.unavailable',
  pinterest: 'status.pending',
};

function StatusBadge({
  entryKey,
  connected,
  configured,
  loading,
}: {
  entryKey: Key;
  connected?: boolean;
  configured?: boolean;
  loading: boolean;
}) {
  const t = useTranslations('integrations');
  if (loading) return null;
  if (connected) return <Badge variant="mint">{t('status.connected')}</Badge>;
  if (configured === false)
    return (
      <Badge variant="outline" className="text-muted-foreground">
        {t(UNAVAILABLE_LABEL[entryKey])}
      </Badge>
    );
  return <Badge variant="outline">{t('status.notConnected')}</Badge>;
}

export default function IntegrationsIndexPage() {
  const t = useTranslations('integrations');
  const pinterest = usePinterestStatus();
  const spotify = useSpotifyStatus();
  const lastfm = useLastfmStatus();

  const nothingConnected =
    !lastfm.data?.connected && !spotify.data?.connected && !pinterest.data?.connected;

  // Last.fm first: it's the one that works for everybody. Spotify second (limited
  // beta seats), Pinterest last (waiting on Pinterest).
  const entries = [
    {
      key: 'lastfm' as Key,
      href: '/dashboard/settings/integrations/lastfm',
      status: lastfm,
      // Only nudge the newcomer; once something is connected the badge is noise.
      recommended: nothingConnected,
      extraHref: '/dashboard/settings/integrations/lastfm?guide=1#guia-lastfm',
      extraLabel: t('lastfm.guideCta'),
    },
    {
      key: 'spotify' as Key,
      href: '/dashboard/settings/integrations/spotify',
      status: spotify,
      recommended: false,
      extraHref: null,
      extraLabel: null,
    },
    {
      key: 'pinterest' as Key,
      href: '/dashboard/settings/integrations/pinterest',
      status: pinterest,
      recommended: false,
      extraHref: null,
      extraLabel: null,
    },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-2 sm:py-4">
      <Button variant="ghost" asChild className="-ml-3 text-muted-foreground hover:text-foreground">
        <Link href="/dashboard/settings">{t('backToSettings')}</Link>
      </Button>

      <PageHeader title={t('title')} description={t('subtitle')} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {entries.map(({ key, href, status, recommended, extraHref, extraLabel }) => {
          const Icon = ICON[key];
          return (
            <section
              key={key}
              aria-labelledby={`${key}-card-title`}
              className="flex flex-col gap-3 rounded-lg bg-panel p-5 sm:p-6"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span
                  aria-hidden
                  className={cn(
                    'flex h-12 w-12 items-center justify-center rounded-quick text-pop-foreground',
                    ICON_BG[key]
                  )}
                >
                  <Icon className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {recommended && <Badge variant="signature">{t('lastfm.recommended')}</Badge>}
                  <StatusBadge
                    entryKey={key}
                    loading={status.isLoading}
                    connected={status.data?.connected}
                    configured={status.data?.configured}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <p className="eyebrow">{t(`${key}.eyebrow`)}</p>
                <h2 id={`${key}-card-title`} className="text-lg font-bold">
                  {t(`${key}.title`)}
                </h2>
                <p className="text-[15px] leading-snug text-muted-foreground">
                  {t(`${key}.description`)}
                </p>
              </div>

              <p className="flex items-start gap-2 text-[15px] font-semibold leading-snug">
                <Check className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                {t(`${key}.gives`)}
              </p>

              <p className="flex items-start gap-2 text-sm leading-snug text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
                {t(`${key}.availability`)}
              </p>

              <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
                <Link
                  href={href}
                  className="group inline-flex min-h-[44px] items-center gap-1.5 text-sm font-bold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {t(`${key}.manage`)}
                  <ArrowRight
                    className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-1"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                </Link>
                {extraHref && extraLabel && (
                  <Link
                    href={extraHref}
                    className="inline-flex min-h-[44px] items-center text-sm font-bold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    {extraLabel}
                  </Link>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
