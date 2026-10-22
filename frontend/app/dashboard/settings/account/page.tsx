'use client';

import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AvatarSettings } from '@/components/settings/avatar-settings';
import { SettingsSubpage } from '@/components/settings/subpage';
import { useUserProfile } from '@/lib/hooks/use-user';

/** Cuenta: the photo, and the name and email as they are. */
export default function AccountSettingsPage() {
  const t = useTranslations('settings');
  const { data: profile, isLoading } = useUserProfile();

  return (
    <SettingsSubpage title={t('account.title')} loading={isLoading || !profile}>
      <div className="space-y-6">
        <AvatarSettings user={profile} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="account-name">{t('account.name')}</Label>
            <Input id="account-name" value={profile?.display_name || ''} disabled />
          </div>
          <div className="space-y-2">
            <Label htmlFor="account-email">{t('profile.email')}</Label>
            <Input id="account-email" value={profile?.email || ''} disabled />
          </div>
        </div>
      </div>
    </SettingsSubpage>
  );
}
