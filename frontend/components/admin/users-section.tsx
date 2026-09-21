'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ChevronRight, Search, ShieldAlert } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/empty-state';
import { SectionCard, useAdminErrorMessage } from '@/components/admin/shared';
import { UserDetailDialog } from '@/components/admin/user-detail-dialog';
import { getErrorMessage } from '@/lib/api';
import { useAdminDeletions, useRetryDeletion } from '@/lib/hooks/use-admin';
import { useAdminUsers } from '@/lib/hooks/use-ai-access';

function Deletions() {
  const t = useTranslations('admin.users.deletions');
  const format = useFormatter();
  const errorMessage = useAdminErrorMessage();
  const { data } = useAdminDeletions(true);
  const retry = useRetryDeletion();
  if (!data || data.length === 0) return null;
  return (
    <SectionCard title={t('title')} description={t('description')}>
      <ul className="divide-y divide-border text-sm">
        {data.slice(0, 10).map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="min-w-0">
              <span className="font-semibold">{d.username ? `@${d.username}` : t('noUsername')}</span>
              <span className="text-muted-foreground">
                {' · '}
                {format.dateTime(new Date(d.requested_at), { dateStyle: 'medium', timeStyle: 'short' })}
              </span>
            </span>
            <span className="flex items-center gap-2">
              <Badge variant={d.status === 'done' ? 'mint' : d.status === 'failed' ? 'destructive' : 'amber'}>
                {t(`status.${d.status}`)}
              </Badge>
              {d.status === 'failed' && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={retry.isPending}
                  onClick={() => retry.mutateAsync(d.id).catch((e) => toast.error(errorMessage(e)))}
                >
                  {t('retry')}
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

export function UsersSection() {
  const t = useTranslations('admin');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  const { data, isLoading, error } = useAdminUsers(debounced, true);

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 rounded-quick bg-signature-soft p-3 text-[13px] font-medium">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
        {t('users.privacy')}
      </p>

      <div className="relative">
        <Search
          className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          strokeWidth={1.75}
          aria-hidden
        />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('searchPlaceholder')}
          className="border-transparent bg-panel pl-10"
          aria-label={t('searchPlaceholder')}
        />
      </div>

      {isLoading ? (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-quick" />
          ))}
        </div>
      ) : error ? (
        <EmptyState state="sad" title={getErrorMessage(error, t('loadError'))} />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{t('total', { count: data?.total ?? 0 })}</p>
          <ul className="space-y-2">
            {data?.users.map((user) => (
              <li key={user.id}>
                <button
                  type="button"
                  onClick={() => setSelected(user.id)}
                  className="flex min-h-[64px] w-full items-center gap-3 rounded-quick bg-panel px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="min-w-0 flex-1">
                    <span className={user.is_active ? 'block truncate font-semibold' : 'block truncate font-semibold opacity-60'}>
                      {user.display_name}
                      {user.username && <span className="font-normal text-muted-foreground"> @{user.username}</span>}
                    </span>
                    <span className="block truncate text-[13px] text-muted-foreground">
                      {t('users.rowSummary', { items: user.item_count, requests: user.requests_this_month })}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-wrap justify-end gap-1">
                    {user.is_admin && <Badge>{t('badges.admin')}</Badge>}
                    {user.effective_ai_access !== 'none' && (
                      <Badge variant={user.effective_ai_access === 'platform' ? 'signature' : 'sky'}>
                        {t(`access.${user.effective_ai_access}`)}
                      </Badge>
                    )}
                    {!user.is_active && <Badge variant="outline">{t('badges.inactive')}</Badge>}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <Deletions />
      <UserDetailDialog userId={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
