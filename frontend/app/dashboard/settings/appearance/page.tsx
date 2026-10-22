'use client';

import { useTranslations } from 'next-intl';
import { SettingsSection, SettingsSubpage } from '@/components/settings/subpage';
import { ThemeSelector } from '@/components/settings/theme-selector';
import { HapticsRow } from '@/components/settings/haptics-row';
import { LanguageSwitcher } from '@/components/language-switcher';

/** Apariencia: the theme (and the language, while the switcher is on), plus vibration. */
export default function AppearanceSettingsPage() {
  const t = useTranslations('settings.appearance');

  return (
    <SettingsSubpage title={t('title')}>
      <div className="space-y-8">
        <SettingsSection title={t('theme')}>
          <ThemeSelector />
        </SettingsSection>
        <LanguageSwitcher />
        <HapticsRow />
      </div>
    </SettingsSubpage>
  );
}
