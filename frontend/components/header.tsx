'use client';

import Link from 'next/link';
import { Menu, LogOut, Users } from 'lucide-react';
import { useTheme } from 'next-themes';
import { signOut } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAuth } from '@/lib/hooks/use-auth';
import { usePendingIncomingCount } from '@/lib/hooks/use-social';
import { LanguageSwitcher, SHOW_LANGUAGE_SWITCHER } from '@/components/language-switcher';

interface HeaderProps {
  onMenuClick?: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const t = useTranslations('common');
  const tFriends = useTranslations('friends');
  const pendingCount = usePendingIncomingCount().data ?? 0;

  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');
  const handleLogout = () => signOut({ callbackUrl: '/login' });

  const getInitials = (name?: string | null) => {
    if (!name) return '·';
    return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
  };

  return (
    <header className="sticky top-0 z-40 border-b border-border-solid/40 bg-background/85 backdrop-blur-sm">
      <div className="flex h-16 items-center gap-x-3 px-4 sm:gap-x-5 sm:px-6 lg:px-10">
        {/* Mobile menu */}
        <button
          type="button"
          className="-m-2.5 p-2.5 text-muted-foreground hover:text-primary transition-colors lg:hidden"
          onClick={onMenuClick}
          aria-label={t('openSidebar')}
        >
          <Menu className="h-5 w-5" aria-hidden="true" strokeWidth={1.5} />
        </button>

        {/* Wordmark — visible on mobile only (sidebar carries it on desktop) */}
        <Link href="/dashboard" className="lg:hidden font-display italic font-black text-xl text-foreground">
          miaurmario
        </Link>

        <div className="flex flex-1 items-center justify-end gap-x-3 sm:gap-x-5">
          {SHOW_LANGUAGE_SWITCHER && (
            <>
              <LanguageSwitcher variant="compact" />
              <div className="h-4 w-px bg-border-solid/60" aria-hidden="true" />
            </>
          )}

          <button
            type="button"
            onClick={toggleTheme}
            aria-label={t('toggleTheme')}
            className="label-editorial hover:text-primary transition-colors duration-200 ease-editorial h-9 px-2"
          >
            {theme === 'dark' ? t('lightMode') : t('darkMode')}
          </button>

          <Link
            href="/dashboard/friends"
            className="relative text-muted-foreground hover:text-primary transition-colors duration-200 ease-editorial"
            aria-label={tFriends('title')}
          >
            <Users className="h-4 w-4" strokeWidth={1.5} />
            {pendingCount > 0 && (
              <span
                className="absolute -top-1 -right-2 min-w-[1.1rem] bg-primary px-1 text-[10px] font-medium text-primary-foreground"
                aria-label={tFriends('pending.badge', { count: pendingCount })}
              >
                {pendingCount}
              </span>
            )}
          </Link>

          <div className="hidden lg:block h-4 w-px bg-border-solid/60" aria-hidden="true" />

          <div className="flex items-center gap-x-3">
            <Avatar className="h-8 w-8 rounded-none border border-border-solid/60">
              <AvatarImage src={user?.avatar_url || ''} alt={user?.display_name || ''} className="rounded-none" />
              <AvatarFallback className="rounded-none bg-transparent font-display text-sm">
                {getInitials(user?.display_name)}
              </AvatarFallback>
            </Avatar>
            <span className="hidden lg:inline label-editorial">
              {user?.display_name || t('user')}
            </span>
            <button
              type="button"
              onClick={handleLogout}
              aria-label={t('signOut')}
              className="text-muted-foreground hover:text-primary transition-colors duration-200 ease-editorial"
            >
              <LogOut className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
