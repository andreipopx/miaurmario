'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2, Sparkles } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { WAITLIST_MESSAGE_MAX } from '@/lib/admin';

/**
 * Closed-beta notice + waitlist form on the login page (signup mode invite_only).
 * The backend always answers the same way, so "done" never says whether the
 * email already had an account or was already on the list.
 */
export function WaitlistCard({ email: typedEmail, defaultOpen = false }: { email?: string; defaultOpen?: boolean }) {
  const t = useTranslations('login.waitlist');
  const locale = useLocale();
  const [open, setOpen] = useState(defaultOpen);
  const [email, setEmail] = useState(typedEmail ?? '');
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefill with whatever was typed in the sign-in form, until the user edits it here.
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!touched && typedEmail !== undefined) setEmail(typedEmail);
  }, [typedEmail, touched]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/v1/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          name: name.trim() || null,
          message: message.trim() || null,
          locale: locale === 'en' ? 'en' : 'es',
        }),
      });
      if (res.status === 202 || res.status === 200) setDone(true);
      else if (res.status === 429) setError(t('rateLimited'));
      else setError(t('error'));
    } catch {
      setError(t('error'));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Alert variant="signature" role="status">
        <AlertTitle>{t('doneTitle')}</AlertTitle>
        <AlertDescription className="text-foreground/80">{t('doneBody')}</AlertDescription>
      </Alert>
    );
  }

  return (
    <section aria-labelledby="waitlist-title" className="rounded-lg bg-signature-soft p-4">
      <h2 id="waitlist-title" className="text-[17px] font-bold leading-tight">
        {t('title')}
      </h2>
      <p className="mt-1 text-sm text-foreground/80">{t('body')}</p>

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 inline-flex min-h-[44px] items-center gap-2 text-[15px] font-bold underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Sparkles className="h-4 w-4" aria-hidden />
          {t('link')}
        </button>
      ) : (
        <form onSubmit={submit} className="mt-3 space-y-3">
          <p className="text-sm font-bold">{t('formTitle')}</p>
          <div className="space-y-1.5">
            <label htmlFor="wl-email" className="block px-1 text-sm font-bold">
              {t('emailLabel')}
            </label>
            <Input
              id="wl-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setTouched(true);
                setEmail(e.target.value);
              }}
              className="h-[54px] bg-background px-[22px] text-base"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="wl-name" className="block px-1 text-sm font-bold">
              {t('nameLabel')}
            </label>
            <Input
              id="wl-name"
              autoComplete="name"
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('namePlaceholder')}
              className="h-[54px] bg-background px-[22px] text-base"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="wl-message" className="block px-1 text-sm font-bold">
              {t('messageLabel')}
            </label>
            <Textarea
              id="wl-message"
              maxLength={WAITLIST_MESSAGE_MAX}
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t('messagePlaceholder')}
              aria-describedby="wl-message-count"
              className="bg-background text-base"
            />
            <p id="wl-message-count" className="px-1 text-right text-xs tabular-nums text-muted-foreground">
              {t('counter', { count: message.length, max: WAITLIST_MESSAGE_MAX })}
            </p>
          </div>
          {error && (
            <p role="alert" className="px-1 text-sm font-medium text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="lg" disabled={busy} className="h-[54px] flex-1">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t('submit')}
            </Button>
            <Button type="button" size="lg" variant="ghost" className="h-[54px]" onClick={() => setOpen(false)}>
              {t('cancel')}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
