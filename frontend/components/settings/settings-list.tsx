'use client';

import Link from 'next/link';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { POP_BG, type PopColor } from '@/components/chip';

/**
 * iOS-style settings list: groups of rows on one grey panel, a hairline between
 * rows. A row is a coloured icon, a name, the current value on the right when it
 * helps («Madrid», «Claro») and a chevron; the explanation lives on the page it opens.
 */
export function SettingsGroup({
  label,
  children,
  className,
}: {
  /** Optional 17 px header above the group. */
  label?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('space-y-2', className)} aria-label={label}>
      {label && <h2 className="px-1 text-[17px] font-bold tracking-tight">{label}</h2>}
      <ul className="divide-y divide-border overflow-hidden rounded-lg bg-panel">{children}</ul>
    </section>
  );
}

export function SettingsRow({
  href,
  icon: Icon,
  tone = 'pink',
  leading,
  label,
  value,
  onClick,
  className,
}: {
  href?: string;
  icon?: LucideIcon | React.ComponentType<{ className?: string; strokeWidth?: number }>;
  /** Colour of the icon's circle, from the Stinky pop palette. */
  tone?: PopColor;
  /** Replaces the icon (a service's own logo). */
  leading?: React.ReactNode;
  label: React.ReactNode;
  /** Current value, shown muted on the right. */
  value?: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  const body = (
    <>
      {leading ??
        (Icon && (
          <span
            className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-pop-foreground', POP_BG[tone])}
            aria-hidden
          >
            <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
          </span>
        ))}
      <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{label}</span>
      {value != null && value !== '' && (
        <span className="flex min-w-0 max-w-[45%] shrink items-center justify-end gap-1 truncate text-sm text-muted-foreground">
          {value}
        </span>
      )}
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden />
    </>
  );
  const rowClass = cn(
    'pressable flex min-h-[52px] w-full items-center gap-3 px-4 py-3 text-left',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
    'hover:bg-accent',
    className
  );
  return (
    <li>
      {href ? (
        <Link href={href} className={rowClass}>
          {body}
        </Link>
      ) : (
        <button type="button" onClick={onClick} className={rowClass}>
          {body}
        </button>
      )}
    </li>
  );
}
