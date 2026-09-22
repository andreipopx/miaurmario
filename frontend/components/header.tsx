'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/hooks/use-auth';
import { cn } from '@/lib/utils';
import { StinkyAvatar } from '@/components/brand/stinky-avatar';
import { Wordmark } from '@/components/brand/wordmark';
import { BackButton } from '@/components/native/back-button';
import { needsAppBack } from '@/lib/native/navigation';

interface HeaderProps {
  /** Opens the profile/menu sheet (mobile). */
  onMenuClick?: () => void;
}

const iconButton =
  'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * Mobile: Stinky avatar (opens the profile menu) · greeting or wordmark · bell.
 * Desktop: the sidebar carries the logo; the header keeps greeting + bell + avatar (→ Ajustes).
 */
export function Header({ onMenuClick }: HeaderProps) {
  const { user } = useAuth();
  const pathname = usePathname();
  const t = useTranslations('common');
  const tNav = useTranslations('nav');

  const firstName = user?.display_name?.trim().split(/\s+/)[0];
  const greeting = firstName ? t('greeting', { name: firstName }) : t('greetingAnon');
  const isHome = pathname === '/dashboard';
  // Screens outside the dock tabs get an in-app back button (iOS standalone has none).
  const showBack = needsAppBack(pathname ?? '/dashboard');

  return (
    <header
      className="app-header sticky top-0 z-40 bg-background/85 backdrop-blur-md supports-[backdrop-filter]:bg-background/75"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6 lg:h-20 lg:px-10">
        {/* Mobile: back on non-tab screens, otherwise the avatar opens the profile menu */}
        {showBack ? (
          <BackButton className="lg:hidden" />
        ) : (
          <button
            type="button"
            onClick={onMenuClick}
            aria-label={tNav('profileMenu')}
            className="pressable shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 lg:hidden"
          >
            <StinkyAvatar size={44} />
          </button>
        )}

        <div className={cn('flex min-w-0 flex-1 items-center justify-center lg:justify-start')}>
          {isHome ? (
            <p className="truncate text-xl font-bold tracking-tight lg:text-2xl lg:font-extrabold">{greeting}</p>
          ) : (
            <Link href="/dashboard" className="rounded-full px-2 lg:hidden" aria-label={tNav('today')}>
              <Wordmark className="text-[22px]" />
            </Link>
          )}
        </div>

        <Link href="/dashboard/notifications" aria-label={tNav('notifications')} className={cn(iconButton, 'pressable')}>
          <Bell className="h-[22px] w-[22px]" strokeWidth={1.75} aria-hidden />
        </Link>

        {/* Desktop: avatar goes straight to settings */}
        <Link
          href="/dashboard/settings"
          aria-label={tNav('settings')}
          className="hidden shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 lg:block"
        >
          <StinkyAvatar size={44} />
        </Link>
      </div>
    </header>
  );
}
