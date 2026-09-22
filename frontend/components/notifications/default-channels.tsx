'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  BellOff,
  BellRing,
  CalendarHeart,
  CheckCircle2,
  Loader2,
  Mail,
  Send,
  Smartphone,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { InstallGuideDialog } from '@/components/install/install-guide';
import {
  NOTIFICATION_EVENTS,
  type DefaultChannel,
  type NotificationEvent,
  type NotificationPreferences,
  useNotificationPreferences,
  useTestPush,
  useUpdateNotificationPreferences,
} from '@/lib/hooks/use-notifications';
import { usePushDevice } from '@/lib/pwa/use-push-device';
import { cn } from '@/lib/utils';

const EVENT_ICON: Record<NotificationEvent, React.ReactNode> = {
  friend_request: <UserPlus className="h-5 w-5" strokeWidth={1.75} />,
  friend_accepted: <UserCheck className="h-5 w-5" strokeWidth={1.75} />,
  daily_outfit: <CalendarHeart className="h-5 w-5" strokeWidth={1.75} />,
};

const EVENT_BG: Record<NotificationEvent, string> = {
  friend_request: 'bg-pop-sky',
  friend_accepted: 'bg-pop-mint',
  daily_outfit: 'bg-pop-amber',
};

/** Event x channel switches: Email and "Este dispositivo" (Web Push). */
function PreferencesMatrix({ prefs }: { prefs: NotificationPreferences }) {
  const t = useTranslations('notifications.defaults');
  const update = useUpdateNotificationPreferences();
  const pushReady = prefs.push_available && prefs.push_devices > 0;

  const toggle = (channel: DefaultChannel, event: NotificationEvent, value: boolean) => {
    update.mutate(
      { [channel]: { [event]: value } },
      { onError: () => toast.error(t('saveError')) }
    );
  };

  const columns: { key: DefaultChannel; label: string; icon: React.ReactNode; enabled: boolean }[] = [
    {
      key: 'email',
      label: t('channels.email'),
      icon: <Mail className="h-4 w-4" strokeWidth={1.75} aria-hidden />,
      enabled: prefs.email_available,
    },
    {
      key: 'push',
      label: t('channels.push'),
      icon: <Smartphone className="h-4 w-4" strokeWidth={1.75} aria-hidden />,
      enabled: pushReady,
    },
  ];

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_4.5rem_4.5rem] items-end gap-2 px-1 sm:grid-cols-[1fr_6.5rem_6.5rem]">
        <span />
        {columns.map((c) => (
          <span
            key={c.key}
            className="flex flex-col items-center gap-1 text-center text-xs font-semibold leading-tight text-muted-foreground"
          >
            {c.icon}
            {c.label}
          </span>
        ))}
      </div>
      <ul className="space-y-2">
        {NOTIFICATION_EVENTS.map((event) => (
          <li
            key={event}
            className="grid grid-cols-[1fr_4.5rem_4.5rem] items-center gap-2 rounded-lg bg-panel p-3 sm:grid-cols-[1fr_6.5rem_6.5rem] sm:p-4"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span
                aria-hidden
                className={cn(
                  'hidden h-10 w-10 shrink-0 items-center justify-center rounded-full text-pop-foreground min-[400px]:flex',
                  EVENT_BG[event]
                )}
              >
                {EVENT_ICON[event]}
              </span>
              <div className="min-w-0">
                <p className="font-bold leading-tight">{t(`events.${event}.title`)}</p>
                <p className="text-xs text-muted-foreground sm:text-sm">{t(`events.${event}.description`)}</p>
              </div>
            </div>
            {columns.map((c) => (
              <div key={c.key} className="flex justify-center">
                <Switch
                  checked={c.enabled && prefs[c.key][event]}
                  disabled={!c.enabled}
                  onCheckedChange={(v) => toggle(c.key, event, v)}
                  aria-label={`${t(`events.${event}.title`)} · ${c.label}`}
                />
              </div>
            ))}
          </li>
        ))}
      </ul>
      <div className="space-y-1 px-1 pt-1 text-xs text-muted-foreground">
        {prefs.email_available ? (
          <p>{t('emailTo', { email: prefs.email_address })}</p>
        ) : (
          <p>{t('emailUnavailable')}</p>
        )}
        {prefs.push_available && prefs.push_devices === 0 && <p>{t('pushNeedsDevice')}</p>}
        <p>{t('lowNoise')}</p>
      </div>
    </div>
  );
}

