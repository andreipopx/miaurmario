'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Bell } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { InstallGuide } from '@/components/install/install-guide';

export default function InstallPage() {
  const t = useTranslations('install');
  return (
    <div className="mx-auto max-w-2xl space-y-6 py-2 sm:py-4">
      <PageHeader title={t('title')} description={t('subtitle')} />
      <Card>
        <CardContent className="pt-6">
          <InstallGuide />
        </CardContent>
      </Card>
      <Button variant="outline" asChild>
        <Link href="/dashboard/notifications">
          <Bell className="h-4 w-4" strokeWidth={1.75} />
          {t('notificationsLink')}
        </Link>
      </Button>
    </div>
  );
}
