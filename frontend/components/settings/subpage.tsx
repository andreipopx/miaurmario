'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/page-header';
import { cn } from '@/lib/utils';

/**
 * One screen of Ajustes: «← Ajustes», the title, and the fields. No line under
 * the title; one primary action per screen, placed by the page itself.
 */
export function SettingsSubpage({
  title,
  action,
  loading = false,
  backHref = '/dashboard/settings',
  backLabel,
  className,
  children,
}: {
  title: React.ReactNode;
  action?: React.ReactNode;
  loading?: boolean;
  backHref?: string;
  backLabel?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const t = useTranslations('settings');
  return (
    <div className={cn('mx-auto max-w-3xl space-y-6 py-2 sm:py-4', className)}>
      <Button variant="ghost" asChild className="-ml-3 text-muted-foreground hover:text-foreground">
        <Link href={backHref}>{backLabel ?? t('back')}</Link>
      </Button>
      <PageHeader title={title} action={action} />
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        children
      )}
    </div>
  );
}

/** A 17 px header and what goes under it: rows or fields, never a bordered card. */
export function SettingsSection({
  title,
  action,
  children,
  className,
}: {
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('space-y-3', className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-4 px-1">
          {title && <h2 className="text-[17px] font-bold tracking-tight">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
