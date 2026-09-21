'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowRight } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { usePinterestStatus } from '@/lib/hooks/use-pinterest';
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
  if (connected) return <Badge>{t('status.connected')}</Badge>;
  if (configured === false) return <Badge variant="outline">{t('status.unavailable')}</Badge>;
  return <Badge variant="outline">{t('status.notConnected')}</Badge>;
}

export default function IntegrationsIndexPage() {
  const t = useTranslations('integrations');
  const pinterest = usePinterestStatus();
  const spotify = useSpotifyStatus();

  const entries = [
    {
      key: 'pinterest',
      href: '/dashboard/settings/integrations/pinterest',
      status: pinterest,
    },
    {
      key: 'spotify',
      href: '/dashboard/settings/integrations/spotify',
      status: spotify,
    },
  ] as const;

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-10 py-10 sm:py-14 space-y-10">
      <header className="space-y-3">
        <Link href="/dashboard/settings" className="label-editorial link-editorial">
          {t('backToSettings')}
        </Link>
        <p className="label-editorial text-gold">{t('eyebrow')}</p>
        <h1 className="font-display italic font-black text-display-lg leading-none">
          {t('title')}
        </h1>
        <p className="font-editorial italic text-lg text-muted-foreground">{t('subtitle')}</p>
      </header>

      <div className="divider-gold" />

      <div className="grid gap-6 sm:grid-cols-2">
        {entries.map(({ key, href, status }) => (
          <Link
            key={key}
            href={href}
            className="card-editorial group block border border-border-solid/60 bg-card p-6 space-y-4 transition-all duration-200 ease-editorial hover:border-primary"
          >
            <div className="flex items-start justify-between gap-4">
              <p className="label-editorial">{t(`${key}.eyebrow`)}</p>
              <StatusBadge
                loading={status.isLoading}
                connected={status.data?.connected}
                configured={status.data?.configured}
              />
            </div>
            <h2 className="font-display text-3xl">{t(`${key}.title`)}</h2>
            <p className="font-editorial italic text-lg text-muted-foreground">
              {t(`${key}.description`)}
            </p>
            <span className="inline-flex items-center gap-2 label-editorial text-primary">
              {t(`${key}.manage`)}
              <ArrowRight
                className="h-3.5 w-3.5 transition-transform duration-200 ease-editorial group-hover:translate-x-1"
                strokeWidth={1.5}
              />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
