'use client';

import { useTranslations } from 'next-intl';
import { getApiErrorCode } from '@/lib/ai-access';
import { getErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

/** Translated message for an admin API error (falls back to the backend text). */
export function useAdminErrorMessage() {
  const t = useTranslations('admin');
  return (error: unknown, fallbackKey = 'saveError') => {
    const code = getApiErrorCode(error);
    if (code && t.has(`errors.${code}`)) return t(`errors.${code}`);
    return getErrorMessage(error, t(fallbackKey));
  };
}

export function StatTile({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-quick bg-panel p-4', className)}>
      <p className="text-[13px] font-semibold text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-extrabold tracking-[-0.02em] tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function SectionCard({
  title,
  description,
  action,
  children,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-lg border border-border bg-card p-4 sm:p-5', className)}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-[17px] font-bold">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function KeyValue({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="break-words font-semibold">{children}</dd>
    </div>
  );
}

/** Two-to-four option pill group (single choice). */
export function PillGroup<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-full bg-panel p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            'min-h-[36px] rounded-full px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
            value === o.value
              ? 'bg-foreground text-background'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
