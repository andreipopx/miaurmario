import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { Button } from '@/components/ui/button';
import { Wordmark } from '@/components/brand/wordmark';

const CONTACT = 'hola@andreipop.org';

// Each section: title key + number of body paragraphs (legal.sections.<id>.p1..pN).
const SECTIONS = [
  { id: 'who', paragraphs: 1 },
  { id: 'data', paragraphs: 5 },
  { id: 'purpose', paragraphs: 2 },
  { id: 'sharing', paragraphs: 3 },
  { id: 'retention', paragraphs: 1 },
  { id: 'rights', paragraphs: 1 },
  { id: 'terms', paragraphs: 1 },
] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('legal');
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
  };
}

export default async function LegalPage() {
  const t = await getTranslations('legal');

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="flex items-center justify-between gap-4">
        <Link
          href="/login"
          aria-label={t('back')}
          className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Wordmark className="text-[26px]" />
        </Link>
      </div>

      <header className="mt-8 space-y-2">
        <p className="eyebrow">{t('eyebrow')}</p>
        <h1 className="text-[28px] font-extrabold leading-tight tracking-[-0.02em] sm:text-4xl">
          {t('title')}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t('updated', { date: t('updatedDate') })}
        </p>
      </header>

      <div className="mt-8 space-y-4">
        {SECTIONS.map((s) => (
          <section key={s.id} className="space-y-3 rounded-lg bg-panel p-5 sm:p-6">
            <h2 className="text-lg font-bold">{t(`sections.${s.id}.title`)}</h2>
            {Array.from({ length: s.paragraphs }, (_, i) => (
              <p key={i} className="text-[15px] leading-relaxed text-muted-foreground">
                {t(`sections.${s.id}.p${i + 1}`, { contact: CONTACT })}
              </p>
            ))}
          </section>
        ))}
      </div>

      <footer className="mt-10">
        <Button asChild variant="secondary">
          <Link href="/login">
            <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
            {t('back')}
          </Link>
        </Button>
      </footer>
    </main>
  );
}
