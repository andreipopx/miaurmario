'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Search } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import type { AdminUser } from '@/lib/ai-access';
import { getApiErrorCode } from '@/lib/ai-access';
import { getErrorMessage } from '@/lib/api';
import { useAdminUsers, useAIStatus, useUpdateAdminUser } from '@/lib/hooks/use-ai-access';

function parseCap(value: string): number | null | 'invalid' {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return 'invalid';
  return Number(trimmed);
}

function UserCard({ user }: { user: AdminUser }) {
  const t = useTranslations('admin');
  const format = useFormatter();
  const updateUser = useUpdateAdminUser();
  const [cap, setCap] = useState(user.monthly_request_cap?.toString() ?? '');

  useEffect(() => {
    setCap(user.monthly_request_cap?.toString() ?? '');
  }, [user.monthly_request_cap]);

  const run = async (data: Parameters<typeof updateUser.mutateAsync>[0]['data']) => {
    try {
      await updateUser.mutateAsync({ id: user.id, data });
      toast.success(t('saved'));
    } catch (e) {
      const code = getApiErrorCode(e);
      toast.error(code && t.has(`errors.${code}`) ? t(`errors.${code}`) : getErrorMessage(e, t('saveError')));
    }
  };

  const grantsPlatform = user.effective_ai_access === 'platform';
  const capValue = parseCap(cap);
  const capChanged = capValue !== 'invalid' && capValue !== user.monthly_request_cap;

  const date = (value: string | null) =>
    value ? format.dateTime(new Date(value), { dateStyle: 'medium' }) : t('never');

  return (
    <Card className={user.is_active ? 'border-0 bg-panel' : 'border-0 bg-panel opacity-60'}>
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold truncate">
              {user.display_name}
              {user.username && (
                <span className="text-muted-foreground font-normal"> @{user.username}</span>
              )}
            </p>
            <p className="text-sm text-muted-foreground break-all">{user.email}</p>
          </div>
          <div className="flex flex-wrap gap-1">
            {user.is_admin && <Badge>{t('badges.admin')}</Badge>}
            <Badge
              variant={
                user.effective_ai_access === 'platform'
                  ? 'signature'
                  : user.effective_ai_access === 'byok'
                    ? 'sky'
                    : 'outline'
              }
            >
              {t(`access.${user.effective_ai_access}`)}
            </Badge>
            {!user.is_active && <Badge variant="outline">{t('badges.inactive')}</Badge>}
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">{t('fields.items')}</dt>
            <dd className="font-medium">{user.item_count}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('fields.usage')}</dt>
            <dd className="font-medium">
              {user.monthly_request_cap != null
                ? t('usageWithCap', {
                    requests: user.requests_this_month,
                    cap: user.monthly_request_cap,
                  })
                : t('usage', { requests: user.requests_this_month })}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('fields.created')}</dt>
            <dd className="font-medium">{date(user.created_at)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('fields.lastLogin')}</dt>
            <dd className="font-medium">{date(user.last_login_at)}</dd>
          </div>
        </dl>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-center gap-3">
            <Switch
              id={`grant-${user.id}`}
              checked={grantsPlatform}
              disabled={user.is_admin || updateUser.isPending}
              onCheckedChange={(checked) => run({ ai_access: checked ? 'platform' : 'none' })}
            />
            <Label htmlFor={`grant-${user.id}`} className="text-sm">
              {user.is_admin
                ? t('grantAdmin')
                : user.ai_access === 'byok'
                  ? t('grantByok')
                  : t('grant')}
            </Label>
          </div>

          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor={`cap-${user.id}`} className="text-xs text-muted-foreground">
                {t('fields.cap')}
              </Label>
              <Input
                id={`cap-${user.id}`}
                inputMode="numeric"
                value={cap}
                onChange={(e) => setCap(e.target.value)}
                placeholder={t('capPlaceholder')}
                className="h-9 w-32 bg-background"
                aria-invalid={capValue === 'invalid'}
              />
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={!capChanged || updateUser.isPending}
              onClick={() =>
                capValue !== 'invalid' && run({ monthly_request_cap: capValue })
              }
            >
              {t('saveCap')}
            </Button>
          </div>
        </div>

        {!user.is_admin && (
          <div className="flex items-center gap-3 border-t border-border pt-4">
            <Switch
              id={`active-${user.id}`}
              checked={user.is_active}
              disabled={updateUser.isPending}
              onCheckedChange={(checked) => run({ is_active: checked })}
            />
            <Label htmlFor={`active-${user.id}`} className="text-sm">
              {t('active')}
            </Label>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminPage() {
  const t = useTranslations('admin');
  const { data: aiStatus, isLoading: statusLoading } = useAIStatus();
  const isAdmin = Boolean(aiStatus?.is_admin);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  const { data, isLoading, error } = useAdminUsers(debounced, isAdmin);

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
    <div className="mx-auto max-w-4xl space-y-6 py-2 sm:py-4">
      <Button variant="ghost" asChild className="-ml-3 text-muted-foreground hover:text-foreground">
        <Link href="/dashboard/settings/ai">{t('back')}</Link>
      </Button>

      <PageHeader title={t('title')} description={t('subtitle')} />

      <div className="relative">
        <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.75} aria-hidden />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('searchPlaceholder')}
          className="border-transparent bg-panel pl-10"
          aria-label={t('searchPlaceholder')}
        />
      </div>

      {isLoading ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-40 w-full rounded-lg" />
          <Skeleton className="h-40 w-full rounded-lg" />
        </div>
      ) : error ? (
        <EmptyState state="sad" title={getErrorMessage(error, t('loadError'))} />
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t('total', { count: data?.total ?? 0 })}</p>
          {data?.users.map((user) => <UserCard key={user.id} user={user} />)}
        </div>
      )}
    </div>
  );
}
