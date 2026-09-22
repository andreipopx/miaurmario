'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Smartphone, X } from 'lucide-react';
import { currentPlatform, isMobilePlatform, isStandalone } from '@/lib/pwa/platform';

const DISMISSED_KEY = 'mm-install-hint-dismissed-v1';

function wasDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return true; // no storage (private mode...): don't nag on every load
  }
}

function markDismissed() {
  try {
    window.localStorage.setItem(DISMISSED_KEY, '1');
  } catch {
    /* ignore */
  }
}

/** One-time, dismissible "install the app" hint for mobile users in a browser tab. */
export function InstallHint() {
  const t = useTranslations('install.hint');
  const pathname = usePathname();
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(isMobilePlatform(currentPlatform()) && !isStandalone() && !wasDismissed());
  }, []);

  if (!show || pathname === '/dashboard/install') return null;

  const dismiss = () => {
    markDismissed();
    setShow(false);
  };

  return (
    <div role="status" className="mb-3 flex items-center gap-3 rounded-lg bg-signature-soft p-3 pl-4 text-sm">
      <Smartphone className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden />
      <p className="min-w-0 flex-1 font-medium">
        {t('text')}{' '}
        <Link href="/dashboard/install" onClick={markDismissed} className="font-bold underline underline-offset-2">
          {t('cta')}
        </Link>
      </p>
      <button
        type="button"
        onClick={dismiss}
        className="-my-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={t('dismiss')}
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
