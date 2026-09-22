'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Bell,
  Plus,
  Trash2,
  Send,
  Clock,
  Loader2,
  Settings2,
  Calendar,
  ChevronDown,
  Mail,
  MessageSquare,
  Smartphone,
} from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { DefaultChannelsCard } from '@/components/notifications/default-channels';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useNotificationSettings,
  useCreateNotificationSetting,
  useUpdateNotificationSetting,
  useDeleteNotificationSetting,
  useTestNotificationSetting,
  useSchedules,
  useCreateSchedule,
  useUpdateSchedule,
  useDeleteSchedule,
  NotificationSettings,
  Schedule,
} from '@/lib/hooks/use-notifications';
import { useUserProfile } from '@/lib/hooks/use-user';
import { OCCASIONS } from '@/lib/types';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { cn } from '@/lib/utils';

const DAYS = [
  { value: 0, labelKey: 'monday' as const },
  { value: 1, labelKey: 'tuesday' as const },
  { value: 2, labelKey: 'wednesday' as const },
  { value: 3, labelKey: 'thursday' as const },
  { value: 4, labelKey: 'friday' as const },
  { value: 5, labelKey: 'saturday' as const },
  { value: 6, labelKey: 'sunday' as const },
];

const CHANNEL_ICONS: Record<string, React.ReactNode> = {
  ntfy: <Bell className="h-5 w-5" strokeWidth={1.75} />,
  mattermost: <MessageSquare className="h-5 w-5" strokeWidth={1.75} />,
  email: <Mail className="h-5 w-5" strokeWidth={1.75} />,
};

/** Pop colour per channel (ink icon on top). */
const CHANNEL_BG: Record<string, string> = {
  ntfy: 'bg-pop-amber',
  mattermost: 'bg-pop-sky',
  email: 'bg-pop-mint',
};

function ChannelCard({
  setting,
  onTest,
  onToggle,
  onDelete,
  testing,
}: {
  setting: NotificationSettings;
  onTest: () => void;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
  testing: boolean;
}) {
  const t = useTranslations('notifications');
  const tLabels = useTranslations('notifications.channelLabels');
  const tSummary = useTranslations('notifications.channelSummary');
  const tCommon = useTranslations('common');
  return (
    <div className="rounded-lg bg-panel p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div
            aria-hidden
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-pop-foreground',
              CHANNEL_BG[setting.channel] ?? 'bg-signature'
            )}
          >
            {CHANNEL_ICONS[setting.channel]}
          </div>
          <div className="min-w-0">
            <p className="font-bold">{tLabels(setting.channel)}</p>
            <p className="truncate text-sm text-muted-foreground">
              {setting.channel === 'ntfy' && setting.config.topic}
              {setting.channel === 'mattermost' && tSummary('mattermostConfigured')}
              {setting.channel === 'email' && setting.config.address}
            </p>
          </div>
        </div>
        <Switch
          checked={setting.enabled}
          onCheckedChange={onToggle}
          aria-label={tLabels(setting.channel)}
        />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-11 sm:h-9"
          onClick={onTest}
          disabled={testing || !setting.enabled}
        >
          {testing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" strokeWidth={1.75} />
          )}
          {t('testButton')}
        </Button>
        <Badge variant="outline">{t('priority', { n: setting.priority })}</Badge>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto text-destructive hover:bg-background hover:text-destructive"
          onClick={onDelete}
          aria-label={tCommon('delete')}
        >
          <Trash2 className="h-4 w-4" strokeWidth={1.75} />
        </Button>
      </div>
    </div>
  );
}

interface ChannelFormData {
  channel: 'ntfy' | 'mattermost' | 'email';
  enabled: boolean;
  priority: number;
  config: Record<string, string>;
}

