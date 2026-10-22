'use client';

import { StinkyAvatar } from '@/components/brand/stinky-avatar';
import { cn } from '@/lib/utils';

/**
 * One thing Stinky says in the chat, with his face next to it. Anything shown
 * with it (a button, chips) goes under the bubble, aligned with it.
 *
 * `continued`: a second bubble right after another of his — same sender, so
 * the face is not repeated, only the room for it.
 */
export function StinkyBubble({
  children,
  after,
  continued = false,
  className,
  testId,
}: {
  children: React.ReactNode;
  after?: React.ReactNode;
  continued?: boolean;
  className?: string;
  testId?: string;
}) {
  return (
    <div className={cn('flex items-end gap-2', className)} data-testid={testId}>
      {continued ? (
        <span aria-hidden className="w-[30px] shrink-0" />
      ) : (
        <StinkyAvatar size={30} className="mb-0.5 bg-signature-soft" />
      )}
      <div className="flex min-w-0 max-w-[85%] flex-col items-start">
        <div className="break-words [overflow-wrap:anywhere] rounded-[22px] rounded-bl-lg bg-panel px-4 py-2.5 text-[15px] leading-snug">
          {children}
        </div>
        {after}
      </div>
    </div>
  );
}
