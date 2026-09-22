'use client';

import { usePathname, useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { canGoBackInApp, parentPath } from '@/lib/native/navigation';
import { navigateWithTransition } from '@/lib/native/view-transition';

/**
 * In-app back affordance for screens outside the dock tabs (iOS standalone has
 * no browser back button). History back when we came from inside the app,
 * otherwise up to the parent route.
 */
export function BackButton({ className, fallback }: { className?: string; fallback?: string }) {
  const router = useRouter();
  const pathname = usePathname() ?? '/dashboard';
  const t = useTranslations('common');

  const goBack = () => {
    navigateWithTransition(() => {
      if (canGoBackInApp()) router.back();
      else router.push(fallback ?? parentPath(pathname));
    });
  };

  return (
    <button
      type="button"
      onClick={goBack}
      aria-label={t('back')}
      data-testid="app-back"
      className={cn(
        'pressable flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-panel text-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className
      )}
    >
      <ChevronLeft className="h-6 w-6" strokeWidth={2} aria-hidden />
    </button>
  );
}
