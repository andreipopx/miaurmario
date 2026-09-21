'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ImageIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Chip } from '@/components/chip';
import { EmptyState } from '@/components/empty-state';
import { PillGroup, useAdminErrorMessage } from '@/components/admin/shared';
import type { FeedbackItem, FeedbackStatus } from '@/lib/admin';
import { getErrorMessage } from '@/lib/api';
import { useAdminFeedback, useFeedbackScreenshot, useUpdateFeedback } from '@/lib/hooks/use-admin';

const KIND_VARIANT = { suggestion: 'sky', bug: 'signature', other: 'secondary' } as const;
const FILTERS: (FeedbackStatus | 'all')[] = ['new', 'seen', 'done', 'all'];

function Screenshot({ id }: { id: string }) {
  const t = useTranslations('admin.inbox');
  const url = useFeedbackScreenshot(id);
  const [open, setOpen] = useState(false);
  if (!url) {
    return (
      <div className="flex h-24 w-24 items-center justify-center rounded-tile bg-panel text-muted-foreground">
        <ImageIcon className="h-5 w-5" aria-hidden />
      </div>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="overflow-hidden rounded-tile focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={t('openScreenshot')}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="" className="h-24 w-24 object-cover" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl p-3">
          <DialogTitle className="sr-only">{t('screenshot')}</DialogTitle>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={t('screenshot')} className="max-h-[80dvh] w-full rounded-md object-contain" />
        </DialogContent>
      </Dialog>
    </>
  );
}

function FeedbackCard({ item }: { item: FeedbackItem }) {
  const t = useTranslations('admin.inbox');
  const format = useFormatter();
  const errorMessage = useAdminErrorMessage();
  const update = useUpdateFeedback();
  const [note, setNote] = useState(item.admin_note ?? '');

  useEffect(() => setNote(item.admin_note ?? ''), [item.admin_note]);

  const save = async (data: { status?: FeedbackStatus; admin_note?: string | null }, ok?: string) => {
    try {
      await update.mutateAsync({ id: item.id, ...data });
      if (ok) toast.success(ok);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <li className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={KIND_VARIANT[item.kind]}>{t(`kind.${item.kind}`)}</Badge>
        {item.status === 'new' && <Badge variant="amber">{t('status.new')}</Badge>}
        <span className="text-[13px] text-muted-foreground">
          {item.username ? `@${item.username}` : item.display_name} ·{' '}
          {format.dateTime(new Date(item.created_at), { dateStyle: 'medium', timeStyle: 'short' })}
        </span>
      </div>
      <div className="mt-3 flex gap-3">
        <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[15px]">{item.text}</p>
        {item.has_screenshot && <Screenshot id={item.id} />}
      </div>
      <details className="mt-3 text-[13px] text-muted-foreground">
        <summary className="cursor-pointer font-semibold">{t('context')}</summary>
        <dl className="mt-2 space-y-1 break-all">
          <div><dt className="inline font-semibold">{t('page')}: </dt><dd className="inline">{item.page_url || '—'}</dd></div>
          <div><dt className="inline font-semibold">{t('build')}: </dt><dd className="inline">{item.build_id || '—'}</dd></div>
          <div><dt className="inline font-semibold">{t('userAgent')}: </dt><dd className="inline">{item.user_agent || '—'}</dd></div>
        </dl>
      </details>
      <div className="mt-3 space-y-2 border-t border-border pt-3">
        <PillGroup<FeedbackStatus>
          label={t('statusLabel')}
          value={item.status}
          disabled={update.isPending}
          onChange={(status) => save({ status })}
          options={(['new', 'seen', 'done'] as const).map((s) => ({ value: s, label: t(`status.${s}`) }))}
        />
        <label htmlFor={`note-${item.id}`} className="block text-[13px] font-semibold">
          {t('note')}
        </label>
        <Textarea
          id={`note-${item.id}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('notePlaceholder')}
          rows={2}
          maxLength={5000}
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={update.isPending || note === (item.admin_note ?? '')}
          onClick={() => save({ admin_note: note.trim() || null }, t('noteSaved'))}
        >
          {t('saveNote')}
        </Button>
      </div>
    </li>
  );
}

export function InboxSection() {
  const t = useTranslations('admin.inbox');
  const [filter, setFilter] = useState<FeedbackStatus | 'all'>('new');
  const { data, isLoading, error } = useAdminFeedback(filter, true);

  return (
    <div className="space-y-4">
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {FILTERS.map((f) => (
          <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>
            {t(`filters.${f}`)}
            {f === 'new' && data?.new_count ? ` (${data.new_count})` : ''}
          </Chip>
        ))}
      </div>
      {isLoading ? (
        <Skeleton className="h-40 w-full rounded-lg" />
      ) : error ? (
        <EmptyState state="sad" title={getErrorMessage(error, t('loadError'))} />
      ) : !data?.items.length ? (
        <EmptyState state="sleepy" title={t('emptyTitle')} description={t('emptyBody')} />
      ) : (
        <ul className="space-y-3">
          {data.items.map((item) => (
            <FeedbackCard key={item.id} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}
