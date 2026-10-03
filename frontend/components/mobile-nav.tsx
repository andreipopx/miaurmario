'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { MAIN_SECTIONS, resolveNav } from '@/components/nav-items';
import { useSocialSummary } from '@/lib/hooks/use-social';
import { haptic } from '@/lib/native/haptics';

/**
 * Floating glass dock (mobile): every tab shows its icon and its name; the
 * current one has its icon in the pink pill. Page content reserves space for
 * it via the `pb-dock` utility in the dashboard layout.
 *
 * The tapped tab lights up at once (with a haptic tick), before the new screen
 * has arrived, the way a native tab bar answers; the pathname takes over again
 * as soon as it changes. Tab switches don't cross-fade: they should feel instant.
 */
export function MobileNav() {
  const pathname = usePathname();
  const t = useTranslations('nav');
  const { data: summary } = useSocialSummary();
  const socialCount = summary?.total ?? 0;
  // Sub-pages (Looks, Música, a friend's profile…) keep their section's tab lit.
  const routeKey = resolveNav(pathname)?.section.key;
  const [tapped, setTapped] = useState<string | null>(null);
  useEffect(() => setTapped(null), [pathname]);
  const activeKey = tapped ?? routeKey;

  return (
    <>
      {/* Fade so content scrolling under the dock stays legible. */}
      <div
        aria-hidden
        data-dock
        className="pointer-events-none fixed inset-x-0 bottom-0 z-header h-28 bg-gradient-to-b from-transparent to-background/90 lg:hidden"
      />
      <nav
        data-dock
        data-dock-nav
        aria-label={t('primary')}
        className="glass-dock fixed inset-x-4 z-dock mx-auto flex h-[68px] max-w-md items-stretch justify-between rounded-[34px] px-1.5 py-1.5 max-[359px]:inset-x-3 max-[359px]:px-1 lg:hidden"
        style={{ bottom: 'calc(20px + env(safe-area-inset-bottom))' }}
      >
        {MAIN_SECTIONS.map((item) => {
          const active = activeKey === item.key;
          const Icon = item.icon;
          const badge = item.socialBadge ? socialCount : 0;
          const name = t(item.shortKey ?? item.key);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                if (item.key === routeKey) return;
                setTapped(item.key);
                haptic(6);
              }}
              aria-current={active ? 'page' : undefined}
              aria-label={badge > 0 ? `${name} · ${t('newActivity', { count: badge })}` : undefined}
              className={cn(
                'group flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-[28px] active:scale-[0.96] transition-transform duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
              )}
            >
              {/* Every tab names itself (Apple's tab bars always do); the current one
                  sits in the pink pill. */}
              <span
                className={cn(
                  'relative flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-200 ease-pop max-[359px]:w-12',
                  active ? 'bg-signature text-signature-foreground' : 'text-foreground group-hover:bg-accent'
                )}
              >
                <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.1 : 1.75} aria-hidden />
                {badge > 0 && (
                  <span
                    aria-hidden
                    className="absolute -right-0.5 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-signature px-1 text-[10px] font-bold leading-none text-signature-foreground ring-2 ring-[var(--dock)]"
                  >
                    {badge > 9 ? '9+' : badge}
                  </span>
                )}
              </span>
              <span
                className={cn(
                  'max-w-full truncate px-0.5 text-[11px] leading-none',
                  active ? 'font-bold text-foreground' : 'font-semibold text-muted-foreground'
                )}
              >
                {name}
              </span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
