'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';

export const THEME_OPTIONS = [
  { value: 'light', labelKey: 'themeLight', Icon: Sun },
  { value: 'dark', labelKey: 'themeDark', Icon: Moon },
  { value: 'system', labelKey: 'themeSystem', Icon: Monitor },
] as const;

export type ThemeValue = (typeof THEME_OPTIONS)[number]['value'];

/** The stored theme, once the client knows it (next-themes is client-only). */
export function useMountedTheme(): { theme: ThemeValue | undefined; setTheme: (t: string) => void } {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const known = THEME_OPTIONS.some((o) => o.value === theme) ? (theme as ThemeValue) : 'system';
  return { theme: mounted ? known : undefined, setTheme };
}

/** Claro / Oscuro / Sistema as a pill segmented control (next-themes). */
export function ThemeSelector() {
  const t = useTranslations('settings.appearance');
  const { theme: current, setTheme } = useMountedTheme();

  return (
    <div role="group" aria-label={t('theme')} className="grid w-full max-w-sm grid-cols-3 gap-1 rounded-full bg-panel p-1">
      {THEME_OPTIONS.map(({ value, labelKey, Icon }) => {
        const active = current === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => setTheme(value)}
            aria-pressed={active}
            className={cn(
              'inline-flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-full px-2 text-sm font-semibold transition-colors duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              active ? 'bg-primary text-primary-foreground' : 'bg-transparent text-foreground hover:bg-background'
            )}
          >
            <Icon className="h-4 w-4" strokeWidth={active ? 2 : 1.75} aria-hidden />
            {t(labelKey)}
          </button>
        );
      })}
    </div>
  );
}
