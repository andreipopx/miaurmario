'use client';

import { Suspense, useEffect, useState } from 'react';
import { signIn, getProviders, useSession } from 'next-auth/react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { LanguageSwitcher, SHOW_LANGUAGE_SWITCHER } from '@/components/language-switcher';
import { safeCallbackPath } from '@/lib/magic-link';
import { LoginMethods } from '@/components/auth/login-methods';

function ThemeButton() {
  const { theme, setTheme } = useTheme();
  const tCommon = useTranslations('common');
  return (
    <button
      type="button"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      aria-label={tCommon('toggleTheme')}
      className="h-9 min-w-[36px] px-2 label-editorial hover:text-primary transition-colors duration-200 ease-editorial"
    >
      {theme === 'dark' ? tCommon('lightMode') : tCommon('darkMode')}
    </button>
  );
}

function OIDCLoginButton({ callbackUrl }: { callbackUrl: string }) {
  const t = useTranslations('common');
  return (
    <button
      onClick={() => signIn('oidc', { callbackUrl })}
      className="w-full h-12 bg-primary text-primary-foreground border border-primary uppercase tracking-widest text-xs hover:bg-transparent hover:text-primary transition-all duration-200 ease-editorial"
    >
      {t('signIn')}
    </button>
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
    <form onSubmit={handleSubmit} className="space-y-8">
      <div className="border-l-2 border-l-gold px-4 py-3 bg-card">
        <p className="label-editorial text-gold">Preview</p>
        <p className="font-editorial italic text-sm text-foreground mt-1">{t('devBanner')}</p>
      </div>

      <div className="space-y-2">
        <label htmlFor="email" className="label-editorial block">{t('emailLabel')}</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          placeholder={t('emailPlaceholder')}
          className="w-full h-11 border-0 border-b border-border-solid/60 bg-transparent px-1 py-2 text-base text-foreground font-body placeholder:font-editorial placeholder:italic placeholder:text-muted-foreground/70 focus:outline-none focus:border-primary transition-colors duration-200 ease-editorial"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="name" className="label-editorial block">{t('nameLabel')}</label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('namePlaceholder')}
          className="w-full h-11 border-0 border-b border-border-solid/60 bg-transparent px-1 py-2 text-base text-foreground font-body placeholder:font-editorial placeholder:italic placeholder:text-muted-foreground/70 focus:outline-none focus:border-primary transition-colors duration-200 ease-editorial"
        />
      </div>

      <button
        type="submit"
        disabled={isLoading}
        className="w-full h-12 bg-primary text-primary-foreground border border-primary uppercase tracking-widest text-xs hover:bg-transparent hover:text-primary transition-all duration-200 ease-editorial disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {isLoading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            {tCommon('signingIn')}
          </>
        ) : (
          tCommon('signIn')
        )}
      </button>
    </form>
  );
}

function MagicLinkForm() {
  const t = useTranslations('login.magicLink');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsLoading(true);
    try {
      const res = await fetch('/api/v1/auth/magic-link/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, locale }),
      });
      if (res.status === 202 || res.status === 200) {
        setSent(true);
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
      <div className="border-l-2 border-l-gold px-4 py-4 bg-card">
        <p className="font-display text-base leading-tight mb-1">{t('sentTitle')}</p>
        <p className="text-sm text-muted-foreground">{t('sentBody')}</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="space-y-2">
        <label htmlFor="ml-email" className="label-editorial block">
          {t('emailLabel')}
        </label>
        <input
          id="ml-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('emailPlaceholder')}
          className="w-full h-11 border-0 border-b border-border-solid/60 bg-transparent px-1 py-2 text-base text-foreground font-body placeholder:font-editorial placeholder:italic placeholder:text-muted-foreground/70 focus:outline-none focus:border-primary transition-colors duration-200 ease-editorial"
        />
      </div>
      {errorMsg && <p className="text-sm text-destructive">{errorMsg}</p>}
      <button
        type="submit"
        disabled={isLoading}
        className="w-full h-12 bg-primary text-primary-foreground border border-primary uppercase tracking-widest text-xs hover:bg-transparent hover:text-primary transition-all duration-200 ease-editorial disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {isLoading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            {tCommon('signingIn')}
          </>
        ) : (
          t('cta')
        )}
      </button>
    </form>
  );
}

function EditorialAlert({ title, body }: { title: string; body: string }) {
  return (
    <div className="border-l-2 border-l-primary px-4 py-3 bg-card">
      <p className="font-display text-base leading-tight mb-1">{title}</p>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
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
      <div className="space-y-4 animate-pulse">
        <div className="h-12 bg-muted" />
      </div>
    );
  }

  return (
    <>
      {backendError && <EditorialAlert title={t('backendErrorTitle')} body={backendError} />}
      {!backendError && syncError && <EditorialAlert title={t('backendErrorTitle')} body={syncError} />}

      {error && !backendError && !syncError && (
        <EditorialAlert
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
          magicLink={magicLinkEnabled ? <MagicLinkForm /> : null}
          passwordEnabled={passwordEnabled}
          callbackUrl={callbackUrl}
        />
        {authMode === 'oidc' && <OIDCLoginButton callbackUrl={callbackUrl} />}
        {authMode === 'dev' && <DevLogin callbackUrl={callbackUrl} />}
        {authMode === 'unconfigured' && !magicLinkEnabled && (
          <div className="border-l-2 border-l-primary px-4 py-4 bg-card">
            <p className="font-display text-lg leading-tight mb-2">{t('notConfiguredTitle')}</p>
            <p className="text-sm text-muted-foreground">
              {t.rich('notConfiguredHint', {
                oidc: () => <code className="font-mono text-xs">OIDC_ISSUER_URL</code>,
                clientId: () => <code className="font-mono text-xs">OIDC_CLIENT_ID</code>,
                devMode: () => <code className="font-mono text-xs">DEV_MODE=true</code>,
              })}
            </p>
          </div>
        )}
      </div>
    </>
  );
}

export default function LoginPage() {
  const t = useTranslations('login');
  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Top-right utility strip */}
      <div className="absolute top-4 right-4 sm:top-6 sm:right-6 flex items-center gap-3 z-10">
        {SHOW_LANGUAGE_SWITCHER && (
          <>
            <LanguageSwitcher variant="compact" />
            <div className="h-4 w-px bg-border-solid/60" />
          </>
        )}
        <ThemeButton />
      </div>

      <div className="flex min-h-screen flex-col items-center justify-center px-6 py-16">
        <div className="w-full max-w-md">
          {/* Wordmark */}
          <header className="text-center mb-4">
            <h1 className="font-display italic font-black text-display-2xl leading-none">
              miaurmario
            </h1>
            <div className="h-px w-16 bg-gold mx-auto mt-6" />
            <p className="font-editorial italic text-xl text-muted-foreground mt-6">
              {t('tagline')}
            </p>
          </header>

          <div className="mt-14 space-y-6">
            <Suspense fallback={<div className="animate-pulse h-12 bg-muted" />}>
              <LoginContent />
            </Suspense>
          </div>

          <footer className="mt-16 text-center">
            <p className="label-editorial">{t('terms')}</p>
          </footer>
        </div>
      </div>
    </main>
  );
}
