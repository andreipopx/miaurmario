'use client';

import { TransitionLink } from '@/components/native/transition-link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { MAIN_SECTIONS, resolveNav } from '@/components/nav-items';
import { useSocialSummary } from '@/lib/hooks/use-social';

/**
 * Floating glass dock (mobile). Active tab = pink pill with icon + label;
 * inactive tabs are icon-only with an aria-label. Page content reserves
 * space for it via the `pb-dock` utility in the dashboard layout.
 */
export function MobileNav() {
  const pathname = usePathname();
  const t = useTranslations('nav');
  const { data: summary } = useSocialSummary();
  const socialCount = summary?.total ?? 0;
  // Sub-pages (Looks, Música, a friend's profile…) keep their section's tab lit.
  const activeKey = resolveNav(pathname)?.section.key;

  return (
    <>
      {/* Fade so content scrolling under the dock stays legible. */}
      <div
        aria-hidden
        data-dock
        className="pointer-events-none fixed inset-x-0 bottom-0 z-40 h-28 bg-gradient-to-b from-transparent to-background/90 lg:hidden"
      />
      <nav
        data-dock
        data-dock-nav
        aria-label={t('primary')}
        className="glass-dock fixed inset-x-4 z-50 mx-auto flex h-16 max-w-md items-center justify-between rounded-[32px] p-2 max-[359px]:inset-x-3 max-[359px]:p-1.5 lg:hidden"
        style={{ bottom: 'calc(24px + env(safe-area-inset-bottom))' }}
      >
        {MAIN_SECTIONS.map((item) => {
          const active = activeKey === item.key;
          const Icon = item.icon;
          const badge = item.socialBadge ? socialCount : 0;
          const label = badge > 0 ? `${t(item.key)} · ${t('newActivity', { count: badge })}` : t(item.key);
          return (
            <TransitionLink
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              aria-label={active ? undefined : label}
              className={cn(
                'pressable flex h-12 items-center justify-center rounded-full transition-[background-color,padding,width,transform] duration-200 ease-pop',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                // Narrow phones / big system font: inactive icons give up their
                // spare width first, the active pill keeps its label (truncated
                // only as a last resort) so all five always fit.
                active
                  ? 'min-w-0 max-w-[55%] shrink-0 gap-2 bg-signature px-4 text-signature-foreground max-[359px]:gap-1.5 max-[359px]:px-3'
                  : 'w-12 min-w-0 shrink text-foreground hover:bg-accent'
              )}
            >
              <span className="relative shrink-0">
                <Icon className={active ? 'h-5 w-5' : 'h-[22px] w-[22px]'} strokeWidth={active ? 2 : 1.75} aria-hidden />
                {badge > 0 && (
                  <span
                    aria-hidden
                    className={cn(
                      'absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none',
                      active ? 'bg-foreground text-background' : 'bg-signature text-signature-foreground'
                    )}
                  >
                    {badge > 9 ? '9+' : badge}
                  </span>
                )}
              </span>
              {active && <span className="min-w-0 truncate text-sm font-bold">{t(item.shortKey ?? item.key)}</span>}
            </TransitionLink>
          );
        })}
      </nav>
    </>
  );
}
