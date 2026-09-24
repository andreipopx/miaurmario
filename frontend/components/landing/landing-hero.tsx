import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { Stinky } from '@/components/stinky/stinky';
import { Wordmark } from '@/components/brand/wordmark';
import { Button } from '@/components/ui/button';
import { isInviteOnly, signupHref, type SignupMode } from '@/lib/signup-mode';

/**
 * Pink hero: what the thing is, in one line, plus the two doors — "Crear cuenta"
 * (ink pill) and "Iniciar sesión" (outline pill), clearly separated so nobody has
 * to guess which one is theirs.
 */
export async function LandingHero({ mode }: { mode: SignupMode }) {
  const t = await getTranslations('landing.hero');

  return (
    <section className="rounded-b-[40px] bg-signature px-4 pb-10 pt-[calc(2rem+env(safe-area-inset-top))] text-signature-foreground sm:px-6 sm:pb-14 sm:pt-12 lg:pb-20 lg:pt-16">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 text-center">
        <div className="flex h-[160px] w-[160px] shrink-0 items-center justify-center rounded-full bg-white sm:h-[196px] sm:w-[196px] lg:h-[228px] lg:w-[228px]">
          {/* variant="light": Stinky always sits on the same white circle, in either theme. */}
          <Stinky
            state="wave"
            size={140}
            variant="light"
            label=""
            className="sm:!h-[172px] sm:!w-[172px] lg:!h-[200px] lg:!w-[200px]"
          />
        </div>

        <Wordmark className="text-[38px] text-signature-foreground sm:text-[52px] lg:text-[62px]" />

        <h1 className="text-balance text-[23px] leading-[1.15] sm:text-[34px] lg:text-[42px]">{t('pitch')}</h1>

        <p className="max-w-xl text-pretty text-[15px] font-semibold leading-snug opacity-80 sm:text-[17px] lg:text-[19px]">
          {t('sub')}
        </p>

        <div className="flex w-full max-w-sm flex-col gap-3 pt-2 sm:max-w-none sm:flex-row sm:justify-center">
          <Button asChild size="lg" className="h-[54px] w-full sm:w-auto sm:min-w-[190px]">
            <Link href={signupHref(mode)}>{t('signUp')}</Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="h-[54px] w-full sm:w-auto sm:min-w-[190px]">
            <Link href="/login">{t('signIn')}</Link>
          </Button>
        </div>

        <p className="max-w-md text-pretty text-[14px] font-semibold leading-snug opacity-75">
          {isInviteOnly(mode) ? t('betaInviteOnly') : t('betaOpen')}
        </p>
      </div>
    </section>
  );
}
