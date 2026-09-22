'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { SETTINGS, isTabRoot, resolveNav } from '@/components/nav-items';
import { useSocialSummary } from '@/lib/hooks/use-social';

/**
 * Pill strip with the sub-pages of the current section (Armario · Looks · …),
 * shown at the top of each section root. On desktop the sidebar already lists
 * them for the dock sections, so there it only shows for Ajustes (which is not
 * in the sidebar). Detail pages (/outfits/abc) don't show it: they have "back".
 */
export function SectionTabs() {
  const pathname = usePathname() ?? '';
  const t = useTranslations('nav');
  const resolved = resolveNav(pathname);
  const section = resolved?.section;
  const show = !!section && section.tabs.length > 1 && isTabRoot(pathname, section);
  const { data: summary } = useSocialSummary(show && !!section?.tabs.some((i) => i.socialBadge));
  const stripRef = useRef<HTMLElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);

  // Keep the active pill in view horizontally only (never scroll the page itself).
  useEffect(() => {
    const strip = stripRef.current;
    const el = activeRef.current;
    if (!strip || !el) return;
    const left = el.getBoundingClientRect().left - strip.getBoundingClientRect().left + strip.scrollLeft;
    strip.scrollLeft = Math.max(0, left - (strip.clientWidth - el.offsetWidth) / 2);
  }, [pathname]);

  if (!show || !section) return null;
  const tabs = section.tabs;
  const desktopToo = section.key === SETTINGS.key;

  return (
    <nav
      ref={stripRef}
      aria-label={t(section.key)}
      className={cn('-mx-4 mb-4 overflow-x-auto px-4 scrollbar-none sm:-mx-6 sm:px-6', !desktopToo && 'lg:hidden', desktopToo && 'lg:mx-0 lg:px-0')}
    >
      <ul className="flex w-max gap-2 py-1">
        {tabs.map((tab) => {
          const active = resolved?.tab?.href === tab.href;
          const badge = tab.socialBadge ? summary?.total ?? 0 : 0;
          return (
            <li key={tab.href}>
              <Link
                ref={active ? activeRef : undefined}
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'pressable flex h-10 items-center gap-1.5 whitespace-nowrap rounded-full px-4 text-sm transition-colors duration-150',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'bg-foreground font-bold text-background'
                    : 'bg-panel font-medium text-foreground hover:bg-accent'
                )}
              >
                {t(tab.key)}
                {badge > 0 && (
                  <span
                    className="flex h-5 min-w-5 items-center justify-center rounded-full bg-signature px-1.5 text-[11px] font-bold text-signature-foreground"
                    aria-label={t('newActivity', { count: badge })}
                  >
                    {badge > 9 ? '9+' : badge}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
