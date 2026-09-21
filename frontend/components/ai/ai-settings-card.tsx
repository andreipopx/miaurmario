'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Sparkles } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useAIStatus } from '@/lib/hooks/use-ai-access';

/** Settings entry point for AI access; admins also get a link to the admin panel. */
export function AISettingsCard() {
  const t = useTranslations('aiAccess');
  const { data: status } = useAIStatus();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" strokeWidth={1.75} aria-hidden />
          {t('settingsCard.title')}
        </CardTitle>
        <CardDescription>{t('settingsCard.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {status && (
          <Badge variant={status.access === 'none' ? 'secondary' : 'signature'}>
            {t(`access.${status.access}`)}
          </Badge>
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="outline" asChild>
            <Link href="/dashboard/settings/ai">{t('settingsCard.cta')}</Link>
          </Button>
          {status?.is_admin && (
            <Button variant="outline" asChild>
              <Link href="/dashboard/admin">{t('adminCard.cta')}</Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
