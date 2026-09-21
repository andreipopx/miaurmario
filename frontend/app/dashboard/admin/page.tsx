'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { InboxSection } from '@/components/admin/inbox-section';
import { OverviewSection } from '@/components/admin/overview-section';
import { SignupSection } from '@/components/admin/signup-section';
import { SystemSection } from '@/components/admin/system-section';
import { UsersSection } from '@/components/admin/users-section';
import { ADMIN_TABS, type AdminTab, parseAdminTab } from '@/lib/admin';
import { cn } from '@/lib/utils';
import { useAdminBadge } from '@/lib/hooks/use-admin';
import { useAIStatus } from '@/lib/hooks/use-ai-access';

function TabPills({ active, onSelect }: { active: AdminTab; onSelect: (tab: AdminTab) => void }) {
  const t = useTranslations('admin.tabs');
  const { data: badge } = useAdminBadge();
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
      <div role="tablist" aria-label={t('label')} className="flex w-max gap-2">
        {ADMIN_TABS.map((tab) => {
          const selected = tab === active;
          return (
            <button
              key={tab}
              id={`admin-tab-${tab}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`admin-panel-${tab}`}
              onClick={() => onSelect(tab)}
              className={cn(
                'inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-4 text-[15px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selected
                  ? 'bg-signature font-bold text-signature-foreground'
                  : 'bg-panel font-medium text-foreground hover:bg-accent'
              )}
            >
              {t(tab)}
              {tab === 'inbox' && badge?.feedback_new ? (
                <span className="rounded-full bg-foreground px-1.5 text-[11px] font-bold leading-5 text-background">
                  {badge.feedback_new}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function AdminPage() {
  const t = useTranslations('admin');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = parseAdminTab(searchParams.get('tab'));
  const { data: aiStatus, isLoading: statusLoading } = useAIStatus();
  const isAdmin = Boolean(aiStatus?.is_admin);

  const select = (next: AdminTab) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'summary') params.delete('tab');
    else params.set('tab', next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  if (statusLoading) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 py-2 sm:py-4">
        <Skeleton className="h-9 w-48 rounded-full" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <EmptyState
        state="sad"
        title={t('forbiddenTitle')}
        description={t('forbiddenBody')}
        action={
          <Button asChild>
            <Link href="/dashboard">{t('backHome')}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 py-2 sm:py-4">
      <PageHeader title={t('panelTitle')} description={t('panelSubtitle')} />
      <TabPills active={tab} onSelect={select} />
      <div role="tabpanel" id={`admin-panel-${tab}`} aria-labelledby={`admin-tab-${tab}`}>
        {tab === 'summary' && <OverviewSection />}
        {tab === 'users' && <UsersSection />}
        {tab === 'signup' && <SignupSection />}
        {tab === 'inbox' && <InboxSection />}
        {tab === 'system' && <SystemSection />}
      </div>
    </div>
  );
}
