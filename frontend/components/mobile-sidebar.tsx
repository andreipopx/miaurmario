'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { signOut } from 'next-auth/react';
import { LogOut, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/hooks/use-auth';
import { StinkyAvatar } from '@/components/brand/stinky-avatar';
import { NavRow } from '@/components/sidebar';
import { PRIMARY_ITEMS, SECONDARY_ITEMS, isActivePath, isSecondaryActive } from '@/components/nav-items';

interface MobileSidebarProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Mobile profile menu, opened from the Stinky avatar in the header.
 * Holds every section that doesn't fit in the 4-tab dock, plus Ajustes and sign out.
 */
export function MobileSidebar({ open, onClose }: MobileSidebarProps) {
  const pathname = usePathname();
  const { user } = useAuth();
  const tNav = useTranslations('nav');
  const tCommon = useTranslations('common');
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (open) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
      closeRef.current?.focus();
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  return (
    <div className={cn('lg:hidden', !open && 'pointer-events-none')}>
      <div
        className={cn(
          'fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px] transition-opacity duration-300',
          open ? 'opacity-100' : 'opacity-0'
        )}
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={tNav('profileMenu')}
        className={cn(
          'fixed inset-y-2 left-2 z-[70] w-80 max-w-[calc(100vw-1rem)] rounded-lg bg-popover shadow-[0_20px_60px_rgba(0,0,0,0.25)] transition-[transform,visibility] duration-300 ease-out',
          open ? 'visible translate-x-0' : 'invisible -translate-x-[110%]'
        )}
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="flex h-full flex-col overflow-y-auto p-4">
          <div className="flex items-center gap-3 rounded-lg bg-panel p-3">
            <Link
              href="/dashboard/settings"
              onClick={onClose}
              className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <StinkyAvatar size={52} className="bg-background" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-bold">{user?.display_name || tCommon('user')}</span>
                <span className="block truncate text-sm text-muted-foreground">{tNav('viewProfile')}</span>
              </span>
            </Link>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-background text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="sr-only">{tCommon('close')}</span>
              <X className="h-5 w-5" strokeWidth={1.75} aria-hidden />
            </button>
          </div>

          <nav aria-label={tNav('primary')} className="mt-4 flex flex-1 flex-col gap-y-5">
            <ul className="space-y-1">
              {PRIMARY_ITEMS.map((item) => (
                <li key={item.href}>
                  <NavRow item={item} active={isActivePath(pathname, item.href)} label={tNav(item.key)} onClick={onClose} />
                </li>
              ))}
            </ul>
            <div>
              <p className="eyebrow mb-2 px-4">{tCommon('settings')}</p>
              <ul className="space-y-1">
                {SECONDARY_ITEMS.map((item) => (
                  <li key={item.href}>
                    <NavRow
                      item={item}
                      active={isSecondaryActive(pathname, item.href)}
                      label={tNav(item.key)}
                      onClick={onClose}
                    />
                  </li>
                ))}
              </ul>
            </div>
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="mt-auto flex min-h-[44px] w-full items-center gap-3 rounded-full px-4 text-[15px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <LogOut className="h-5 w-5" strokeWidth={1.75} aria-hidden />
              {tCommon('signOut')}
            </button>
          </nav>
        </div>
      </div>
    </div>
  );
}
