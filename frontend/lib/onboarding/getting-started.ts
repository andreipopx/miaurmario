/**
 * «Primeros pasos»: the checklist on Hoy once the wardrobe can produce looks.
 *
 * Before that, the wardrobe ramp (FirstStepsCard) is the only nudge — uploading
 * is the one thing that unblocks everything, and two cards competing for the same
 * user is worse than one. Every step is read from the real state (never a tick the
 * user has to remember to make), and the card goes away by itself once all of it
 * is done, or for good when they hide it.
 */
import type { WardrobeStage } from '@/lib/onboarding/first-run';

/** Seen-tips key once the user hides the checklist. */
export const GETTING_STARTED_KEY = 'getting-started';

export type GettingStartedStep = 'wardrobe' | 'style' | 'firstLook' | 'cat' | 'tomorrow';

export interface GettingStartedState {
  stage: WardrobeStage;
  quizAnswered: boolean;
  hasLook: boolean;
  catNamed: boolean;
  tomorrowOn: boolean;
}

export interface StepStatus {
  key: GettingStartedStep;
  done: boolean;
}

/** The steps in the order they pay off: clothes, taste, a look, the cat, the habit. */
export function gettingStartedSteps(s: GettingStartedState): StepStatus[] {
  return [
    { key: 'wardrobe', done: s.stage === 'ready' },
    { key: 'style', done: s.quizAnswered },
    { key: 'firstLook', done: s.hasLook },
    { key: 'cat', done: s.catNamed },
    { key: 'tomorrow', done: s.tomorrowOn },
  ];
}

export function showGettingStarted(
  s: GettingStartedState,
  seen: readonly string[]
): boolean {
  if (seen.includes(GETTING_STARTED_KEY)) return false;
  // Still blocked on clothes: the wardrobe card has the floor.
  if (s.stage !== 'variety' && s.stage !== 'ready') return false;
  return gettingStartedSteps(s).some((step) => !step.done);
}
