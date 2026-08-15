'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function IntegrationsIndexPage() {
  const t = useTranslations('integrations');

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-8">
      <div>
        <h1 className="font-serif text-3xl">{t('title')}</h1>
        <p className="mt-1 text-muted-foreground">{t('subtitle')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('pinterest.title')}</CardTitle>
          <CardDescription>{t('pinterest.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/dashboard/settings/integrations/pinterest">{t('pinterest.manage')}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
