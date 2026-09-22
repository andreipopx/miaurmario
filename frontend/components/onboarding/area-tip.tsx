'use client';

import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';

import { StinkyAvatar } from '@/components/brand/stinky-avatar';
import { useSeenTips } from '@/lib/hooks/use-seen-tips';
import { AREA_TIPS, shouldShowTip, tipKeyForPath, type TipArea } from '@/lib/onboarding/first-run';

const AREA_BY_KEY = Object.fromEntries(Object.entries(AREA_TIPS).map(([area, key]) => [key, area])) as Record<
  string,
  TipArea
>;

/**
 * Areas whose page has a fixed header over the top of <main> (the Stinky chat):
 * the page renders <AreaTip inPage /> itself, below that header.
 */
const IN_PAGE_TIPS: ReadonlySet<string> = new Set([AREA_TIPS.stinky]);

/**
 * One-time Stinky bubble on the first visit to an area (Armario, Estilista,
 * Inspiración, Stinky, Ajustes). Stays until dismissed; never after the
 * tour's "Saltar todo".
 */
export function AreaTip({ inPage = false }: { inPage?: boolean }) {
  const pathname = usePathname();
  const t = useTranslations('firstRun.tips');
  const tCommon = useTranslations('common');
  const { user, local, markSeen } = useSeenTips();
  const key = tipKeyForPath(pathname);

  if (!key || IN_PAGE_TIPS.has(key) !== inPage || !shouldShowTip(user, key, local)) return null;
  const area = AREA_BY_KEY[key];

  return (
    <div
      role="status"
      data-testid="area-tip"
      className="mb-4 flex items-start gap-3 rounded-[20px] bg-signature-soft p-2 pr-1.5 animate-in fade-in-0 slide-in-from-top-1 motion-reduce:animate-none"
    >
      <StinkyAvatar size={40} className="bg-background" />
      <p className="min-w-0 flex-1 self-center py-1 text-[14px] leading-snug">
        <strong className="font-bold">{tCommon('stinkySays')}</strong> {t(area)}
      </p>
      <button
        type="button"
        onClick={() => markSeen([key])}
        aria-label={t('dismiss')}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/10"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
