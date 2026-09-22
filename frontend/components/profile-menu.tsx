'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { signOut } from 'next-auth/react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { LogOut, MessageSquareHeart, Settings, ShieldCheck, type LucideIcon } from 'lucide-react';

import { AppFeedbackDialog } from '@/components/app-feedback-dialog';
import { ProfileAvatar } from '@/components/profile-avatar';
import { SETTINGS, isSectionActive } from '@/components/nav-items';
import { adminBadgeTotal } from '@/lib/admin';
import { useAuth } from '@/lib/hooks/use-auth';
import { useAdminBadge, useIsSiteAdmin } from '@/lib/hooks/use-admin';
import { cn } from '@/lib/utils';

/**
 * The profile menu is deliberately short: your profile, Ajustes, Admin (site
 * admins only), feedback and sign out. Sections live in the dock/sidebar and
 * their sub-pages inside each section, so nothing here repeats them.
 */

const ADMIN_HREF = '/dashboard/admin';

export function profileHref(username?: string | null): string {
  return username ? `/dashboard/friends/${encodeURIComponent(username)}` : SETTINGS.href;
}

interface MenuEntry {
  key: string;
  icon: LucideIcon;
  label: string;
  href?: string;
  active?: boolean;
  badge?: { count: number; label: string };
  onSelect?: () => void;
  muted?: boolean;
}

function useProfileMenu(openFeedback: () => void): { entries: MenuEntry[]; profile: { href: string; name: string; handle?: string } } {
  const t = useTranslations('nav');
  const tCommon = useTranslations('common');
  const pathname = usePathname();
  const { user } = useAuth();
  const isAdmin = useIsSiteAdmin();
  const { data: adminBadge } = useAdminBadge();
  const adminCount = adminBadgeTotal(adminBadge);

  const entries: MenuEntry[] = [
    { key: 'settings', icon: Settings, label: t('settings'), href: SETTINGS.href, active: isSectionActive(pathname, SETTINGS) },
  ];
  if (isAdmin) {
    const active = pathname === ADMIN_HREF || !!pathname?.startsWith(ADMIN_HREF + '/');
    entries.push({
      key: 'admin',
      icon: ShieldCheck,
      label: t('admin'),
      href: ADMIN_HREF,
      active,
      badge: adminCount > 0 ? { count: adminCount, label: t('adminBadge', { count: adminCount }) } : undefined,
    });
  }
  entries.push({ key: 'feedback', icon: MessageSquareHeart, label: t('sendFeedback'), onSelect: openFeedback });
  entries.push({
    key: 'signOut',
    icon: LogOut,
    label: tCommon('signOut'),
    onSelect: () => signOut({ callbackUrl: '/login' }),
    muted: true,
  });

  return {
    entries,
    profile: {
      href: profileHref(user?.username),
      name: user?.username ? `@${user.username}` : user?.display_name || tCommon('user'),
      handle: t('viewProfile'),
    },
  };
}

const rowClass = (active?: boolean, muted?: boolean) =>
  cn(
    'flex min-h-[44px] w-full items-center gap-3 rounded-full px-4 text-[15px] outline-none transition-colors duration-150',
    'focus-visible:ring-2 focus-visible:ring-ring data-[highlighted]:bg-accent',
    active
      ? 'bg-signature font-bold text-signature-foreground data-[highlighted]:bg-signature'
      : muted
        ? 'font-medium text-muted-foreground hover:bg-accent hover:text-foreground'
        : 'font-medium text-foreground hover:bg-accent'
  );

function RowContent({ entry }: { entry: MenuEntry }) {
  const Icon = entry.icon;
  return (
    <>
      <Icon className="h-5 w-5 shrink-0" strokeWidth={entry.active ? 2 : 1.75} aria-hidden />
      <span className="flex-1 truncate text-left">{entry.label}</span>
      {entry.badge && (
        <span
          className="rounded-full bg-foreground px-2 text-xs font-bold leading-6 text-background"
          aria-label={entry.badge.label}
        >
          {entry.badge.count}
        </span>
      )}
    </>
  );
}

/** Mobile: contents of the sheet opened from the header avatar. */
export function ProfileMenuSheetContent({
  onNavigate,
  closeButton,
}: {
  onNavigate: () => void;
  closeButton: React.ReactNode;
}) {
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const { entries, profile } = useProfileMenu(() => setFeedbackOpen(true));
  const signOutEntry = entries[entries.length - 1];
  const rest = entries.slice(0, -1);

  const renderRow = (entry: MenuEntry) =>
    entry.href ? (
      <Link
        href={entry.href}
        onClick={onNavigate}
        aria-current={entry.active ? 'page' : undefined}
        className={rowClass(entry.active, entry.muted)}
      >
        <RowContent entry={entry} />
      </Link>
    ) : (
      <button
        type="button"
        onClick={() => {
          onNavigate(); // close the sheet first (it sits above dialogs)
          entry.onSelect?.();
        }}
        className={rowClass(entry.active, entry.muted)}
      >
        <RowContent entry={entry} />
      </button>
    );

  return (
    <>
      <div className="flex items-center gap-3 rounded-lg bg-panel p-3">
        <Link
          href={profile.href}
          onClick={onNavigate}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ProfileAvatar size={52} className="bg-background" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-bold">{profile.name}</span>
            <span className="block truncate text-sm text-muted-foreground">{profile.handle}</span>
          </span>
        </Link>
        {closeButton}
      </div>
      <ul className="mt-4 space-y-1">
        {rest.map((entry) => (
          <li key={entry.key}>{renderRow(entry)}</li>
        ))}
      </ul>
      <div className="mt-auto pt-4">{renderRow(signOutEntry)}</div>
      <AppFeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </>
  );
}

/** Desktop: header avatar → dropdown. */
export function ProfileDropdown() {
  const t = useTranslations('nav');
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const { entries, profile } = useProfileMenu(() => setFeedbackOpen(true));

  return (
    <>
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger
          data-profile-trigger
          aria-label={t('profileMenu')}
          className="hidden shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 lg:block"
        >
          <ProfileAvatar size={44} />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={8}
            className="z-[80] w-72 rounded-lg bg-popover p-2 text-popover-foreground shadow-[0_20px_60px_rgba(0,0,0,0.18)]"
          >
            <DropdownMenu.Item asChild>
              <Link
                href={profile.href}
                className="mb-1 flex items-center gap-3 rounded-2xl bg-panel p-3 outline-none data-[highlighted]:bg-accent"
              >
                <ProfileAvatar size={40} className="bg-background" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-bold">{profile.name}</span>
                  <span className="block truncate text-[13px] text-muted-foreground">{profile.handle}</span>
                </span>
              </Link>
            </DropdownMenu.Item>
            {entries.map((entry) =>
              entry.href ? (
                <DropdownMenu.Item key={entry.key} asChild>
                  <Link
                    href={entry.href}
                    aria-current={entry.active ? 'page' : undefined}
                    className={rowClass(entry.active, entry.muted)}
                  >
                    <RowContent entry={entry} />
                  </Link>
                </DropdownMenu.Item>
              ) : (
                <DropdownMenu.Item
                  key={entry.key}
                  onSelect={() => entry.onSelect?.()}
                  className={cn(rowClass(entry.active, entry.muted), 'cursor-pointer')}
                >
                  <RowContent entry={entry} />
                </DropdownMenu.Item>
              )
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <AppFeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </>
  );
}
