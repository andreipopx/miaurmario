'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { CheckCircle2, CircleSlash, Megaphone, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/empty-state';
import { PillGroup, SectionCard, useAdminErrorMessage } from '@/components/admin/shared';
import { type AnnouncementLevel, type SystemStatus, formatBytes, toDateTimeLocal } from '@/lib/admin';
import { getErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  useAdminAnnouncement,
  useAuditLog,
  useClearAnnouncement,
  useSaveAnnouncement,
  useSystemStatus,
} from '@/lib/hooks/use-admin';

type Tone = 'ok' | 'bad' | 'off';

function StatusRow({ label, tone, children }: { label: string; tone: Tone; children: React.ReactNode }) {
  const Icon = tone === 'ok' ? CheckCircle2 : tone === 'bad' ? XCircle : CircleSlash;
  return (
    <li className="flex items-start gap-3 py-2.5">
      <Icon
        className={cn(
          'mt-0.5 h-5 w-5 shrink-0',
          tone === 'ok' ? 'text-success' : tone === 'bad' ? 'text-destructive' : 'text-muted-foreground'
        )}
        strokeWidth={1.75}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{label}</p>
        <div className="break-words text-[13px] text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}

function backupSummary(backup: SystemStatus['backup']): Record<string, string> {
  if (!backup.configured || !backup.ok) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(backup.data)) {
    if (v == null || typeof v === 'object') continue;
    out[k] = String(v);
  }
  return out;
}

function AnnouncementEditor() {
  const t = useTranslations('admin.system.announcement');
  const errorMessage = useAdminErrorMessage();
  const { data } = useAdminAnnouncement(true);
  const save = useSaveAnnouncement();
  const clear = useClearAnnouncement();
  const current = data?.announcement ?? null;
  const [text, setText] = useState('');
  const [level, setLevel] = useState<AnnouncementLevel>('info');
  const [expires, setExpires] = useState('');

  useEffect(() => {
    setText(current?.text ?? '');
    setLevel(current?.level ?? 'info');
    setExpires(toDateTimeLocal(current?.expires_at));
  }, [current?.id, current?.text, current?.level, current?.expires_at]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await save.mutateAsync({
        text: text.trim(),
        level,
        expires_at: expires ? new Date(expires).toISOString() : null,
      });
      toast.success(t('saved'));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <SectionCard
      title={
        <span className="flex items-center gap-2">
          <Megaphone className="h-5 w-5" strokeWidth={1.75} aria-hidden />
          {t('title')}
        </span>
      }
      description={t('description')}
    >
      <form onSubmit={submit} className="space-y-3">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          rows={2}
          placeholder={t('placeholder')}
          aria-label={t('text')}
        />
        <div className="flex flex-wrap items-end gap-3">
          <PillGroup<AnnouncementLevel>
            label={t('level')}
            value={level}
            onChange={setLevel}
            options={[
              { value: 'info', label: t('info') },
              { value: 'warning', label: t('warning') },
            ]}
          />
          <div className="space-y-1">
            <Label htmlFor="announcement-expires" className="text-[13px]">{t('expires')}</Label>
            <Input
              id="announcement-expires"
              type="datetime-local"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
              className="h-11 w-auto"
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={!text.trim() || save.isPending}>
            {current ? t('update') : t('publish')}
          </Button>
          {current && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={clear.isPending}
              onClick={() =>
                clear
                  .mutateAsync(undefined)
                  .then(() => toast.success(t('cleared')))
                  .catch((err) => toast.error(errorMessage(err)))
              }
            >
              {t('clear')}
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{current ? t('live') : t('none')}</p>
      </form>
    </SectionCard>
  );
}

function AuditLog() {
  const t = useTranslations('admin.system.audit');
  const format = useFormatter();
  const { data } = useAuditLog(true);
  return (
    <SectionCard title={t('title')} description={t('description')}>
      {!data?.length ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {data.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2">
              <span className="min-w-0">
                <span className="font-semibold">{t.has(`actions.${e.action}`) ? t(`actions.${e.action}`) : e.action}</span>
                {e.admin_username && <span className="text-muted-foreground"> · @{e.admin_username}</span>}
              </span>
              <span className="text-[13px] tabular-nums text-muted-foreground">
                {format.dateTime(new Date(e.created_at), { dateStyle: 'short', timeStyle: 'short' })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

export function SystemSection() {
  const t = useTranslations('admin.system');
  const format = useFormatter();
  const locale = useLocale();
  const { data, isLoading, error } = useSystemStatus(true);

  return (
    <div className="space-y-4">
      <AnnouncementEditor />

      <SectionCard title={t('statusTitle')}>
        {isLoading ? (
          <Skeleton className="h-48 w-full rounded-quick" />
        ) : error || !data ? (
          <EmptyState state="sad" title={getErrorMessage(error, t('loadError'))} />
        ) : (
          <ul className="divide-y divide-border">
            <StatusRow
              label={t('backup')}
              tone={!data.backup.configured ? 'off' : data.backup.ok ? 'ok' : 'bad'}
            >
              {!data.backup.configured
                ? t('notConfigured')
                : !data.backup.ok
                  ? t('backupError', { error: data.backup.error })
                  : Object.entries(backupSummary(data.backup))
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(' · ') || t('backupOk')}
            </StatusRow>
            <StatusRow label={t('uploads')} tone={data.uploads.available ? 'ok' : 'bad'}>
              {data.uploads.available
                ? t('uploadsValue', {
                    size: formatBytes(data.uploads.bytes, locale),
                    files: data.uploads.files,
                    at: format.dateTime(new Date(data.uploads.computed_at), { timeStyle: 'short' }),
                  })
                : t('uploadsMissing')}
            </StatusRow>
            <StatusRow label={t('database')} tone="ok">
              {formatBytes(data.database.bytes, locale)}
            </StatusRow>
            <StatusRow label={t('version')} tone={data.version.app_version || data.version.git_sha ? 'ok' : 'off'}>
              {[data.version.app_version, data.version.git_sha?.slice(0, 7)].filter(Boolean).join(' · ') ||
                t('notConfigured')}
            </StatusRow>
            <StatusRow label={t('worker')} tone={data.worker.alive ? 'ok' : 'bad'}>
              {!data.worker.reachable
                ? t('redisDown')
                : data.worker.alive
                  ? t('workerAlive', { queued: data.worker.queued ?? 0 })
                  : t('workerDown', { queued: data.worker.queued ?? 0 })}
              {data.worker.last_heartbeat && (
                <span className="block font-mono text-[11px]">{data.worker.last_heartbeat}</span>
              )}
            </StatusRow>
            <StatusRow
              label={t('spotify')}
              tone={
                !data.spotify.configured
                  ? 'off'
                  : data.spotify.connected_users >= data.spotify.dev_mode_slots
                    ? 'bad'
                    : 'ok'
              }
            >
              {data.spotify.configured
                ? t('spotifySlots', { used: data.spotify.connected_users, total: data.spotify.dev_mode_slots })
                : t('notConfigured')}
            </StatusRow>
            {data.lastfm && (
              <StatusRow label={t('lastfm')} tone={data.lastfm.configured ? 'ok' : 'off'}>
                {data.lastfm.configured
                  ? t('lastfmUsers', { count: data.lastfm.connected_users })
                  : t('notConfigured')}
              </StatusRow>
            )}
            <StatusRow label={t('pinterest')} tone={data.pinterest.configured ? 'ok' : 'off'}>
              {data.pinterest.configured ? t('configured') : t('notConfigured')}
            </StatusRow>
          </ul>
        )}
      </SectionCard>

      <AuditLog />
    </div>
  );
}
