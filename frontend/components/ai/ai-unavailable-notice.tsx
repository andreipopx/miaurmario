'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { LazyStinky } from '@/components/native/lazy-stinky';
import { cn } from '@/lib/utils';

const KNOWN_REASONS = new Set([
  'ai_not_enabled',
  'ai_quota_exceeded',
  'ai_capability_unavailable',
  'ai_key_unreadable',
  'ai_provider_blocked',
]);

interface AIUnavailableNoticeProps {
  /** Backend code (ai_not_enabled, ai_quota_exceeded, ...). Defaults to ai_not_enabled. */
  reason?: string | null;
  /** Which feature is affected, to tailor the sentence. */
  feature: 'suggest' | 'tagging' | 'pairings' | 'chat' | 'selfie';
  className?: string;
}

/**
 * Friendly inline notice (not an error) shown where an AI feature would run:
 * a small sleepy Stinky on soft pink, a short explanation and a pill CTA to AI settings.
 */
export function AIUnavailableNotice({ reason, feature, className }: AIUnavailableNoticeProps) {
  const t = useTranslations('aiAccess.notice');
  const key = reason && KNOWN_REASONS.has(reason) ? reason : 'ai_not_enabled';

  return (
    <div
      role="status"
      className={cn('flex items-start gap-3 rounded-lg bg-panel p-4 sm:gap-4 sm:p-5', className)}
    >
      <div
        aria-hidden
        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-signature-soft"
      >
        <LazyStinky state="sleepy" size={48} label="" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-[15px] font-bold leading-snug">{t(`title.${key}`)}</p>
        <p className="text-sm leading-snug text-muted-foreground">{t(`feature.${feature}`)}</p>
        <div className="pt-2">
          <Button asChild size="sm" variant="signature">
            <Link href="/dashboard/settings/ai">
              <Sparkles className="h-4 w-4" strokeWidth={2} aria-hidden />
              {t('cta')}
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
