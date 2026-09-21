'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
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
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="flex min-h-screen items-center justify-center px-6 py-16">
        <div className="w-full max-w-md">
          <header className="text-center mb-10">
            <h1 className="font-display italic font-black text-4xl leading-none">{t('title')}</h1>
            <div className="h-px w-16 bg-gold mx-auto mt-6" />
            <p className="font-editorial italic text-base text-muted-foreground mt-6">
              {t('subtitle')}
            </p>
          </header>

          <form onSubmit={submit} className="space-y-8">
            <div className="space-y-2">
              <label htmlFor="username" className="label-editorial block">
                {t('usernameLabel')}
              </label>
              <input
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
                className="w-full h-11 border-0 border-b border-border-solid/60 bg-transparent px-1 py-2 text-base font-body focus:outline-none focus:border-primary transition-colors"
              />
              {availability === 'checking' && (
                <p className="text-xs text-muted-foreground">{t('checking')}</p>
              )}
              {availability === 'available' && (
                <p className="text-xs text-gold">{t('available')}</p>
              )}
              {availability === 'taken' && (
                <p className="text-xs text-destructive">{t('takenError')}</p>
              )}
              {availability === 'format' && (
                <p className="text-xs text-destructive">{t('formatError')}</p>
              )}
              <p className="text-xs text-muted-foreground italic">{t('rulesHint')}</p>
            </div>

            <div className="space-y-2">
              <label htmlFor="bio" className="label-editorial block">
                {t('bioLabel')}
              </label>
              <textarea
                id="bio"
                value={bio}
                maxLength={280}
                onChange={(e) => setBio(e.target.value)}
                placeholder={t('bioPlaceholder')}
                rows={3}
                className="w-full border border-border-solid/60 bg-transparent px-3 py-2 text-sm font-body focus:outline-none focus:border-primary transition-colors"
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <button
              type="submit"
              disabled={submitting || availability === 'taken' || availability === 'format'}
              className="w-full h-12 bg-primary text-primary-foreground border border-primary uppercase tracking-widest text-xs hover:bg-transparent hover:text-primary transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : t('continue')}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