/** Web Push state for this device, with the only permission prompt (on tap). */
function ThisDevice({ prefs }: { prefs: NotificationPreferences }) {
  const t = useTranslations('notifications.defaults.device');
  const device = usePushDevice(prefs.vapid_public_key);
  const testPush = useTestPush();
  const [guideOpen, setGuideOpen] = useState(false);

  const handleEnable = async () => {
    const result = await device.enable();
    if (result === 'granted') toast.success(t('enabledToast'));
    else if (result === 'denied') toast.error(t('deniedToast'));
    else if (result === 'error') toast.error(t('errorToast'));
  };

  const handleDisable = async () => {
    await device.disable();
    toast.success(t('disabledToast'));
  };

  const handleTest = async () => {
    try {
      const r = await testPush.mutateAsync();
      if (r.sent > 0) toast.success(t('testSent'));
      else toast.error(t('testNone'));
    } catch {
      toast.error(t('errorToast'));
    }
  };

  let body: React.ReactNode;
  if (device.support === null) {
    body = <Skeleton className="h-11 w-56 rounded-full" />;
  } else if (device.support === 'needs-install') {
    body = (
      <>
        <p className="text-sm text-muted-foreground">{t('iosNeedsInstall')}</p>
        <Button variant="signature" onClick={() => setGuideOpen(true)}>
          <BellRing className="h-4 w-4" strokeWidth={1.75} />
          {t('enable')}
        </Button>
        <InstallGuideDialog open={guideOpen} onOpenChange={setGuideOpen} reason={t('iosNeedsInstall')} />
      </>
    );
  } else if (device.support === 'ios-too-old') {
    body = <p className="text-sm text-muted-foreground">{t('iosTooOld')}</p>;
  } else if (device.support === 'unsupported') {
    body = (
      <>
        <p className="text-sm text-muted-foreground">{t('unsupported')}</p>
        <Button variant="outline" asChild>
          <Link href="/dashboard/install">{t('installGuide')}</Link>
        </Button>
      </>
    );
  } else if (device.subscribed && device.permission === 'granted') {
    body = (
      <>
        <p className="flex items-center gap-2 text-sm font-semibold">
          <CheckCircle2 className="h-5 w-5 text-pop-mint" strokeWidth={2} aria-hidden />
          {t('enabledHere')}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={handleTest} disabled={testPush.isPending}>
            {testPush.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" strokeWidth={1.75} />
            )}
            {t('test')}
          </Button>
          <Button variant="ghost" onClick={handleDisable} disabled={device.busy}>
            <BellOff className="h-4 w-4" strokeWidth={1.75} />
            {t('disable')}
          </Button>
        </div>
      </>
    );
  } else if (device.permission === 'denied') {
    body = <p className="text-sm text-muted-foreground">{t('blocked')}</p>;
  } else {
    body = (
      <>
        <p className="text-sm text-muted-foreground">{t('pitch')}</p>
        <Button variant="signature" onClick={handleEnable} disabled={device.busy}>
          {device.busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <BellRing className="h-4 w-4" strokeWidth={1.75} />
          )}
          {t('enable')}
        </Button>
      </>
    );
  }

  return (
    <div className="space-y-3 rounded-lg bg-panel p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-signature text-signature-foreground"
        >
          <Smartphone className="h-5 w-5" strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <p className="font-bold leading-tight">{t('title')}</p>
          {prefs.push_devices > 0 && (
            <p className="text-xs text-muted-foreground">{t('devices', { count: prefs.push_devices })}</p>
          )}
        </div>
      </div>
      <div className="flex flex-col items-start gap-3">{body}</div>
    </div>
  );
}

export function DefaultChannelsCard() {
  const t = useTranslations('notifications.defaults');
  const { data: prefs, isLoading } = useNotificationPreferences();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellRing className="h-5 w-5" strokeWidth={1.75} aria-hidden />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading || !prefs ? (
          <div className="space-y-2">
            <Skeleton className="h-16 rounded-lg" />
            <Skeleton className="h-16 rounded-lg" />
            <Skeleton className="h-16 rounded-lg" />
          </div>
        ) : (
          <>
            <PreferencesMatrix prefs={prefs} />
            {prefs.push_available && <ThisDevice prefs={prefs} />}
          </>
        )}
      </CardContent>
    </Card>
  );
}
