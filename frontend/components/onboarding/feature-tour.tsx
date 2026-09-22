'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { toast } from 'sonner';
import { BellRing, CheckCircle2, ChevronLeft, Download, Loader2, Smartphone } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Stinky } from '@/components/stinky/stinky';
import type { StinkyStateInput } from '@/components/stinky/stinky-states';
import { usePrefersReducedMotion } from '@/components/stinky/use-stinky-env';
import { useNotificationPreferences } from '@/lib/hooks/use-notifications';
import { readLocalSeen, useSeenTips, useTourRequests } from '@/lib/hooks/use-seen-tips';
import { TOUR_KEY, shouldAutoOpenTour, skipAllKeys } from '@/lib/onboarding/first-run';
import { useInstallPrompt } from '@/lib/pwa/install-prompt';
import { isStandalone } from '@/lib/pwa/platform';
import { usePushDevice } from '@/lib/pwa/use-push-device';
import { cn } from '@/lib/utils';

export interface TourSlide {
  key: 'upload' | 'day' | 'stylist' | 'inspo' | 'install';
  stinky: StinkyStateInput;
  /** Soft pop colour behind Stinky on this card. */
  tint: string;
}

export const TOUR_SLIDES: readonly TourSlide[] = [
  // The pop tokens are plain CSS vars, so Tailwind's /25 alpha can't apply: mix instead.
  { key: 'upload', stinky: 'wave', tint: 'bg-[color-mix(in_srgb,var(--pop-amber)_28%,var(--background))]' },
  { key: 'day', stinky: 'thinking', tint: 'bg-[color-mix(in_srgb,var(--pop-sky)_28%,var(--background))]' },
  { key: 'stylist', stinky: 'happy', tint: 'bg-signature-soft' },
  { key: 'inspo', stinky: 'purr', tint: 'bg-[color-mix(in_srgb,var(--pop-mint)_28%,var(--background))]' },
  { key: 'install', stinky: 'sleepy', tint: 'bg-[color-mix(in_srgb,var(--pop-pink)_28%,var(--background))]' },
];

// React 18 has no `inert` prop yet; an unknown lowercase attribute passes through.
const INERT = { inert: '' } as unknown as React.HTMLAttributes<HTMLDivElement>;

/** Install / push actions on the last card, reusing the install-prompt and push hooks. */
function InstallActions({ onLeave }: { onLeave: () => void }) {
  const t = useTranslations('firstRun.tour.install');
  const { data: prefs } = useNotificationPreferences();
  const device = usePushDevice(prefs?.vapid_public_key);
  const { canPrompt, promptInstall } = useInstallPrompt();
  const [standalone, setStandalone] = useState(false);
  useEffect(() => setStandalone(isStandalone()), []);

  const enable = async () => {
    const result = await device.enable();
    if (result === 'granted') toast.success(t('enabledToast'));
    else if (result === 'denied') toast.error(t('deniedToast'));
    else if (result === 'error') toast.error(t('errorToast'));
  };

  const guide = (
    <Button asChild variant="outline" className="w-full">
      <Link href="/dashboard/install" onClick={onLeave}>
        <Smartphone className="h-4 w-4" strokeWidth={1.75} aria-hidden />
        {t('guide')}
      </Link>
    </Button>
  );

  let push: React.ReactNode = null;
  if (device.support === 'needs-install') {
    // iPhone/iPad in a Safari tab: push only works from the home-screen app.
    push = <p className="text-center text-[13px] text-muted-foreground">{t('iosNeedsInstall')}</p>;
  } else if (device.support === 'supported' && prefs?.push_available && prefs.vapid_public_key) {
    if (device.subscribed && device.permission === 'granted') {
      push = (
        <p className="flex items-center justify-center gap-2 text-center text-sm font-semibold">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-pop-mint" strokeWidth={2} aria-hidden />
          {t('pushOn')}
        </p>
      );
    } else if (device.permission === 'denied') {
      push = <p className="text-center text-[13px] text-muted-foreground">{t('pushBlocked')}</p>;
    } else {
      push = (
        <Button variant="signature" className="w-full" onClick={enable} disabled={device.busy}>
          {device.busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <BellRing className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          )}
          {t('enablePush')}
        </Button>
      );
    }
  }

  return (
    <div className="mt-4 flex w-full flex-col items-stretch gap-2">
      {!standalone && canPrompt && (
        <Button className="w-full" onClick={() => void promptInstall()}>
          <Download className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          {t('installNow')}
        </Button>
      )}
      {push}
      {!standalone && guide}
    </div>
  );
}

/**
 * Welcome tour: five swipeable cards with an animated Stinky. Opens by itself
 * once (after onboarding / on an existing user's next visit) and again from the
 * profile menu ("Cómo funciona"). "Saltar todo" also silences the area tips.
 */
