'use client';

import { cn } from '@/lib/utils';
import { Stinky } from '@/components/stinky/stinky';
import type { StinkyStateInput } from '@/components/stinky/stinky-states';

/**
 * Empty / error state with Stinky in a soft-pink circle.
 * Defaults to `sleepy` (nothing here yet); use `sad` for errors.
 */
export function EmptyState({
  title,
  description,
  action,
  state = 'sleepy',
  size = 'md',
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  state?: StinkyStateInput;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const circle = size === 'sm' ? 112 : size === 'lg' ? 176 : 144;
  return (
    <div className={cn('flex flex-col items-center px-6 py-10 text-center', className)}>
      <div
        className="flex items-center justify-center rounded-full bg-signature-soft"
        style={{ width: circle, height: circle }}
      >
        <Stinky state={state} size={Math.round(circle * 0.85)} label="" />
      </div>
      <h2 className="mt-5 text-xl font-extrabold tracking-tight">{title}</h2>
      {description && (
        <p className="mt-2 max-w-sm text-[15px] leading-snug text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}
