'use client';

import { useTranslations } from 'next-intl';
import {
  Bell,
  KeyRound,
  MapPin,
  NotebookPen,
  Palette,
  Plug,
  Ruler,
  SlidersHorizontal,
  Sparkles,
  SwatchBook,
  UserRound,
  Wand2,
} from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { SettingsGroup, SettingsRow } from '@/components/settings/settings-list';
import { useMountedTheme } from '@/components/settings/theme-selector';
import { StinkyHeadIcon } from '@/components/brand/stinky-head-icon';
import { useStinkyPersona } from '@/components/stinky/stinky-persona';
import { usePreferences } from '@/lib/hooks/use-preferences';
import { useUserProfile } from '@/lib/hooks/use-user';
import { useAIStatus } from '@/lib/hooks/use-ai-access';
import { useLastfmStatus } from '@/lib/hooks/use-lastfm';
import { useSpotifyStatus } from '@/lib/hooks/use-spotify';
import { usePinterestStatus } from '@/lib/hooks/use-pinterest';
import { clothingColorHex } from '@/lib/colors';

/** Up to four favourite colours, as dots: the value of the «Colores» row. */
function ColorDots({ colors }: { colors: string[] }) {
  if (colors.length === 0) return null;
  return (
    <span className="flex -space-x-1" aria-hidden>
      {colors.slice(0, 4).map((c) => (
        <span
          key={c}
          className="h-4 w-4 rounded-full ring-2 ring-panel"
          style={{ backgroundColor: clothingColorHex(c) ?? 'transparent' }}
        />
      ))}
    </span>
  );
}

/**
 * Ajustes: a navigation list. Every row opens its own screen, which saves its own
 * fields; the value on the right is the current one where it helps.
 */
export default function SettingsPage() {
  const t = useTranslations('settings');
  const tAi = useTranslations('aiAccess');
  const tAppearance = useTranslations('settings.appearance');
  const { data: profile } = useUserProfile();
  const { data: preferences } = usePreferences();
  const { data: ai } = useAIStatus();
  const { theme } = useMountedTheme();
  const { name: stinkyName } = useStinkyPersona();
  const lastfm = useLastfmStatus();
  const spotify = useSpotifyStatus();
  const pinterest = usePinterestStatus();

  const themeLabel =
    theme === 'light' ? tAppearance('themeLight') : theme === 'dark' ? tAppearance('themeDark') : theme === 'system' ? tAppearance('themeSystem') : undefined;
  const city = profile?.location_name?.split(',')[0];
  const connected = [
    lastfm.data?.connected && 'Last.fm',
    spotify.data?.connected && 'Spotify',
    pinterest.data?.connected && 'Pinterest',
  ].filter(Boolean) as string[];

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-2 sm:py-4">
      <PageHeader title={t('title')} />

      <SettingsGroup>
        <SettingsRow href="/dashboard/settings/account" icon={UserRound} tone="sky" label={t('account.title')} value={profile?.display_name} />
        <SettingsRow href="/dashboard/settings/appearance" icon={Palette} tone="pink" label={t('appearance.title')} value={themeLabel} />
        <SettingsRow
          href="/dashboard/settings/security"
          icon={KeyRound} tone="amber"
          label={t('security.title')}
          value={profile ? (profile.has_password ? t('rows.password') : t('rows.magicLink')) : undefined}
        />
      </SettingsGroup>

      <SettingsGroup>
        <SettingsRow href="/dashboard/stinky/customize" icon={StinkyHeadIcon} tone="pink" label={t('rows.stinky')} value={stinkyName} />
        <SettingsRow href="/dashboard/settings/style" icon={Wand2} tone="amber" label={t('rows.style')} />
        <SettingsRow href="/dashboard/settings/memory" icon={NotebookPen} tone="sky" label={t('stinkyMemory.title')} />
        <SettingsRow href="/dashboard/settings/ai" icon={Sparkles} tone="mint" label={t('rows.ai')} value={ai ? tAi(`access.${ai.access}`) : undefined} />
      </SettingsGroup>

      <SettingsGroup>
        <SettingsRow href="/dashboard/settings/location" icon={MapPin} tone="sky" label={t('location.title')} value={city} />
        <SettingsRow href="/dashboard/settings/measurements" icon={Ruler} tone="amber" label={t('measurements.title')} />
        <SettingsRow
          href="/dashboard/settings/colors"
          icon={SwatchBook} tone="pink"
          label={t('colors.title')}
          value={<ColorDots colors={preferences?.color_favorites ?? []} />}
        />
        <SettingsRow href="/dashboard/settings/recommendations" icon={SlidersHorizontal} tone="mint" label={t('recommendations.title')} />
      </SettingsGroup>

      <SettingsGroup>
        <SettingsRow href="/dashboard/notifications" icon={Bell} tone="amber" label={t('notifications.title')} />
        <SettingsRow href="/dashboard/settings/integrations" icon={Plug} tone="mint" label={t('integrations.title')} value={connected.join(' · ')} />
      </SettingsGroup>
    </div>
  );
}
