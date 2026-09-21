'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { getSession, signIn } from 'next-auth/react';
import { Loader2 } from 'lucide-react';
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
    <form onSubmit={submit} className="space-y-6" method="post">
      <div className="space-y-2">
        <Label htmlFor="pw-identifier">{t('identifierLabel')}</Label>
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
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="pw-password">{t('passwordLabel')}</Label>
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
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full gap-2" disabled={isLoading}>
        {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
        {t('cta')}
      </Button>
      <p className="text-xs text-muted-foreground">{t('forgotHint')}</p>
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
          <Button type="button" variant="link" onClick={() => setWantsPassword(!showPassword)}>
            {showPassword ? t('backToMagicLink') : t('toggle')}
          </Button>
        </div>
      )}
    </div>
  );
}
