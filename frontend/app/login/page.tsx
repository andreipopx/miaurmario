'use client';

import { Suspense, useEffect, useState } from 'react';
import { signIn, getProviders, useSession } from 'next-auth/react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Mail } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { LanguageSwitcher, SHOW_LANGUAGE_SWITCHER } from '@/components/language-switcher';
import { safeCallbackPath } from '@/lib/magic-link';
import { inviteFromSearch } from '@/lib/admin';
import { LoginMethods } from '@/components/auth/login-methods';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Stinky } from '@/components/stinky/stinky';
import { Wordmark } from '@/components/brand/wordmark';

function OIDCLoginButton({ callbackUrl }: { callbackUrl: string }) {
  const t = useTranslations('common');
  return (
    <Button size="lg" className="w-full" onClick={() => signIn('oidc', { callbackUrl })}>
      {t('signIn')}
    </Button>
  );
}

function DevLogin({ callbackUrl }: { callbackUrl: string }) {
  const t = useTranslations('login');
  const tCommon = useTranslations('common');
  const [email, setEmail] = useState('dev@wardrobe.local');
  const [name, setName] = useState('Dev User');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    await signIn('dev-credentials', { email, name, callbackUrl });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Alert variant="signature">
        <AlertDescription className="font-semibold text-foreground">{t('devBanner')}</AlertDescription>
      </Alert>

      <div className="space-y-2">
        <label htmlFor="email" className="block px-1 text-sm font-bold">{t('emailLabel')}</label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          placeholder={t('emailPlaceholder')}
          className="h-[54px] px-[22px] text-base"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="name" className="block px-1 text-sm font-bold">{t('nameLabel')}</label>
        <Input
          id="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('namePlaceholder')}
          className="h-[54px] px-[22px] text-base"
        />
      </div>

      <Button type="submit" size="lg" disabled={isLoading} className="h-[54px] w-full">
        {isLoading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {tCommon('signingIn')}
          </>
        ) : (
          tCommon('signIn')
        )}
      </Button>
    </form>
  );
}

function MagicLinkForm({ invite }: { invite: string | null }) {
  const t = useTranslations('login.magicLink');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [closedBeta, setClosedBeta] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setClosedBeta(false);
    setIsLoading(true);
    try {
      const res = await fetch('/api/v1/auth/magic-link/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invite ? { email, locale, invite } : { email, locale }),
      });
      if (res.status === 202 || res.status === 200) {
        setSent(true);
      } else if (res.status === 403) {
        const data = await res.json().catch(() => ({}));
        const code = data?.detail?.code;
        if (code === 'invite_invalid') setErrorMsg(t('inviteInvalid'));
        else if (code === 'invite_required') setClosedBeta(true);
        else setErrorMsg(t('genericError'));
      } else if (res.status === 429) {
        setErrorMsg(t('rateLimited'));
      } else {
        setErrorMsg(t('genericError'));
      }
    } catch {
      setErrorMsg(t('genericError'));
    } finally {
      setIsLoading(false);
    }
  };

  if (sent) {
    return (
      <Alert variant="signature" role="status">
        <AlertTitle>{t('sentTitle')}</AlertTitle>
        <AlertDescription className="text-foreground/80">{t('sentBody')}</AlertDescription>
      </Alert>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {invite && (
        <Alert variant="signature" role="status">
          <AlertDescription className="font-semibold text-foreground">{t('invited')}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-3">
        <label htmlFor="ml-email" className="block px-1 text-sm font-bold">
          {t('emailLabel')}
        </label>
        <Input
          id="ml-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('emailPlaceholder')}
          className="h-[54px] px-[22px] text-base"
        />
      </div>
      {closedBeta && (
        <Alert role="alert">
          <AlertTitle>{t('closedBetaTitle')}</AlertTitle>
          <AlertDescription className="text-muted-foreground">{t('closedBetaBody')}</AlertDescription>
        </Alert>
      )}
      {errorMsg && (
        <p role="alert" className="px-1 text-sm font-medium text-destructive">
          {errorMsg}
        </p>
      )}
      <Button type="submit" size="lg" disabled={isLoading} className="h-[54px] w-full">
        {isLoading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {tCommon('signingIn')}
          </>
        ) : (
          <>
            <Mail className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
            {t('cta')}
          </>
        )}
      </Button>
    </form>
  );
}

function LoginAlert({ title, body }: { title: string; body: string }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="text-foreground/80">{body}</AlertDescription>
    </Alert>
  );
}

