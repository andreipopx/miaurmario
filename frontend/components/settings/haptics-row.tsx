'use client';

import { Vibrate } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { STINKY_PET_VIBRATION } from '@/components/stinky/stinky-pet';
import { haptic, prefersReducedMotion } from '@/lib/native/haptics';

/**
 * «Vibración» + «Probar»: fires Stinky's purr so the owner can feel whether this
 * phone does anything. What happened (often «nothing» on iPhone) is said after
 * the tap, in the toast, not before it.
 */
export function HapticsRow() {
  const t = useTranslations('settings.haptics');

  const test = () => {
    if (prefersReducedMotion()) {
      toast(t('resultReducedMotion'));
      return;
    }
    const outcome = haptic(STINKY_PET_VIBRATION.purr);
    if (outcome === 'vibrate' || outcome === 'native') toast.success(t('resultVibrate'));
    else if (outcome === 'switch') toast(t('resultSwitch'));
    else toast(t('resultNone'));
  };

  return (
    <div className="flex min-h-[52px] items-center justify-between gap-4 px-1">
      <span className="flex items-center gap-3 text-[15px] font-semibold">
        <Vibrate className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} aria-hidden />
        {t('title')}
      </span>
      <Button variant="outline" size="sm" onClick={test}>
        {t('test')}
      </Button>
    </div>
  );
}
