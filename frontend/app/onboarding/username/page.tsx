'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Wordmark } from '@/components/brand/wordmark';
import { Stinky } from '@/components/stinky/stinky';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/hooks/use-auth';

const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;

type Availability = 'idle' | 'checking' | 'available' | 'taken' | 'format';

export default function UsernameOnboardingPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useTranslations('onboarding.username');
  const { user, isLoading } = useAuth();

  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [availability, setAvailability] = useState<Availability>('idle');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && user?.username) {
      router.replace('/onboarding');
    }
  }, [isLoading, user?.username, router]);

  const check = async (value: string) => {
    if (!USERNAME_REGEX.test(value)) {
      setAvailability('format');
      return;
    }
    setAvailability('checking');
    try {
      const res = await api.get<{ available: boolean; reason?: string }>(
        `/users/me/username-available?value=${encodeURIComponent(value)}`,
      );
      setAvailability(res.available ? 'available' : 'taken');
    } catch {
      setAvailability('idle');
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!USERNAME_REGEX.test(username)) {
      setError(t('formatError'));
      return;
    }
    setSubmitting(true);
    try {
      await api.patch('/users/me', { username, bio: bio || null });
      // Refresh the cached user before navigating: /onboarding reads ['auth-user']
      // and would bounce straight back here while it still lacks a username.
      await queryClient.refetchQueries({ queryKey: ['auth-user'] });
      router.replace('/onboarding');
    } catch (err: any) {
      if (err?.status === 409) setError(t('takenError'));
      else setError(t('genericError'));
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const hintId = 'username-hint';
  const statusId = 'username-status';

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="flex min-h-screen items-center justify-center px-4 py-12 sm:px-6">
        <div className="w-full max-w-md">
          <header className="mb-8 flex flex-col items-center text-center">
            <Wordmark className="text-[28px]" />
            <div className="mt-6 flex h-36 w-36 items-center justify-center rounded-full bg-signature-soft">
              <Stinky state="wave" size={124} label="" />
            </div>
            <h1 className="mt-6 text-[28px] font-extrabold leading-tight tracking-[-0.02em] sm:text-3xl">
              {t('title')}
            </h1>
            <p className="mt-2 max-w-sm text-[15px] leading-snug text-muted-foreground">
              {t('subtitle')}
            </p>
          </header>

          <form onSubmit={submit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="username" className="block font-bold">
                {t('usernameLabel')}
              </Label>
              <div className="relative">
                <span
                  aria-hidden
                  className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-base font-semibold text-muted-foreground"
                >
                  @
                </span>
                <Input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => {
                    const v = e.target.value.toLowerCase();
                    setUsername(v);
                    setAvailability('idle');
                  }}
                  onBlur={() => username && check(username)}
                  placeholder="stinky_gato"
                  autoComplete="off"
                  autoCapitalize="none"
                  aria-describedby={`${statusId} ${hintId}`}
                  aria-invalid={availability === 'taken' || availability === 'format' || undefined}
                  className="pl-10"
                />
              </div>
              <div id={statusId} aria-live="polite" className="px-1">
                {availability === 'checking' && (
                  <p className="text-xs text-muted-foreground">{t('checking')}</p>
                )}
                {availability === 'available' && (
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-success">
                    <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                    {t('available')}
                  </p>
                )}
                {availability === 'taken' && (
                  <p className="text-xs font-semibold text-destructive">{t('takenError')}</p>
                )}
                {availability === 'format' && (
                  <p className="text-xs font-semibold text-destructive">{t('formatError')}</p>
                )}
              </div>
              <p id={hintId} className="px-1 text-xs text-muted-foreground">{t('rulesHint')}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bio" className="block font-bold">
                {t('bioLabel')}
              </Label>
              <Textarea
                id="bio"
                value={bio}
                maxLength={280}
                onChange={(e) => setBio(e.target.value)}
                placeholder={t('bioPlaceholder')}
                rows={3}
              />
            </div>

            {error && (
              <p role="alert" className="text-sm font-semibold text-destructive">
                {error}
              </p>
            )}

            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={submitting || availability === 'taken' || availability === 'format'}
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : t('continue')}
            </Button>
          </form>
        </div>
      </div>
    </main>
  );
}
