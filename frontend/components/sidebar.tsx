'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useSocialSummary } from '@/lib/hooks/use-social';
import { cn } from '@/lib/utils';
import { Wordmark } from '@/components/brand/wordmark';
import { MAIN_SECTIONS, resolveNav, type NavItem } from '@/components/nav-items';

export function NavRow({
  item,
  active,
  label,
  onClick,
  current,
}: {
  item: NavItem;
  active: boolean;
  label: string;
  onClick?: () => void;
  /** aria-current; defaults to `active`. Sections pass false when a sub-page is the real page. */
  current?: boolean;
}) {
  const Icon = item.icon;
  const { data: summary } = useSocialSummary(!!item.socialBadge);
  const badge = item.socialBadge ? summary?.total ?? 0 : 0;
  return (
    <Link
      href={item.href}
      onClick={onClick}
      aria-current={(current ?? active) ? 'page' : undefined}
      className={cn(
        'flex min-h-[44px] items-center gap-3 rounded-full px-4 text-[15px] transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'bg-signature font-bold text-signature-foreground'
          : 'font-medium text-foreground hover:bg-accent'
      )}
    >
      <Icon className="h-5 w-5 shrink-0" strokeWidth={active ? 2 : 1.75} aria-hidden />
      <span className="truncate">{label}</span>
      {badge > 0 && (
        <span
          className={cn(
            'ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold',
            active ? 'bg-foreground text-background' : 'bg-signature text-signature-foreground'
          )}
        >
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </Link>
  );
}

/** Indented sub-page row under the active section. */
function SubRow({ item, active, label }: { item: NavItem; active: boolean; label: string }) {
  const { data: summary } = useSocialSummary(!!item.socialBadge);
  const badge = item.socialBadge ? summary?.total ?? 0 : 0;
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-[38px] items-center gap-2 rounded-full pl-12 pr-4 text-[14px] transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active ? 'bg-accent font-bold text-foreground' : 'font-medium text-muted-foreground hover:bg-accent hover:text-foreground'
      )}
    >
      <span className="truncate">{label}</span>
      {badge > 0 && (
        <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-signature px-1.5 text-[11px] font-bold text-signature-foreground">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </Link>
  );
}

/**
 * Desktop sidebar (lg+): the same five areas as the mobile dock. The active area
 * unfolds its sub-pages underneath; Ajustes, Admin and sign out live in the
 * header avatar menu.
 */
export function Sidebar() {
  const pathname = usePathname();
  const tNav = useTranslations('nav');
  const resolved = resolveNav(pathname);

  return (
    <aside className="hidden border-r border-border bg-background lg:fixed lg:inset-y-0 lg:z-50 lg:flex lg:w-64 lg:flex-col">
      <div className="flex grow flex-col gap-y-6 overflow-y-auto px-4 pb-6">
        <div className="flex h-20 shrink-0 items-center px-4">
          <Link href="/dashboard" className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Wordmark className="text-[28px]" />
          </Link>
        </div>

        <nav aria-label={tNav('primary')}>
          <ul className="space-y-1">
            {MAIN_SECTIONS.map((section) => {
              const open = resolved?.section.key === section.key;
              // With sub-pages listed, the sub-row carries aria-current instead of the section.
              const current = section.tabs.length > 1 ? false : pathname === section.href;
              return (
                <li key={section.key}>
                  <NavRow item={section} active={open} label={tNav(section.key)} current={current} />
                  {open && section.tabs.length > 1 && (
                    <ul className="mt-1 space-y-0.5" aria-label={tNav(section.key)}>
                      {section.tabs.filter((tab) => !tab.hidden).map((tab) => (
                        <li key={tab.href}>
                          <SubRow item={tab} active={resolved?.tab?.href === tab.href} label={tNav(tab.key)} />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </aside>
  );
}
