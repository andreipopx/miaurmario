'use client';

import { useTranslations } from 'next-intl';
import { ServiceLogo } from '@/components/brand/service-logos';
import { SettingsGroup, SettingsRow } from '@/components/settings/settings-list';
import { SettingsSubpage } from '@/components/settings/subpage';
import { usePinterestStatus } from '@/lib/hooks/use-pinterest';
import { useLastfmStatus } from '@/lib/hooks/use-lastfm';
import { useSpotifyStatus } from '@/lib/hooks/use-spotify';

type Key = 'lastfm' | 'spotify' | 'pinterest';

/** Pinterest is waiting on Pinterest, not on this server — say so. */
const UNAVAILABLE_LABEL: Record<Key, 'status.pending' | 'status.unavailable'> = {
  lastfm: 'status.unavailable',
  spotify: 'status.unavailable',
  pinterest: 'status.pending',
};

/**
 * Integraciones: one row per service with its state; what each one does is
 * explained on its own page.
 */
export default function IntegrationsIndexPage() {
  const t = useTranslations('integrations');
  const pinterest = usePinterestStatus();
  const spotify = useSpotifyStatus();
  const lastfm = useLastfmStatus();

  // Last.fm first: it's the one that works for everybody. Spotify second (limited
  // beta seats), Pinterest last (waiting on Pinterest).
  const entries: { key: Key; status: { isLoading: boolean; data?: { connected: boolean; configured: boolean } } }[] = [
    { key: 'lastfm', status: lastfm },
    { key: 'spotify', status: spotify },
    { key: 'pinterest', status: pinterest },
  ];

  const statusOf = (key: Key, s: (typeof entries)[number]['status']) => {
    if (s.isLoading || !s.data) return undefined;
    if (s.data.connected)
      return (
        <>
          <span className="h-2 w-2 rounded-full bg-pop-mint" aria-hidden />
          {t('status.connected')}
        </>
      );
    if (!s.data.configured) return t(UNAVAILABLE_LABEL[key]);
    return t('status.notConnected');
  };

  return (
    <SettingsSubpage title={t('title')}>
      <SettingsGroup>
        {entries.map(({ key, status }) => (
          <SettingsRow
            key={key}
            href={`/dashboard/settings/integrations/${key}`}
            leading={<ServiceLogo service={key} size={32} />}
            label={t(`${key}.title`)}
            value={statusOf(key, status)}
          />
        ))}
      </SettingsGroup>
    </SettingsSubpage>
  );
}
