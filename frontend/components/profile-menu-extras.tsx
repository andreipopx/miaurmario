'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { MessageSquareHeart, ShieldCheck } from 'lucide-react';

import { AppFeedbackDialog } from '@/components/app-feedback-dialog';
import { isActivePath } from '@/components/nav-items';
import { adminBadgeTotal } from '@/lib/admin';
import { useAdminBadge, useIsSiteAdmin } from '@/lib/hooks/use-admin';
import { cn } from '@/lib/utils';

const row =
  'flex min-h-[44px] w-full items-center gap-3 rounded-full px-4 text-[15px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** "Enviar sugerencia o fallo" for everyone + "Admin" (badge: new feedback + pending waitlist) for site admins. */
export function ProfileMenuExtras({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const isAdmin = useIsSiteAdmin();
  const { data: badge } = useAdminBadge();
  const [open, setOpen] = useState(false);
  const adminActive = isActivePath(pathname, '/dashboard/admin');
  const newCount = adminBadgeTotal(badge);

  return (
    <>
      <ul className="space-y-1">
        <li>
          <button
            type="button"
            onClick={() => {
              onNavigate?.(); // close the mobile menu first (it sits above dialogs)
              setOpen(true);
            }}
            className={cn(row, 'font-medium text-foreground hover:bg-accent')}
          >
            <MessageSquareHeart className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden />
            <span className="truncate">{t('sendFeedback')}</span>
          </button>
        </li>
        {isAdmin && (
          <li>
            <Link
              href="/dashboard/admin"
              onClick={onNavigate}
              aria-current={adminActive ? 'page' : undefined}
              className={cn(
                row,
                adminActive
                  ? 'bg-signature font-bold text-signature-foreground'
                  : 'font-medium text-foreground hover:bg-accent'
              )}
            >
              <ShieldCheck className="h-5 w-5 shrink-0" strokeWidth={adminActive ? 2 : 1.75} aria-hidden />
              <span className="flex-1 truncate">{t('admin')}</span>
              {newCount > 0 && (
                <span
                  className="rounded-full bg-foreground px-2 text-xs font-bold leading-6 text-background"
                  aria-label={t('adminBadge', { count: newCount })}
                >
                  {newCount}
                </span>
              )}
            </Link>
          </li>
        )}
      </ul>
      <AppFeedbackDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
