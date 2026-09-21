'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { DOCK_ITEMS, isActivePath } from '@/components/nav-items';

/**
 * Floating glass dock (mobile). Active tab = pink pill with icon + label;
 * inactive tabs are icon-only with an aria-label. Page content reserves
 * space for it via the `pb-dock` utility in the dashboard layout.
 */
export function MobileNav() {
  const pathname = usePathname();
  const t = useTranslations('nav');

  return (
    <>
      {/* Fade so content scrolling under the dock stays legible. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 bottom-0 z-40 h-28 bg-gradient-to-b from-transparent to-background/90 lg:hidden"
      />
      <nav
        aria-label={t('primary')}
        className="glass-dock fixed inset-x-4 z-50 mx-auto flex h-16 max-w-md items-center justify-between rounded-[32px] p-2 lg:hidden"
        style={{ bottom: 'calc(24px + env(safe-area-inset-bottom))' }}
      >
        {DOCK_ITEMS.map((item) => {
          const active = isActivePath(pathname, item.href);
          const Icon = item.icon;
          const label = t(item.key);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              aria-label={active ? undefined : label}
              className={cn(
                'flex h-12 items-center justify-center rounded-full transition-[background-color,padding,width] duration-200 ease-pop',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active
                  ? 'gap-2 bg-signature px-4 text-signature-foreground'
                  : 'w-12 text-foreground hover:bg-accent'
              )}
            >
              <Icon className={active ? 'h-5 w-5' : 'h-[22px] w-[22px]'} strokeWidth={active ? 2 : 1.75} aria-hidden />
              {active && <span className="text-sm font-bold">{label}</span>}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
