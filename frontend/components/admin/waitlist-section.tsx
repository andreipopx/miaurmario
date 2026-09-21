'use client';

import { useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { PillGroup, SectionCard, useAdminErrorMessage } from '@/components/admin/shared';
import type { WaitlistItem, WaitlistStatus } from '@/lib/admin';
import { useDecideWaitlist, useWaitlist } from '@/lib/hooks/use-admin';

function WaitlistRow({
  item,
  selectable,
  selected,
  onToggle,
}: {
  item: WaitlistItem;
  selectable: boolean;
  selected: boolean;
  onToggle: (id: string) => void;
}) {
  const t = useTranslations('admin.signup.waitlist');
  const format = useFormatter();
  const checkboxId = `wl-${item.id}`;
  return (
    <li className="flex gap-3 rounded-quick bg-panel p-3">
      {selectable && (
        <Checkbox
          id={checkboxId}
          checked={selected}
          onCheckedChange={() => onToggle(item.id)}
          className="mt-0.5 bg-background"
          aria-label={t('select', { email: item.email })}
        />
      )}
      <div className="min-w-0 flex-1">
        <label htmlFor={selectable ? checkboxId : undefined} className="block min-w-0">
          <span className="block truncate font-semibold">{item.name || item.email}</span>
          {item.name && <span className="block truncate text-sm text-muted-foreground">{item.email}</span>}
        </label>
        {item.message && <p className="mt-1 break-words text-sm">“{item.message}”</p>}
        <p className="mt-1 text-xs text-muted-foreground">
          {t('requestedOn', { date: format.dateTime(new Date(item.created_at), { dateStyle: 'medium' }) })}
          {' · '}
          {item.locale.toUpperCase()}
          {item.invite_code && (
            <>
              {' · '}
              <code className="font-mono">{item.invite_code}</code>
            </>
          )}
        </p>
      </div>
    </li>
  );
}

/** Closed-beta waitlist: approve (single-use invite for that email + email) or reject, in bulk. */
export function WaitlistSection() {
  const t = useTranslations('admin.signup.waitlist');
  const errorMessage = useAdminErrorMessage();
  const [status, setStatus] = useState<WaitlistStatus>('pending');
  const { data, isLoading } = useWaitlist(status, true);
  const decide = useDecideWaitlist();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const items = useMemo(() => data?.items ?? [], [data]);
  const pendingIds = status === 'pending' ? items.map((i) => i.id) : [];
  const chosen = pendingIds.filter((id) => selected.has(id));
  const allChosen = pendingIds.length > 0 && chosen.length === pendingIds.length;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = async (action: 'approve' | 'reject', ids: string[]) => {
    if (!ids.length) return;
    try {
      const res = await decide.mutateAsync({ ids, action });
      setSelected(new Set());
      if (action === 'approve') {
        toast.success(t('approvedToast', { count: res.approved }));
        if (res.emails_failed) toast.error(t('emailsFailed', { count: res.emails_failed }));
      } else {
        toast.success(t('rejectedToast', { count: res.rejected }));
      }
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <SectionCard
      title={
        <span className="inline-flex items-center gap-2">
          {t('title')}
          {data?.pending_count ? <Badge variant="signature">{data.pending_count}</Badge> : null}
        </span>
      }
      description={t('description')}
    >
      <PillGroup<WaitlistStatus>
        label={t('title')}
        value={status}
        onChange={(v) => {
          setStatus(v);
          setSelected(new Set());
        }}
        options={[
          { value: 'pending', label: t('pending') },
          { value: 'approved', label: t('approved') },
          { value: 'rejected', label: t('rejected') },
        ]}
      />

      {status === 'pending' && pendingIds.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="mr-auto inline-flex min-h-[44px] items-center gap-2 text-sm font-medium">
            <Checkbox
              checked={allChosen}
              onCheckedChange={() => setSelected(allChosen ? new Set() : new Set(pendingIds))}
            />
            {t('selectAll')}
          </label>
          <Button
            size="sm"
            variant="signature"
            disabled={!chosen.length || decide.isPending}
            onClick={() => run('approve', chosen)}
          >
            <Check className="h-4 w-4" aria-hidden />
            {t('approveSelected', { count: chosen.length })}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="bg-background"
            disabled={!chosen.length || decide.isPending}
            onClick={() => run('reject', chosen)}
          >
            <X className="h-4 w-4" aria-hidden />
            {t('rejectSelected', { count: chosen.length })}
          </Button>
        </div>
      )}

      <div className="mt-3">
        {isLoading ? (
          <Skeleton className="h-20 w-full rounded-quick" />
        ) : !items.length ? (
          <p className="text-sm text-muted-foreground">{t(status === 'pending' ? 'empty' : 'emptyDecided')}</p>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => (
              <WaitlistRow
                key={item.id}
                item={item}
                selectable={status === 'pending'}
                selected={selected.has(item.id)}
                onToggle={toggle}
              />
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}
