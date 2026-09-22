'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Stinky } from '@/components/stinky/stinky';

type Scope = 'friend_request' | 'friend_accepted' | 'daily_outfit' | 'all';
type State =
  | { kind: 'working' }
  | { kind: 'done'; scope: Scope; subscribed: boolean }
  | { kind: 'error' };

async function post(token: string, extra: { all?: boolean; resubscribe?: boolean } = {}) {
  const res = await fetch('/api/v1/notifications/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, ...extra }),
  });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as { scope: Scope; subscribed: boolean };
}

/**
 * One-click unsubscribe from notification emails, no login. Opening the page
 * does it (the email link lands here); link scanners that only fetch HTML
 * never run this, so they can't unsubscribe anybody.
 */
function UnsubscribeContent() {
  const t = useTranslations('unsubscribe');
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<State>({ kind: 'working' });
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  const run = useCallback(
    async (extra: { all?: boolean; resubscribe?: boolean } = {}) => {
      setBusy(true);
      try {
        const r = await post(token, extra);
        setState({ kind: 'done', scope: r.scope, subscribed: r.subscribed });
      } catch {
        setState({ kind: 'error' });
      } finally {
        setBusy(false);
      }
    },
    [token]
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!token) setState({ kind: 'error' });
    else void run();
  }, [token, run]);

  let title: string;
  let body: string;
  if (state.kind === 'working') {
    title = t('working');
    body = '';
  } else if (state.kind === 'error') {
    title = t('errorTitle');
    body = t('errorBody');
  } else if (state.subscribed) {
    title = t('resubscribedTitle');
    body = t(`scopes.${state.scope}`);
  } else {
    title = t('doneTitle');
    body = t('doneBody', { what: t(`scopes.${state.scope}`) });
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md space-y-6 rounded-lg bg-card p-6 text-center shadow-sm sm:p-8">
        <div className="flex justify-center">
          <Stinky
            state={state.kind === 'error' ? 'sleepy' : state.kind === 'working' ? 'thinking' : 'wave'}
            size={112}
            label=""
          />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-extrabold tracking-[-0.02em]">{title}</h1>
          {body && <p className="text-[15px] text-muted-foreground">{body}</p>}
        </div>

        {state.kind === 'working' && (
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
        )}

        {state.kind === 'done' && (
          <div className="flex flex-col items-center gap-2">
            {!state.subscribed && state.scope !== 'all' && (
              <Button variant="outline" onClick={() => run({ all: true })} disabled={busy}>
                {t('allButton')}
              </Button>
            )}
            {!state.subscribed && (
              <Button variant="ghost" onClick={() => run({ resubscribe: true, all: state.scope === 'all' })} disabled={busy}>
                {t('undoButton')}
              </Button>
            )}
            <p className="pt-2 text-xs text-muted-foreground">{t('pushNote')}</p>
          </div>
        )}

        <Button asChild variant="signature">
          <Link href="/dashboard/notifications">{t('manage')}</Link>
        </Button>
      </div>
    </main>
  );
}

export default function UnsubscribePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
        </div>
      }
    >
      <UnsubscribeContent />
    </Suspense>
  );
}
