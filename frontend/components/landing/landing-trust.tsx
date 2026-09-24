import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Heart, Lock, Wallet } from 'lucide-react';

import { Wordmark } from '@/components/brand/wordmark';
import { StinkyAvatar } from '@/components/brand/stinky-avatar';
import { isInviteOnly, signupHref, type SignupMode } from '@/lib/signup-mode';
import { Button } from '@/components/ui/button';

const CARDS = [
  { id: 'price', icon: Wallet },
  { id: 'photos', icon: Lock },
  { id: 'who', icon: Heart },
] as const;

/** What it costs, what happens to your photos, who is behind it — plus the last CTA. */
export async function LandingTrust({ mode }: { mode: SignupMode }) {
  const t = await getTranslations('landing.trust');
  const tHero = await getTranslations('landing.hero');
  const tFooter = await getTranslations('landing.footer');

  return (
    <>
      <section aria-labelledby="landing-trust-title" className="px-4 py-14 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-5xl">
          <h2 id="landing-trust-title" className="text-balance text-[26px] sm:text-[32px]">
            {t('title')}
          </h2>

          <ul className="mt-8 grid gap-4 sm:grid-cols-3">
            {CARDS.map(({ id, icon: Icon }) => (
              <li key={id} className="rounded-lg bg-panel p-5">
                <Icon className="h-5 w-5 text-foreground" strokeWidth={1.75} aria-hidden />
                <h3 className="mt-3 text-balance text-[17px]">{t(`${id}Title`)}</h3>
                <p className="mt-1.5 text-pretty text-[15px] leading-relaxed text-muted-foreground">
                  {t(`${id}Body`)}
                </p>
              </li>
            ))}
          </ul>

          <div className="mt-10 flex flex-col items-center gap-4 rounded-[32px] bg-signature-soft px-5 py-10 text-center">
            <StinkyAvatar size={64} />
            <p className="max-w-md text-balance text-[17px] font-bold leading-snug">
              {isInviteOnly(mode) ? tHero('betaInviteOnly') : tHero('betaOpen')}
            </p>
            <Button asChild size="lg" className="h-[54px] w-full max-w-xs">
              <Link href={signupHref(mode)}>{tHero('signUp')}</Link>
            </Button>
          </div>
        </div>
      </section>

      <footer className="border-t border-border px-4 py-10 sm:px-6">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Wordmark className="text-[26px]" />
            <p className="mt-1 text-[14px] text-muted-foreground">{tFooter('tagline')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[14px] font-semibold">
            <Link
              href="/legal"
              className="rounded-sm underline underline-offset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {tFooter('legal')}
            </Link>
            <Link
              href="/login"
              className="rounded-sm underline underline-offset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {tFooter('signIn')}
            </Link>
          </div>
        </div>
        <p className="mx-auto mt-6 max-w-5xl text-pretty text-[13px] leading-relaxed text-muted-foreground">
          {tFooter('detail')}
        </p>
      </footer>
    </>
  );
}
