'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Sparkles } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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
  feature: 'suggest' | 'tagging' | 'pairings';
  className?: string;
}

/** Friendly inline notice (not an error) shown where an AI feature would run. */
export function AIUnavailableNotice({ reason, feature, className }: AIUnavailableNoticeProps) {
  const t = useTranslations('aiAccess.notice');
  const key = reason && KNOWN_REASONS.has(reason) ? reason : 'ai_not_enabled';

  return (
    <Alert className={cn('space-y-1', className)}>
      <Sparkles className="h-4 w-4" />
      <AlertTitle>{t(`title.${key}`)}</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>{t(`feature.${feature}`)}</p>
        <Button asChild size="sm" variant="outline">
          <Link href="/dashboard/settings/ai">{t('cta')}</Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}
