'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Help text behind «Más»: the screen says one line, and the rest waits for a tap.
 */
export function More({
  children,
  className,
  defaultOpen = false,
}: {
  children: React.ReactNode;
  className?: string;
  defaultOpen?: boolean;
}) {
  const t = useTranslations('common');
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className={cn('space-y-2', className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {open ? t('less') : t('more')}
        <ChevronDown
          className={cn('h-4 w-4 transition-transform duration-150', open && 'rotate-180')}
          strokeWidth={2}
          aria-hidden
        />
      </button>
      {open && (
        <div id={id} className="space-y-2 text-sm leading-snug text-muted-foreground">
          {children}
        </div>
      )}
    </div>
  );
}
