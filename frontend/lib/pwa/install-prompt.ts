'use client';

import { useEffect, useSyncExternalStore } from 'react';

/**
 * Android Chrome (and desktop Chromium) fire `beforeinstallprompt` once, early.
 * We keep the event so an "Instalar" button can show the native prompt later,
 * from a user tap. Listening starts at module load of the first importer.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
let listening = false;

function emit() {
  listeners.forEach((l) => l());
}

function startListening() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // we show our own button instead of the mini-infobar
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    emit();
  });
}

startListening();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Mount once near the root so the event is caught before any page needs it. */
export function useCaptureInstallPrompt() {
  useEffect(() => startListening(), []);
}

export function useInstallPrompt() {
  const canPrompt = useSyncExternalStore(subscribe, () => deferred !== null, () => false);
  const justInstalled = useSyncExternalStore(subscribe, () => installed, () => false);

  const promptInstall = async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    const event = deferred;
    if (!event) return 'unavailable';
    deferred = null; // the event can only be used once
    emit();
    await event.prompt();
    const { outcome } = await event.userChoice;
    return outcome;
  };

  return { canPrompt, justInstalled, promptInstall };
}
