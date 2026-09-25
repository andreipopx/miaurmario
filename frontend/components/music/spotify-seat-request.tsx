'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Ticket } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { useSpotifySeatRequest } from '@/lib/hooks/use-spotify';

/** Anything with an @ and a dot after it — the backend does the real validation. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Asks the site admins to add this Spotify account to the app's allowlist
 * (Development Mode caps the app at a handful of manually added accounts).
 * Nothing is stored: the address only travels in the alert.
 */
export function SpotifySeatRequest({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const t = useTranslations('integrations.spotify.seat');
  const [open, setOpen] = useState(defaultOpen);
  const [email, setEmail] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [done, setDone] = useState(false);
  const request = useSpotifySeatRequest();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (!EMAIL_RE.test(value)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    request.mutate(value, { onSuccess: () => setDone(true) });
  };

  if (done) {
    return (
      <Alert variant="signature" role="status">
        <AlertTitle>{t('doneTitle')}</AlertTitle>
        <AlertDescription className="text-foreground/80">{t('doneBody')}</AlertDescription>
      </Alert>
    );
  }

  const rateLimited = request.error instanceof ApiError && request.error.status === 429;
  const errorMessage = invalid
    ? t('emailInvalid')
    : rateLimited
      ? t('rateLimited')
      : request.isError
        ? t('error')
        : null;

  return (
    <section aria-labelledby="spotify-seat-title" className="space-y-2 rounded-quick bg-panel p-4">
      <p id="spotify-seat-title" className="flex items-center gap-2 text-sm font-bold">
        <Ticket className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
        {t('title')}
      </p>
      <p className="text-sm leading-snug text-muted-foreground">{t('body')}</p>

      {!open ? (
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          {t('open')}
        </Button>
      ) : (
        <form onSubmit={submit} className="space-y-2 pt-1" noValidate>
          <Label htmlFor="spotify-seat-email" className="text-[15px] font-bold">
            {t('emailLabel')}
          </Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="spotify-seat-email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setInvalid(false);
              }}
              placeholder={t('emailPlaceholder')}
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={254}
              aria-invalid={Boolean(errorMessage)}
              aria-describedby="spotify-seat-help"
              className="bg-background sm:flex-1"
            />
            <Button type="submit" disabled={request.isPending || !email.trim()}>
              {request.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {t('submit')}
            </Button>
          </div>
          <p id="spotify-seat-help" className="text-xs text-muted-foreground">
            {t('emailHelp')}
          </p>
          {errorMessage && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {errorMessage}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
