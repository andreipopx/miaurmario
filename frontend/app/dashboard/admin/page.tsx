'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Search, ShieldAlert } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
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
    <Card className={user.is_active ? undefined : 'opacity-60'}>
      <CardContent className="p-4 space-y-4">
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
            <Badge variant="outline">{t(`access.${user.effective_ai_access}`)}</Badge>
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
                className="w-32"
                aria-invalid={capValue === 'invalid'}
              />
            </div>
            <Button
              size="sm"
              variant="outline"
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
          <div className="flex items-center gap-3 border-t border-border pt-3">
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
      <div className="mx-auto max-w-4xl px-4 py-10 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center space-y-4">
        <ShieldAlert className="mx-auto h-10 w-10 text-muted-foreground" />
        <h1 className="text-2xl font-bold">{t('forbiddenTitle')}</h1>
        <p className="text-muted-foreground">{t('forbiddenBody')}</p>
        <Button variant="outline" asChild>
          <Link href="/dashboard">{t('backHome')}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-10 py-8 sm:py-12 space-y-6">
      <header className="space-y-2">
        <Link
          href="/dashboard/settings/ai"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          {t('back')}
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">{t('subtitle')}</p>
      </header>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('searchPlaceholder')}
          className="pl-9"
          aria-label={t('searchPlaceholder')}
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">{getErrorMessage(error, t('loadError'))}</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t('total', { count: data?.total ?? 0 })}</p>
          {data?.users.map((user) => <UserCard key={user.id} user={user} />)}
        </div>
      )}
    </div>
  );
}
