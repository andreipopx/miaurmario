'use client';

import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';
import { StinkyAvatar } from '@/components/brand/stinky-avatar';

/** "Stinky says…" speech bubble: small Stinky head + text on a white (or panel) pill-card. */
export function StinkyTip({ children, className }: { children: React.ReactNode; className?: string }) {
  const t = useTranslations('common');
  return (
    <div className={cn('flex items-center gap-3 rounded-[18px] bg-background p-2 pr-4', className)}>
      <StinkyAvatar size={40} className="bg-signature-soft" />
      <p className="text-[13.5px] leading-snug">
        <strong className="font-bold">{t('stinkySays')}</strong> {children}
      </p>
    </div>
  );
}
