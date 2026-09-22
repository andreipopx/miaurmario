'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowRight, AudioLines, Music, Pin } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/page-header';
import { cn } from '@/lib/utils';
import { usePinterestStatus } from '@/lib/hooks/use-pinterest';
import { useLastfmStatus } from '@/lib/hooks/use-lastfm';
import { useSpotifyStatus } from '@/lib/hooks/use-spotify';

function StatusBadge({
  connected,
  configured,
  loading,
}: {
  connected?: boolean;
  configured?: boolean;
  loading: boolean;
}) {
  const t = useTranslations('integrations');
  if (loading) return null;
  if (connected) return <Badge variant="mint">{t('status.connected')}</Badge>;
  if (configured === false) return <Badge variant="outline" className="text-muted-foreground">{t('status.unavailable')}</Badge>;
  return <Badge variant="outline">{t('status.notConnected')}</Badge>;
}

export default function IntegrationsIndexPage() {
  const t = useTranslations('integrations');
  const pinterest = usePinterestStatus();
  const spotify = useSpotifyStatus();
  const lastfm = useLastfmStatus();

  const entries = [
    {
      key: 'pinterest',
      href: '/dashboard/settings/integrations/pinterest',
      status: pinterest,
    },
    {
      key: 'lastfm',
      href: '/dashboard/settings/integrations/lastfm',
      status: lastfm,
    },
    {
      key: 'spotify',
      href: '/dashboard/settings/integrations/spotify',
      status: spotify,
    },
  ] as const;

  const iconBg = { pinterest: 'bg-pop-pink', lastfm: 'bg-pop-amber', spotify: 'bg-pop-mint' } as const;

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-2 sm:py-4">
      <Button variant="ghost" asChild className="-ml-3 text-muted-foreground hover:text-foreground">
        <Link href="/dashboard/settings">
          {t('backToSettings')}
        </Link>
      </Button>

      <PageHeader title={t('title')} description={t('subtitle')} />

      <div className="grid gap-4 sm:grid-cols-2">
        {entries.map(({ key, href, status }) => (
          <Link
            key={key}
            href={href}
            className="group block space-y-3 rounded-lg bg-panel p-5 transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:p-6"
          >
            <div className="flex items-start justify-between gap-4">
              <span
                aria-hidden
                className={cn(
                  'flex h-12 w-12 items-center justify-center rounded-quick text-pop-foreground',
                  iconBg[key]
                )}
              >
                {key === 'pinterest' ? (
                  <Pin className="h-5 w-5" strokeWidth={1.75} />
                ) : key === 'lastfm' ? (
                  <AudioLines className="h-5 w-5" strokeWidth={1.75} />
                ) : (
                  <Music className="h-5 w-5" strokeWidth={1.75} />
                )}
              </span>
              <StatusBadge
                loading={status.isLoading}
                connected={status.data?.connected}
                configured={status.data?.configured}
              />
            </div>
            <div className="space-y-1">
              <p className="eyebrow">{t(`${key}.eyebrow`)}</p>
              <h2 className="text-lg font-bold">{t(`${key}.title`)}</h2>
              <p className="text-[15px] leading-snug text-muted-foreground">{t(`${key}.description`)}</p>
            </div>
            <span className="inline-flex items-center gap-1.5 text-sm font-bold text-foreground">
              {t(`${key}.manage`)}
              <ArrowRight
                className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-1"
                strokeWidth={1.75}
                aria-hidden
              />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
