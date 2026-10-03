'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Plus, Trash2, Clock, Loader2, Calendar, Smartphone } from 'lucide-react';
import { DefaultChannelsCard } from '@/components/notifications/default-channels';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
  useSchedules,
  useCreateSchedule,
  useUpdateSchedule,
  useDeleteSchedule,
  Schedule,
} from '@/lib/hooks/use-notifications';
import { OCCASIONS } from '@/lib/types';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { isNativeApp } from '@/lib/native/app-shell';

const DAYS = [
  { value: 0, labelKey: 'monday' as const },
  { value: 1, labelKey: 'tuesday' as const },
  { value: 2, labelKey: 'wednesday' as const },
  { value: 3, labelKey: 'thursday' as const },
  { value: 4, labelKey: 'friday' as const },
  { value: 5, labelKey: 'saturday' as const },
  { value: 6, labelKey: 'sunday' as const },
];

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
  const tOccasions = useTranslations('suggest.occasions');
  const occasionLabel = tOccasions.has(schedule.occasion as never)
    ? tOccasions(schedule.occasion as never)
    : schedule.occasion;

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
              {schedule.notification_time} - {occasionLabel}
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
  const tOccasions = useTranslations('suggest.occasions');
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
                      {tOccasions(o.value)}
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

  const { data: schedules, isLoading: loadingSchedules } = useSchedules();

  const createSchedule = useCreateSchedule();
  const updateSchedule = useUpdateSchedule();
  const deleteSchedule = useDeleteSchedule();

  // No "install the app" button inside the app itself.
  const [inApp, setInApp] = useState(false);
  useEffect(() => setInApp(isNativeApp()), []);
  const [deleteScheduleId, setDeleteScheduleId] = useState<string | null>(null);

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
    if (!deleteScheduleId) return;

    try {
      await deleteSchedule.mutateAsync(deleteScheduleId);
      toast.success(tToasts('scheduleDeleted'));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : tToasts('deleteFailed');
      toast.error(message);
    } finally {
      setDeleteScheduleId(null);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-2 sm:py-4">
      <PageHeader
        title={t('title')}
        description={t('pageSubtitle')}
        action={
          inApp ? undefined : (
            <Button variant="outline" asChild>
              <Link href="/dashboard/install">
                <Smartphone className="h-4 w-4" strokeWidth={1.75} />
                {t('installApp')}
              </Link>
            </Button>
          )
        }
      />

      {/* What we tell you about, by email and push (this device / the app) */}
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
                    onDelete={() => setDeleteScheduleId(schedule.id)}
                  />
                ));
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!deleteScheduleId}
        onOpenChange={(open) => !open && setDeleteScheduleId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tDelete('scheduleTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{tDelete('scheduleBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirmed}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteSchedule.isPending ? (
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
