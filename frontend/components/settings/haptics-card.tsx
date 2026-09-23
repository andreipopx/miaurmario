'use client';

import { useEffect, useState } from 'react';
import { Vibrate } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { STINKY_PET_VIBRATION } from '@/components/stinky/stinky-pet';
import { haptic, prefersReducedMotion } from '@/lib/native/haptics';
import {
  currentNotificationHapticAvailability,
  isNotificationHapticEnabled,
  notificationHaptic,
  setNotificationHapticEnabled,
  type NotificationHapticAvailability,
} from '@/lib/native/notification-haptic';

/**
 * "Vibración": fires Stinky's purr pattern so the owner can check whether this phone does anything.
 * The toast says what actually happened, because on iPhone the answer is often "nothing".
 *
 * Below it, only on an iPhone that cannot vibrate at all, sits the opt-in notification experiment
 * (see `lib/native/notification-haptic.ts`). Android never sees it.
 */
export function HapticsCard() {
  const t = useTranslations('settings.haptics');
  const [availability, setAvailability] = useState<NotificationHapticAvailability | null>(null);
  const [notifyOn, setNotifyOn] = useState(false);

  useEffect(() => {
    let alive = true;
    setNotifyOn(isNotificationHapticEnabled());
    void currentNotificationHapticAvailability().then((a) => {
      if (alive) setAvailability(a);
    });
    return () => {
      alive = false;
    };
  }, []);

  const test = () => {
    if (prefersReducedMotion()) {
      toast(t('resultReducedMotion'));
      return;
    }
    const outcome = haptic(STINKY_PET_VIBRATION.purr);
    if (outcome === 'vibrate') toast.success(t('resultVibrate'));
    else if (outcome === 'switch') toast(t('resultSwitch'));
    else toast(t('resultNone'));
  };

  const toggleNotify = (checked: boolean) => {
    setNotificationHapticEnabled(checked);
    setNotifyOn(checked);
    toast(checked ? t('notifyOnToast') : t('notifyOffToast'));
  };

  const testNotify = async () => {
    if (prefersReducedMotion()) {
      toast(t('resultReducedMotion'));
      return;
    }
    const outcome = await notificationHaptic();
    if (outcome === 'shown') toast.success(t('notifySent'));
    else if (outcome === 'throttled') toast(t('notifyThrottled'));
    else if (outcome === 'off') toast(t('notifyOffToast'));
    else toast(t('notifyError'));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Vibrate className="h-5 w-5" strokeWidth={1.75} aria-hidden />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Button variant="outline" onClick={test} className="w-full sm:w-auto">
            {t('test')}
          </Button>
          {availability === 'available' && (
            <Button
              variant="outline"
              onClick={testNotify}
              disabled={!notifyOn}
              className="w-full sm:w-auto"
            >
              {t('notifyTest')}
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{t('note')}</p>

        {availability === 'available' && (
          <div className="space-y-2 border-t border-border pt-3">
            <div className="flex items-start justify-between gap-3">
              <Label htmlFor="haptic-notification" className="text-sm font-bold leading-snug">
                {t('notifyLabel')}
              </Label>
              <Switch
                id="haptic-notification"
                checked={notifyOn}
                onCheckedChange={toggleNotify}
                className="mt-0.5 shrink-0"
              />
            </div>
            <p className="text-sm text-muted-foreground">{t('notifyHelp')}</p>
            <p className="text-xs text-muted-foreground">{t('notifyNote')}</p>
          </div>
        )}
        {availability === 'needs-permission' && (
          <p className="border-t border-border pt-3 text-sm text-muted-foreground">
            {t('notifyNeedsPermission')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
