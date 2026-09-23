'use client';

import { Vibrate } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { STINKY_PET_VIBRATION } from '@/components/stinky/stinky-pet';
import { haptic, prefersReducedMotion } from '@/lib/native/haptics';

/**
 * "Vibración": fires Stinky's purr pattern so the owner can check whether this phone does anything.
 * The toast says what actually happened, because on iPhone the answer is often "nothing".
 */
export function HapticsCard() {
  const t = useTranslations('settings.haptics');

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
        <Button variant="outline" onClick={test} className="w-full sm:w-auto">
          {t('test')}
        </Button>
        <p className="text-sm text-muted-foreground">{t('note')}</p>
      </CardContent>
    </Card>
  );
}
