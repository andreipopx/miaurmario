'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/hooks/use-auth';
import { useSocialSummary } from '@/lib/hooks/use-social';
import { cn } from '@/lib/utils';
import { ProfileAvatar } from '@/components/profile-avatar';
import { Wordmark } from '@/components/brand/wordmark';
import { BackButton } from '@/components/native/back-button';
import { ProfileDropdown } from '@/components/profile-menu';
import { needsAppBack } from '@/lib/native/navigation';

interface HeaderProps {
  /** Opens the profile/menu sheet (mobile). */
  onMenuClick?: () => void;
}

const iconButton =
  'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * Mobile: profile avatar (photo or Stinky; opens the profile menu) · greeting or wordmark · bell.
 * Desktop: the sidebar carries the logo; the header keeps greeting + bell + avatar (→ profile menu).
 */
export function Header({ onMenuClick }: HeaderProps) {
  const { user } = useAuth();
  const pathname = usePathname();
  const t = useTranslations('common');
  const tNav = useTranslations('nav');

  const firstName = user?.display_name?.trim().split(/\s+/)[0];
  const greeting = firstName ? t('greeting', { name: firstName }) : t('greetingAnon');
  const isHome = pathname === '/dashboard';
  const { data: summary } = useSocialSummary();
  const news = summary?.total ?? 0;
  // Screens outside the dock tabs get an in-app back button (iOS standalone has none).
  const showBack = needsAppBack(pathname ?? '/dashboard');

  return (
    <header
      className="app-header sticky top-0 z-header"
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
            <ProfileAvatar size={44} />
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

        {/* Avisos: requests and what friends did with your looks, counted on the bell. */}
        <Link
          href="/dashboard/inbox"
          aria-label={news > 0 ? `${tNav('inbox')} · ${tNav('newActivity', { count: news })}` : tNav('inbox')}
          className={cn(iconButton, 'pressable relative')}
        >
          <Bell className="h-[22px] w-[22px]" strokeWidth={1.75} aria-hidden />
          {news > 0 && (
            <span
              aria-hidden
              className="absolute right-1.5 top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-signature px-1 text-[11px] font-bold leading-none text-signature-foreground"
            >
              {news > 9 ? '9+' : news}
            </span>
          )}
        </Link>

        {/* Desktop: avatar opens the profile menu (perfil, ajustes, admin, cerrar sesión) */}
        <ProfileDropdown />
      </div>
    </header>
  );
}