function AddChannelDialog({
  onAdd,
  isLoading,
  onSuccess,
  userEmail,
}: {
  onAdd: (data: ChannelFormData) => Promise<void>;
  isLoading: boolean;
  onSuccess?: () => void;
  userEmail?: string;
}) {
  const t = useTranslations('notifications.addChannel');
  const tValidation = useTranslations('notifications.validation');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<'ntfy' | 'mattermost' | 'email'>('ntfy');
  const [config, setConfig] = useState<Record<string, string>>({});
  const [ntfyDefaults, setNtfyDefaults] = useState<{ server: string; token: string } | null>(null);

  // Fetch ntfy defaults when dialog opens
  useEffect(() => {
    if (open && !ntfyDefaults) {
      fetch('/api/v1/notifications/defaults/ntfy')
        .then((res) => res.json())
        .then((data) => {
          setNtfyDefaults(data);
          // Pre-fill server and token if ntfy is selected (user only sets topic)
          if (channel === 'ntfy' && !config.server) {
            setConfig({ server: data.server, token: data.token || '' });
          }
        })
        .catch(() => {
          // Fallback defaults
          setNtfyDefaults({ server: 'https://ntfy.sh', token: '' });
        });
    }
  }, [open, ntfyDefaults, channel, config.server]);

  // Reset config when channel changes, pre-fill defaults per channel type
  useEffect(() => {
    if (channel === 'ntfy' && ntfyDefaults) {
      setConfig({ server: ntfyDefaults.server, token: ntfyDefaults.token });
    } else if (channel === 'email') {
      setConfig(userEmail ? { address: userEmail } : {});
    } else {
      setConfig({});
    }
  }, [channel, ntfyDefaults, userEmail]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Frontend validation
    if (channel === 'ntfy' && !config.topic?.trim()) {
      toast.error(tValidation('topicRequired'));
      return;
    }
    if (channel === 'mattermost' && !config.webhook_url?.trim()) {
      toast.error(tValidation('webhookRequired'));
      return;
    }
    if (channel === 'email' && !config.address?.trim()) {
      toast.error(tValidation('emailRequired'));
      return;
    }

    try {
      await onAdd({
        channel,
        enabled: true,
        priority: 1,
        config,
      });
      // Close and reset on success
      setOpen(false);
      setConfig({});
      setChannel('ntfy');
      onSuccess?.();
    } catch {
      // Error handled by parent via toast
    }
  };

  const closeAndReset = () => {
    setOpen(false);
    setConfig({});
    setChannel('ntfy');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="signature">
          <Plus className="h-4 w-4" strokeWidth={1.75} />
          {t('buttonLabel')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t('dialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('dialogDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t('channelType')}</Label>
              <Select
                value={channel}
                onValueChange={(v: 'ntfy' | 'mattermost' | 'email') => {
                  setChannel(v);
                  setConfig({});
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ntfy">{t('ntfyOption')}</SelectItem>
                  <SelectItem value="mattermost">{t('mattermostOption')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {channel === 'ntfy' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="server">{t('serverUrl')}</Label>
                  <Input
                    id="server"
                    value={config.server || 'https://ntfy.sh'}
                    onChange={(e) => setConfig({ ...config, server: e.target.value })}
                    placeholder="https://ntfy.sh"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="topic">{t('topic')}</Label>
                  <Input
                    id="topic"
                    value={config.topic || ''}
                    onChange={(e) => setConfig({ ...config, topic: e.target.value })}
                    placeholder={t('topicPlaceholder')}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('topicHelp')}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="token">{t('token')}</Label>
                  <Input
                    id="token"
                    type="password"
                    value={config.token || ''}
                    onChange={(e) => setConfig({ ...config, token: e.target.value })}
                    placeholder="tk_..."
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('tokenHelp')}
                  </p>
                </div>
              </>
            )}

            {channel === 'mattermost' && (
              <div className="space-y-2">
                <Label htmlFor="webhook">{t('webhookUrl')}</Label>
                <Input
                  id="webhook"
                  value={config.webhook_url || ''}
                  onChange={(e) => setConfig({ ...config, webhook_url: e.target.value })}
                  placeholder={t('webhookPlaceholder')}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  {t('webhookHelp')}
                </p>
              </div>
            )}

            {channel === 'email' && (
              <div className="space-y-2">
                <Label htmlFor="email">{t('emailAddress')}</Label>
                <Input
                  id="email"
                  type="email"
                  value={config.address || ''}
                  onChange={(e) => setConfig({ ...config, address: e.target.value })}
                  placeholder={t('emailPlaceholder')}
                  required
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeAndReset} disabled={isLoading}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('adding')}
                </>
              ) : (
                t('buttonLabel')
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ScheduleCard({
  schedule,
  onToggle,
  onToggleDayBefore,
  onDelete,
}: {
  schedule: Schedule;
  onToggle: (enabled: boolean) => void;
  onToggleDayBefore: (notify_day_before: boolean) => void;
  onDelete: () => void;
}) {
  const t = useTranslations('notifications.scheduleCard');
  const tDays = useTranslations('dashboard.days');
  const tCommon = useTranslations('common');
  const day = DAYS.find((d) => d.value === schedule.day_of_week);
  const occasion = OCCASIONS.find((o) => o.value === schedule.occasion);

  // Calculate which day the notification actually comes
  const notifyDay = schedule.notify_day_before
    ? DAYS[(schedule.day_of_week + 6) % 7] // Previous day
    : day;

  return (
    <div className="space-y-3 rounded-lg bg-panel p-4">
      {/* Top row: Day info and main toggle */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-pop-sky text-pop-foreground">
            <Calendar className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <div className="min-w-0">
            <p className="font-bold">{day ? tDays(day.labelKey) : ''}</p>
            <p className="text-sm text-muted-foreground">
              {schedule.notification_time} - {occasion?.label || schedule.occasion}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={schedule.enabled}
            onCheckedChange={onToggle}
            aria-label={day ? tDays(day.labelKey) : undefined}
          />
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:bg-background hover:text-destructive"
            onClick={onDelete}
            aria-label={tCommon('delete')}
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.75} />
          </Button>
        </div>
      </div>
      {/* Bottom row: Day before toggle */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <div className="flex items-center gap-2">
          <Switch
            id={`daybefore-${schedule.id}`}
            checked={schedule.notify_day_before}
            onCheckedChange={onToggleDayBefore}
          />
          <Label htmlFor={`daybefore-${schedule.id}`} className="cursor-pointer text-sm">
            {t('notifyDayBefore')}
          </Label>
        </div>
        {schedule.notify_day_before && (
          <span className="text-xs text-muted-foreground">
            {t('dayEvening', { day: notifyDay ? tDays(notifyDay.labelKey) : '' })}
          </span>
        )}
      </div>
    </div>
  );
}

interface ScheduleFormData {
  day_of_week: number;
  notification_time: string;
  occasion: string;
  enabled: boolean;
  notify_day_before: boolean;
}

function AddScheduleDialog({
  onAdd,
  isLoading,
}: {
  onAdd: (data: ScheduleFormData) => Promise<void>;
  isLoading: boolean;
}) {
  const t = useTranslations('notifications.addSchedule');
  const tCommon = useTranslations('common');
  const tDays = useTranslations('dashboard.days');
  const [open, setOpen] = useState(false);
  const [time, setTime] = useState('07:00');
  const [occasion, setOccasion] = useState('casual');
  const [notifyDayBefore, setNotifyDayBefore] = useState(false);
  const [dayOfWeek, setDayOfWeek] = useState<number>(0);

  // Calculate which day notification comes on
  const notifyDay = notifyDayBefore
    ? DAYS[(dayOfWeek + 6) % 7] // Previous day
    : DAYS.find((d) => d.value === dayOfWeek);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await onAdd({
        day_of_week: dayOfWeek,
        notification_time: time,
        occasion,
        enabled: true,
        notify_day_before: notifyDayBefore,
      });
      // Close and reset on success
      setOpen(false);
      setTime('07:00');
      setOccasion('casual');
      setNotifyDayBefore(false);
    } catch {
      // Error handled by parent via toast
    }
  };

  const closeAndReset = () => {
    setOpen(false);
    setTime('07:00');
    setOccasion('casual');
    setNotifyDayBefore(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="signature">
          <Plus className="h-4 w-4" strokeWidth={1.75} />
          {t('buttonLabel')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t('dialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('dialogDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t('day')}</Label>
              <Select
                value={String(dayOfWeek)}
                onValueChange={(v) => setDayOfWeek(parseInt(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAYS.map((day) => (
                    <SelectItem key={day.value} value={String(day.value)}>
                      {tDays(day.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="time">{t('time')}</Label>
              <Input
                id="time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('occasion')}</Label>
              <Select value={occasion} onValueChange={setOccasion}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OCCASIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg bg-panel p-4">
              <div className="space-y-0.5">
                <Label htmlFor="notify-day-before">{t('notifyDayBefore')}</Label>
                <p className="text-xs text-muted-foreground">
                  {t('notifyDayBeforeHelp')}
                </p>
              </div>
              <Switch
                id="notify-day-before"
                checked={notifyDayBefore}
                onCheckedChange={setNotifyDayBefore}
              />
            </div>
            {notifyDayBefore && (
              <p className="rounded-md bg-signature-soft px-4 py-3 text-sm text-foreground">
                {t.rich('previewLine', {
                  notifyDay: notifyDay ? tDays(notifyDay.labelKey) : '',
                  time,
                  targetDay: (() => {
                    const found = DAYS.find(d => d.value === dayOfWeek);
                    return found ? tDays(found.labelKey) : '';
                  })(),
                  strong: (chunks) => <strong>{chunks}</strong>,
                })}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeAndReset} disabled={isLoading}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('adding')}
                </>
              ) : (
                t('buttonLabel')
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function NotificationsPage() {
  const t = useTranslations('notifications');
  const tToasts = useTranslations('notifications.toasts');
  const tDelete = useTranslations('notifications.delete');
  const tCommon = useTranslations('common');

  const { data: settings, isLoading: loadingSettings } = useNotificationSettings();
  const { data: schedules, isLoading: loadingSchedules } = useSchedules();
  const { data: userProfile } = useUserProfile();

  const createSetting = useCreateNotificationSetting();
  const updateSetting = useUpdateNotificationSetting();
  const deleteSetting = useDeleteNotificationSetting();
  const testSetting = useTestNotificationSetting();

  const createSchedule = useCreateSchedule();
  const updateSchedule = useUpdateSchedule();
  const deleteSchedule = useDeleteSchedule();

  const [testingId, setTestingId] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'channel' | 'schedule'; id: string } | null>(null);

  const handleCreateChannel = async (data: ChannelFormData): Promise<void> => {
    try {
      await createSetting.mutateAsync(data);
      toast.success(tToasts('channelAdded'));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : tToasts('channelAddError');
      toast.error(message);
      throw error; // Re-throw so dialog knows it failed
    }
  };

  const handleCreateSchedule = async (data: ScheduleFormData): Promise<void> => {
    try {
      await createSchedule.mutateAsync(data);
      toast.success(tToasts('scheduleAdded'));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : tToasts('scheduleAddError');
      toast.error(message);
      throw error; // Re-throw so dialog knows it failed
    }
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    try {
      const result = await testSetting.mutateAsync(id);
      toast.success(result.message || tToasts('testSent'));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : tToasts('testFailed');
      toast.error(message);
    } finally {
      setTestingId(null);
    }
  };

  const handleToggleChannel = async (id: string, enabled: boolean) => {
    try {
      await updateSetting.mutateAsync({ id, data: { enabled } });
      toast.success(enabled ? tToasts('channelEnabled') : tToasts('channelDisabled'));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : tToasts('updateFailed');
      toast.error(message);
    }
  };

  const handleToggleSchedule = async (id: string, enabled: boolean) => {
    try {
      await updateSchedule.mutateAsync({ id, data: { enabled } });
      toast.success(enabled ? tToasts('scheduleEnabled') : tToasts('scheduleDisabled'));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : tToasts('updateFailed');
      toast.error(message);
    }
  };

  const handleToggleDayBefore = async (id: string, notify_day_before: boolean) => {
    try {
      await updateSchedule.mutateAsync({ id, data: { notify_day_before } });
      toast.success(notify_day_before ? tToasts('willNotifyDayBefore') : tToasts('willNotifySameDay'));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : tToasts('updateFailed');
      toast.error(message);
    }
  };

  const handleDeleteConfirmed = async () => {
    if (!deleteConfirm) return;

    try {
      if (deleteConfirm.type === 'channel') {
        await deleteSetting.mutateAsync(deleteConfirm.id);
        toast.success(tToasts('channelDeleted'));
      } else {
        await deleteSchedule.mutateAsync(deleteConfirm.id);
        toast.success(tToasts('scheduleDeleted'));
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : tToasts('deleteFailed');
      toast.error(message);
    } finally {
      setDeleteConfirm(null);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-2 sm:py-4">
      <PageHeader
        title={t('title')}
        description={t('pageSubtitle')}
        action={
          <Button variant="outline" asChild>
            <Link href="/dashboard/install">
              <Smartphone className="h-4 w-4" strokeWidth={1.75} />
              {t('installApp')}
            </Link>
          </Button>
        }
      />

      {/* Default channels: account email + this device (Web Push) */}
      <DefaultChannelsCard />

      {/* Schedules */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" strokeWidth={1.75} aria-hidden />
                {t('schedulesCardTitle')}
              </CardTitle>
              <CardDescription>
                {t('schedulesCardDescription')}
              </CardDescription>
            </div>
            <AddScheduleDialog
              onAdd={handleCreateSchedule}
              isLoading={createSchedule.isPending}
            />
          </div>
        </CardHeader>
        <CardContent>
          {loadingSchedules ? (
            <div className="space-y-4">
              <Skeleton className="h-16 rounded-lg" />
              <Skeleton className="h-16 rounded-lg" />
            </div>
          ) : schedules?.length === 0 ? (
            <EmptyState
              state="sleepy"
              size="sm"
              className="py-6"
              title={t('schedulesEmptyTitle')}
              description={t('schedulesEmptyHint')}
            />
          ) : (
            <div className="space-y-3">
              {DAYS.map((day) => {
                const daySchedules = schedules?.filter((s) => s.day_of_week === day.value) || [];
                if (daySchedules.length === 0) return null;
                return daySchedules.map((schedule) => (
                  <ScheduleCard
                    key={schedule.id}
                    schedule={schedule}
                    onToggle={(enabled) => handleToggleSchedule(schedule.id, enabled)}
                    onToggleDayBefore={(notify_day_before) => handleToggleDayBefore(schedule.id, notify_day_before)}
                    onDelete={() => setDeleteConfirm({ type: 'schedule', id: schedule.id })}
                  />
                ));
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Advanced: ntfy / Mattermost (and legacy SMTP email) channels */}
      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger className="pressable flex w-full items-center justify-between gap-3 rounded-lg bg-panel px-4 py-4 text-left sm:px-5">
          <span className="flex min-w-0 items-center gap-3">
            <Settings2 className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden />
            <span className="min-w-0">
              <span className="block font-bold">{t('advanced.title')}</span>
              <span className="block text-sm text-muted-foreground">{t('advanced.description')}</span>
            </span>
          </span>
          <ChevronDown
            className={cn('h-5 w-5 shrink-0 transition-transform', advancedOpen && 'rotate-180')}
            strokeWidth={1.75}
            aria-hidden
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle>{t('channelsCardTitle')}</CardTitle>
                  <CardDescription>{t('advanced.channelsHint')}</CardDescription>
                </div>
                <AddChannelDialog
                  onAdd={handleCreateChannel}
                  isLoading={createSetting.isPending}
                  userEmail={userProfile?.email}
                />
              </div>
            </CardHeader>
            <CardContent>
              {loadingSettings ? (
                <div className="space-y-4">
                  <Skeleton className="h-24 rounded-lg" />
                </div>
              ) : settings?.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('channelsEmptyHint')}</p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {settings?.map((setting) => (
                    <ChannelCard
                      key={setting.id}
                      setting={setting}
                      testing={testingId === setting.id}
                      onTest={() => handleTest(setting.id)}
                      onToggle={(enabled) => handleToggleChannel(setting.id, enabled)}
                      onDelete={() => setDeleteConfirm({ type: 'channel', id: setting.id })}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteConfirm?.type === 'channel' ? tDelete('channelTitle') : tDelete('scheduleTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteConfirm?.type === 'channel'
                ? tDelete('channelBody')
                : tDelete('scheduleBody')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirmed}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteSetting.isPending || deleteSchedule.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {tDelete('deleting')}
                </>
              ) : (
                tDelete('delete')
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
