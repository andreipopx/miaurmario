'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

const primaryItems = [
  { key: 'dashboard', href: '/dashboard' },
  { key: 'wardrobe', href: '/dashboard/wardrobe' },
  { key: 'suggest', href: '/dashboard/suggest' },
  { key: 'outfits', href: '/dashboard/outfits' },
  { key: 'pairings', href: '/dashboard/pairings' },
  { key: 'pins', href: '/dashboard/pins' },
  { key: 'history', href: '/dashboard/history' },
  { key: 'family', href: '/dashboard/family/feed' },
  { key: 'analytics', href: '/dashboard/analytics' },
  { key: 'learning', href: '/dashboard/learning' },
] as const;

const secondaryItems = [
  { key: 'family', href: '/dashboard/family' },
  { key: 'notifications', href: '/dashboard/notifications' },
  { key: 'settings', href: '/dashboard/settings' },
] as const;

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`group flex items-baseline gap-3 py-2 transition-colors duration-200 ease-editorial ${
        active
          ? 'text-primary'
          : 'text-foreground hover:text-primary'
      }`}
    >
      <span
        aria-hidden
        className={`h-px w-4 transition-all duration-200 ease-editorial ${
          active ? 'w-8 bg-primary' : 'bg-border-solid/60 group-hover:w-8 group-hover:bg-primary'
        }`}
      />
      <span className={active ? 'font-medium' : ''}>{children}</span>
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const tNav = useTranslations('nav');
  const tCommon = useTranslations('common');

  return (
    <aside className="hidden lg:fixed lg:inset-y-0 lg:z-50 lg:flex lg:w-72 lg:flex-col border-r border-border-solid/40 bg-card">
      <div className="flex grow flex-col gap-y-8 overflow-y-auto px-8 pb-8">
        <div className="flex h-16 shrink-0 items-center">
          <Link href="/dashboard" className="font-display italic font-black text-2xl text-foreground">
            miaurmario
          </Link>
        </div>

        <div className="divider-gold" />

        <nav className="flex flex-1 flex-col gap-y-10">
          <ul className="space-y-1 text-sm">
            {primaryItems.map((item) => {
              const isActive = item.href === '/dashboard'
                ? pathname === '/dashboard'
                : pathname === item.href || pathname.startsWith(item.href + '/');
              return (
                <li key={item.href}>
                  <NavLink href={item.href} active={isActive}>{tNav(item.key)}</NavLink>
                </li>
              );
            })}
          </ul>

          <div>
            <p className="label-editorial mb-3">{tCommon('settings')}</p>
            <ul className="space-y-1 text-sm">
              {secondaryItems.map((item) => {
                const matchesPath = pathname === item.href || pathname.startsWith(item.href + '/');
                const claimedByPrimary = primaryItems.some(
                  (primary) => pathname === primary.href || pathname.startsWith(primary.href + '/')
                );
                const isActive = matchesPath && !claimedByPrimary;
                return (
                  <li key={item.href}>
                    <NavLink href={item.href} active={isActive}>{tNav(item.key)}</NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        </nav>
      </div>
    </aside>
  );
}
