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
      {/* His face says who is talking: no «Stinky:» label to repeat it. */}
      <StinkyAvatar size={36} className="bg-signature-soft" label={t('stinkySays')} />
      <p className={cn('text-[13.5px] leading-snug', clamp && 'line-clamp-3')}>
        {said}
      </p>
    </div>
  );
}
