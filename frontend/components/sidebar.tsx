'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { signOut } from 'next-auth/react';
import { LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Wordmark } from '@/components/brand/wordmark';
import {
  PRIMARY_ITEMS,
  SECONDARY_ITEMS,
  isActivePath,
  isSecondaryActive,
  type NavItem,
} from '@/components/nav-items';

export function NavRow({
  item,
  active,
  label,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  label: string;
  onClick?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
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
    </Link>
  );
}

/** Desktop sidebar (lg+). */
export function Sidebar() {
  const pathname = usePathname();
  const tNav = useTranslations('nav');
  const tCommon = useTranslations('common');

  return (
    <aside className="hidden border-r border-border bg-background lg:fixed lg:inset-y-0 lg:z-50 lg:flex lg:w-64 lg:flex-col">
      <div className="flex grow flex-col gap-y-6 overflow-y-auto px-4 pb-6">
        <div className="flex h-20 shrink-0 items-center px-4">
          <Link href="/dashboard" className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Wordmark className="text-[28px]" />
          </Link>
        </div>

        <nav aria-label={tNav('primary')} className="flex flex-1 flex-col gap-y-6">
          <ul className="space-y-1">
            {PRIMARY_ITEMS.map((item) => (
              <li key={item.href}>
                <NavRow item={item} active={isActivePath(pathname, item.href)} label={tNav(item.key)} />
              </li>
            ))}
          </ul>

          <div>
            <p className="eyebrow mb-2 px-4">{tCommon('settings')}</p>
            <ul className="space-y-1">
              {SECONDARY_ITEMS.map((item) => (
                <li key={item.href}>
                  <NavRow item={item} active={isSecondaryActive(pathname, item.href)} label={tNav(item.key)} />
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-auto">
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="flex min-h-[44px] w-full items-center gap-3 rounded-full px-4 text-[15px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <LogOut className="h-5 w-5" strokeWidth={1.75} aria-hidden />
              {tCommon('signOut')}
            </button>
          </div>
        </nav>
      </div>
    </aside>
  );
}
