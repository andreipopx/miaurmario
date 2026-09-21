import Link from 'next/link';
import { Home } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';

export default async function NotFound() {
  const t = await getTranslations('errors');
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <p className="text-center text-6xl font-extrabold tracking-tight text-muted-foreground" aria-hidden>
          404
        </p>
        <EmptyState
          state="sad"
          size="lg"
          className="pt-6"
          title={<span className="text-2xl">{t('notFoundTitle')}</span>}
          description={t('notFoundBody')}
          action={
            <Button asChild size="lg">
              <Link href="/dashboard">
                <Home className="h-[18px] w-[18px]" aria-hidden />
                {t('backToDashboard')}
              </Link>
            </Button>
          }
        />
      </div>
    </main>
  );
}
