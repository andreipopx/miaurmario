'use client';

import { cn } from '@/lib/utils';
import { LazyStinky } from '@/components/native/lazy-stinky';
import type { StinkyStateInput } from '@/components/stinky/stinky-states';

/**
 * Empty / error state: a short title, at most one line under it, and the action.
 *
 * Stinky sits on top, in his pink circle: one cat per page. Pass `mascot={false}`
 * where the page already shows him (a tip, the chat), so he never appears twice.
 */
export function EmptyState({
  title,
  description,
  action,
  state = 'sleepy',
  mascot = true,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  state?: StinkyStateInput;
  mascot?: boolean;
  /** @deprecated kept for callers; the quiet state has one size. */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-8 text-center', className)}>
      {mascot && (
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-signature-soft">
          <LazyStinky state={state} size={80} label="" />
        </div>
      )}
      <h2 className={cn('text-[17px] font-bold tracking-tight', mascot && 'mt-4')}>{title}</h2>
      {description && (
        <p className="mt-1 max-w-xs text-[14px] leading-snug text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}