export function FeatureTour() {
  const t = useTranslations('firstRun.tour');
  const { user, local, markSeen } = useSeenTips();
  const requests = useTourRequests();
  const reducedMotion = usePrefersReducedMotion();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const autoOpened = useRef(false);
  const lastRequest = useRef(requests);
  const scroller = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  // While a button/dot scrolls the cards, ignore the in-between positions so
  // Stinky does not flick through every state on the way.
  const scrollingTo = useRef<number | null>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout>>();

  // Once per load: the first time the rules say so.
  useEffect(() => {
    // Read storage directly: `local` may not have caught up on the first render.
    if (autoOpened.current || !shouldAutoOpenTour(user, [...local, ...readLocalSeen(user?.id)])) return;
    autoOpened.current = true;
    setIndex(0);
    setOpen(true);
  }, [user, local]);

  // "Cómo funciona" from the profile menu.
  useEffect(() => {
    if (requests === lastRequest.current) return;
    lastRequest.current = requests;
    setIndex(0);
    setOpen(true);
  }, [requests]);

  const last = TOUR_SLIDES.length - 1;

  const goTo = useCallback(
    (i: number) => {
      const next = Math.max(0, Math.min(last, i));
      setIndex(next);
      const el = scroller.current;
      if (!el) return;
      scrollingTo.current = next;
      clearTimeout(scrollTimer.current);
      scrollTimer.current = setTimeout(() => (scrollingTo.current = null), 700);
      el.scrollTo({ left: next * el.clientWidth, behavior: reducedMotion ? 'auto' : 'smooth' });
    },
    [last, reducedMotion]
  );

  // Swiping (native scroll-snap) moves the index; the buttons/dots move the scroller.
  const onScroll = () => {
    const el = scroller.current;
    if (!el || el.clientWidth === 0) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    if (scrollingTo.current !== null) {
      if (i === scrollingTo.current) scrollingTo.current = null;
      return;
    }
    if (i !== index) setIndex(Math.max(0, Math.min(last, i)));
  };

  // Re-opening starts at the first card.
  useEffect(() => {
    if (open) requestAnimationFrame(() => scroller.current?.scrollTo({ left: 0 }));
  }, [open]);

  useEffect(() => () => clearTimeout(scrollTimer.current), []);

  const finish = () => {
    markSeen([TOUR_KEY]);
    setOpen(false);
  };
  const skipAll = () => {
    markSeen(skipAllKeys());
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      goTo(index + 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      goTo(index - 1);
    }
  };

  const slide = TOUR_SLIDES[index];

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => (o ? setOpen(true) : finish())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[90] bg-black/50 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onKeyDown={onKeyDown}
          onPointerDownOutside={(e) => e.preventDefault()}
          // Start on the main button (Enter walks the tour), not on "Saltar todo".
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            primary.current?.focus({ preventScroll: true });
          }}
          className={cn(
            'fixed left-1/2 top-1/2 z-[90] flex max-h-[calc(100dvh-1.5rem)] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-lg bg-background shadow-[0_20px_60px_rgba(0,0,0,0.25)] focus:outline-none',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 motion-reduce:animate-none'
          )}
        >
          <DialogPrimitive.Title className="sr-only">{t('dialogLabel')}</DialogPrimitive.Title>

          <div className="flex items-center justify-between gap-2 px-4 pt-3">
            <span className="min-w-0 truncate text-[13px] font-semibold text-muted-foreground" aria-live="polite">
              {t('stepOf', { current: index + 1, total: TOUR_SLIDES.length })}
            </span>
            <button
              type="button"
              onClick={skipAll}
              className="-mr-2 min-h-[44px] shrink-0 rounded-full px-3 text-sm font-semibold text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t('skip')}
            </button>
          </div>

          {/* One Stinky for the whole tour: it splices seamlessly into each card's state. */}
          <div className="flex justify-center px-4 pt-1">
            <div
              className={cn(
                'flex h-32 w-32 items-center justify-center rounded-full transition-colors duration-300 motion-reduce:transition-none',
                slide.tint
              )}
            >
              <Stinky state={slide.stinky} settleTo="idle" size={112} interactive={false} label="" />
            </div>
          </div>

          <div
            ref={scroller}
            onScroll={onScroll}
            className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            data-testid="tour-scroller"
          >
            {TOUR_SLIDES.map((s, i) => (
              <div
                key={s.key}
                // Off-screen cards are inert: no focus, no screen-reader noise.
                {...(i !== index ? INERT : {})}
                role="group"
                aria-roledescription="slide"
                aria-label={t('stepOf', { current: i + 1, total: TOUR_SLIDES.length })}
                aria-hidden={i !== index}
                className="flex w-full shrink-0 snap-center flex-col items-center px-6 pb-2 pt-4 text-center"
              >
                <h2 className="text-[22px] font-extrabold leading-tight tracking-tight">{t(`slides.${s.key}.title`)}</h2>
                <p className="mt-2 max-w-xs text-[15px] leading-snug text-muted-foreground">{t(`slides.${s.key}.body`)}</p>
                {s.key === 'install' && open && <InstallActions onLeave={finish} />}
              </div>
            ))}
          </div>

          <div className="px-4 pb-4 pt-2">
            <div className="flex justify-center gap-1.5 py-2">
              {TOUR_SLIDES.map((s, i) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => goTo(i)}
                  aria-label={t('goTo', { n: i + 1 })}
                  aria-current={i === index ? 'step' : undefined}
                  className="flex h-6 w-6 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span
                    className={cn(
                      'block h-2 rounded-full transition-all duration-200 motion-reduce:transition-none',
                      i === index ? 'w-5 bg-foreground' : 'w-2 bg-border'
                    )}
                  />
                </button>
              ))}
            </div>
            <div className="mt-1 flex items-center gap-2">
              {index > 0 && (
                <Button variant="ghost" size="icon" onClick={() => goTo(index - 1)} aria-label={t('back')} className="shrink-0">
                  <ChevronLeft className="h-5 w-5" strokeWidth={2} aria-hidden />
                </Button>
              )}
              {/* One button that changes role, so keyboard focus stays on it through the tour. */}
              <Button
                ref={primary}
                variant={index < last ? 'default' : 'signature'}
                className="min-w-0 flex-1"
                onClick={index < last ? () => goTo(index + 1) : finish}
              >
                {index < last ? t('next') : t('done')}
              </Button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