function LoginContent() {
  const t = useTranslations('login');
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data: session, status } = useSession();
  const error = searchParams.get('error');
  const syncErrorParam = searchParams.get('syncError');
  // Relative path only: an absolute callbackUrl may point at the other hostname
  // (LAN vs public) and router.push would send the user there.
  const callbackUrl = safeCallbackPath(searchParams.get('callbackUrl'));
  const invite = inviteFromSearch(searchParams.get('invite'));
  const [backendError, setBackendError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'authenticated' && session?.accessToken) {
      router.push(callbackUrl);
    }
  }, [status, session?.accessToken, callbackUrl, router]);

  useEffect(() => {
    fetch('/api/v1/auth/status')
      .then((res) => res.json())
      .then((data) => {
        if (!data.configured && data.error) {
          setBackendError(data.error);
        }
      })
      .catch(() => {
        setBackendError(t('backendErrorDefault'));
      });
  }, [t]);

  const syncError = syncErrorParam || session?.syncError;
  const [authMode, setAuthMode] = useState<'loading' | 'oidc' | 'dev' | 'unconfigured'>('loading');
  const [magicLinkEnabled, setMagicLinkEnabled] = useState(false);
  const [passwordEnabled, setPasswordEnabled] = useState(false);

  useEffect(() => {
    getProviders().then((providers) => {
      if (providers?.['oidc']) setAuthMode('oidc');
      else if (providers?.['dev-credentials']) setAuthMode('dev');
      else setAuthMode('unconfigured');
    });
    fetch('/api/v1/auth/config')
      .then((r) => r.json())
      .then((data) => {
        setMagicLinkEnabled(!!data?.magic_link?.enabled);
        setPasswordEnabled(!!data?.password?.enabled);
      })
      .catch(() => {});
  }, []);

  if (status === 'loading' || authMode === 'loading') {
    return (
      <div className="space-y-3 animate-pulse" aria-busy="true">
        <div className="h-5 w-40 rounded-full bg-panel" />
        <div className="h-[54px] rounded-full bg-panel" />
        <div className="h-[54px] rounded-full bg-panel" />
      </div>
    );
  }

  return (
    <>
      {backendError && <LoginAlert title={t('backendErrorTitle')} body={backendError} />}
      {!backendError && syncError && <LoginAlert title={t('backendErrorTitle')} body={syncError} />}

      {error && !backendError && !syncError && (
        <LoginAlert
          title={error.startsWith('MagicLink') ? t('errorMagicLinkTitle') : t('backendErrorTitle')}
          body={
            (error === 'OAuthSignin' && t('errorOAuthSignin')) ||
            (error === 'OAuthCallback' && t('errorOAuthCallback')) ||
            (error === 'OAuthCreateAccount' && t('errorOAuthCreateAccount')) ||
            (error === 'Callback' && t('errorCallback')) ||
            (error === 'CredentialsSignin' && t('errorCredentialsSignin')) ||
            (error === 'AccessDenied' && t('errorAccessDenied')) ||
            (error === 'undefined' && t('errorUndefined')) ||
            (error === 'MagicLinkInvalid' && t('errorMagicLinkInvalid')) ||
            (error === 'MagicLinkMissing' && t('errorMagicLinkMissing')) ||
            t('errorGeneric')
          }
        />
      )}

      <div className="space-y-4">
        <LoginMethods
          magicLink={magicLinkEnabled ? <MagicLinkForm invite={invite} /> : null}
          passwordEnabled={passwordEnabled}
          callbackUrl={callbackUrl}
        />
        {authMode === 'oidc' && <OIDCLoginButton callbackUrl={callbackUrl} />}
        {authMode === 'dev' && <DevLogin callbackUrl={callbackUrl} />}
        {authMode === 'unconfigured' && !magicLinkEnabled && (
          <Alert>
            <AlertTitle>{t('notConfiguredTitle')}</AlertTitle>
            <p className="text-sm text-muted-foreground">
              {t.rich('notConfiguredHint', {
                oidc: () => <code className="font-mono text-xs">OIDC_ISSUER_URL</code>,
                clientId: () => <code className="font-mono text-xs">OIDC_CLIENT_ID</code>,
                devMode: () => <code className="font-mono text-xs">DEV_MODE=true</code>,
              })}
            </p>
          </Alert>
        )}
      </div>
    </>
  );
}

export default function LoginPage() {
  const t = useTranslations('login');
  return (
    <main className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-2 lg:gap-4 lg:p-4">
      {/* Pink hero: Stinky waving + wordmark */}
      <section
        className="relative flex min-h-[440px] flex-col items-center justify-center gap-2 rounded-b-[40px] bg-signature px-6 pb-10 pt-[calc(2.5rem+env(safe-area-inset-top))] text-signature-foreground sm:min-h-[52vh] lg:min-h-0 lg:rounded-[40px]"
      >
        {SHOW_LANGUAGE_SWITCHER && (
          <div className="absolute right-4 top-[calc(1rem+env(safe-area-inset-top))]">
            <LanguageSwitcher variant="compact" />
          </div>
        )}
        <div className="flex h-[200px] w-[200px] items-center justify-center rounded-full bg-white lg:h-[260px] lg:w-[260px]">
          <Stinky state="wave" size={176} variant="light" label="" className="lg:!h-[228px] lg:!w-[228px]" />
        </div>
        <h1 className="mt-4">
          <Wordmark className="text-[44px] text-signature-foreground lg:text-6xl" />
        </h1>
        <p className="text-base font-semibold opacity-85 lg:text-lg">{t('tagline')}</p>
      </section>

      <div className="flex flex-col justify-center px-6 pb-10 pt-8 lg:px-12">
        <div className="mx-auto w-full max-w-md space-y-4">
          <Suspense fallback={<div className="h-[54px] animate-pulse rounded-full bg-panel" />}>
            <LoginContent />
          </Suspense>

          <footer className="pt-2 text-center text-[13px] leading-relaxed text-muted-foreground">
            <p>{t('noPasswords')}</p>
            <p>
              {t.rich('termsRich', {
                link: (chunks) => (
                  <Link
                    href="/legal"
                    className="font-semibold text-foreground underline underline-offset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                  >
                    {chunks}
                  </Link>
                ),
              })}
            </p>
          </footer>
        </div>
      </div>
    </main>
  );
}
