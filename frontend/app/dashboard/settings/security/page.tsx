'use client';

import { useTranslations } from 'next-intl';
import { SettingsSubpage } from '@/components/settings/subpage';
import { SecuritySettings } from '@/components/settings/security-card';
import { useUserProfile } from '@/lib/hooks/use-user';

/** Seguridad: an optional password on top of the magic link, and closing every session. */
export default function SecuritySettingsPage() {
  const t = useTranslations('settings.security');
  const { data: profile, isLoading } = useUserProfile();

  return (
    <SettingsSubpage title={t('title')} loading={isLoading || !profile}>
      <SecuritySettings user={profile} />
    </SettingsSubpage>
  );
}
