'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { getSession, signIn } from 'next-auth/react';
import { KeyRound, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/auth/password-input';
import { magicLinkLanding } from '@/lib/magic-link';

// Mirrors PASSWORD_ERROR_* in lib/auth.ts (server-only module, not imported here).
const RATE_LIMITED = 'PasswordRateLimited';
const UNAVAILABLE = 'PasswordUnavailable';

export function PasswordLoginForm({ callbackUrl }: { callbackUrl: string }) {
  const t = useTranslations('login.password');
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      // redirect: false -> stay on whichever origin (LAN/public) the user is on.
      const result = await signIn('password', { identifier, password, redirect: false });
      if (!result?.ok || result.error) {
        setError(
          result?.error === RATE_LIMITED
            ? t('rateLimited')
            : result?.error === UNAVAILABLE
              ? t('unavailable')
              : t('invalid'),
        );
        setPassword('');
        return;
      }
      const session = await getSession();
      if (!session?.accessToken) {
        setError(t('unavailable'));
        return;
      }
      router.replace(magicLinkLanding(session, callbackUrl));
    } catch {
      setError(t('unavailable'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3" method="post">
      <div className="space-y-3">
        <Label htmlFor="pw-identifier" className="block px-1 text-sm font-bold">{t('identifierLabel')}</Label>
        <Input
          id="pw-identifier"
          name="username"
          type="text"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          maxLength={255}
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          placeholder={t('identifierPlaceholder')}
          className="h-[54px] px-[22px] text-base"
        />
      </div>
      <div className="space-y-3">
        <Label htmlFor="pw-password" className="block px-1 text-sm font-bold">{t('passwordLabel')}</Label>
        <PasswordInput
          id="pw-password"
          name="password"
          autoComplete="current-password"
          required
          maxLength={128}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          showLabel={t('show')}
          hideLabel={t('hide')}
          className="h-[54px] pl-[22px] text-base"
        />
      </div>
      {error && (
        <p role="alert" className="px-1 text-sm font-medium text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" className="h-[54px] w-full" disabled={isLoading}>
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <KeyRound className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
        )}
        {t('cta')}
      </Button>
      <p className="px-1 pt-1 text-[13px] leading-relaxed text-muted-foreground">{t('forgotHint')}</p>
    </form>
  );
}

/**
 * Login method switcher: the magic-link form stays primary; a text toggle
 * swaps it for the optional password form (and back).
 */
export function LoginMethods({
  magicLink,
  passwordEnabled,
  callbackUrl,
}: {
  magicLink: ReactNode;
  passwordEnabled: boolean;
  callbackUrl: string;
}) {
  const t = useTranslations('login.password');
  const [wantsPassword, setWantsPassword] = useState(false);

  if (!passwordEnabled) return <>{magicLink}</>;
  const showPassword = wantsPassword || !magicLink;

  return (
    <div className="space-y-4">
      {showPassword ? <PasswordLoginForm callbackUrl={callbackUrl} /> : magicLink}
      {magicLink && (
        <div className="text-center">
          <Button type="button" variant="link" className="text-sm font-semibold" onClick={() => setWantsPassword(!showPassword)}>
            {showPassword ? t('backToMagicLink') : t('toggle')}
          </Button>
        </div>
      )}
    </div>
  );
}
