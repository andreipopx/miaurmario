'use client';

import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';
import { StinkyAvatar } from '@/components/brand/stinky-avatar';
import { useStinkyPersona } from '@/components/stinky/stinky-persona';
import { meows, seedOf } from '@/lib/meows';

/** "Stinky says…" speech bubble: small Stinky head + text on a white (or panel) pill-card. */
export function StinkyTip({
  children,
  className,
  clamp = false,
}: {
  children: React.ReactNode;
  className?: string;
  /** Clamp to three lines (compact panels). */
  clamp?: boolean;
}) {
  const t = useTranslations('common');
  const { voice } = useStinkyPersona();
  // «Solo miau»: whatever he had to say, he says it in meows (same meows every time).
  const said = voice === 'solo-miau' ? meows(seedOf(children) || 'stinky') : children;
  return (
    <div className={cn('flex items-center gap-3 rounded-[18px] bg-background p-2 pr-4', className)}>
      <StinkyAvatar size={40} className="bg-signature-soft" />
      <p className={cn('text-[13.5px] leading-snug', clamp && 'line-clamp-3')}>
        <strong className="font-bold">{t('stinkySays')}</strong> {said}
      </p>
    </div>
  );
}
