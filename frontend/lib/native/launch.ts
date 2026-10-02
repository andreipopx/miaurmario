'use client';

import { SplashScreen } from '@capacitor/splash-screen';
import { hasNativeBridge } from '@/lib/native/app-shell';

/** Longest the launch screen may stay if nothing says the app is ready. */
export const LAUNCH_SCREEN_MAX_MS = 6000;

let hidden = false;

/**
 * The first real screen is on display: drop the native launch screen (Stinky
 * on pink). Until then it stays, so the app never shows a blank WebView or
 * the screens it only passes through on the way to yours. Idempotent.
 */
export function markAppReady() {
  if (hidden || !hasNativeBridge()) return;
  hidden = true;
  void SplashScreen.hide({ fadeOutDuration: 200 }).catch(() => {});
}

/**
 * Screens the app only passes through at start: "/" (sent on to the
 * dashboard) and the dashboard while it checks who you are. Everything else
 * (login, onboarding, a magic link…) is where the user lands, so it's ready
 * as soon as it renders.
 */
export function launchWaitsFor(pathname: string): boolean {
  return pathname === '/' || pathname.startsWith('/dashboard');
}
