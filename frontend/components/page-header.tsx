import { cn } from '@/lib/utils';

/**
 * Standard page title row: extra-bold title, optional muted description and a
 * right-aligned action (e.g. a pink "Añadir" pill).
 */
export function PageHeader({
  title,
  description,
  action,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-3', className)}>
      <div className="min-w-0 space-y-1">
        <h1 className="text-[28px] font-extrabold leading-tight tracking-[-0.02em] sm:text-3xl">{title}</h1>
        {description && <p className="text-[15px] leading-snug text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="flex max-w-full flex-wrap items-center gap-2">{action}</div>}
    </header>
  );
}
