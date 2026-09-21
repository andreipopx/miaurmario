import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { Stinky } from '@/components/stinky/stinky';
import { Wordmark } from '@/components/brand/wordmark';

export default async function Home() {
  const t = await getTranslations('login');
  const tCommon = await getTranslations('common');
  return (
    <main className="flex min-h-screen flex-col bg-background">
      <section className="flex flex-1 flex-col items-center justify-center gap-2 rounded-b-[40px] bg-signature px-6 py-12 text-signature-foreground">
        <div className="flex h-[200px] w-[200px] items-center justify-center rounded-full bg-white">
          <Stinky state="wave" size={176} variant="light" label="" />
        </div>
        <h1 className="mt-4">
          <Wordmark className="text-[44px] text-signature-foreground" />
        </h1>
        <p className="text-base font-semibold opacity-85">{t('tagline')}</p>
      </section>
      <div className="mx-auto w-full max-w-md px-6 py-10">
        <Button asChild size="lg" className="h-[54px] w-full">
          <Link href="/dashboard">{tCommon('signIn')}</Link>
        </Button>
      </div>
    </main>
  );
}
