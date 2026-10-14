import { describe, it, expect } from 'vitest'

import {
  GETTING_STARTED_KEY,
  gettingStartedSteps,
  showGettingStarted,
  type GettingStartedState,
} from '@/lib/onboarding/getting-started'
import es from '@/messages/es.json'
import en from '@/messages/en.json'

const fresh: GettingStartedState = {
  stage: 'variety',
  quizAnswered: false,
  hasLook: false,
  catNamed: false,
  tomorrowOn: false,
}

describe('«Primeros pasos»', () => {
  it('waits while the wardrobe is too small to make looks (that card has the floor)', () => {
    for (const stage of ['empty', 'untagged', 'progress'] as const) {
      expect(showGettingStarted({ ...fresh, stage }, [])).toBe(false)
    }
    expect(showGettingStarted(fresh, [])).toBe(true)
  })

  it('reads every step from the real state, in the order they pay off', () => {
    const steps = gettingStartedSteps({ ...fresh, quizAnswered: true, catNamed: true })
    expect(steps.map((s) => s.key)).toEqual(['wardrobe', 'style', 'firstLook', 'cat', 'tomorrow'])
    expect(steps.filter((s) => s.done).map((s) => s.key)).toEqual(['style', 'cat'])
  })

  it('goes away by itself when everything is done, or for good when hidden', () => {
    const allDone = { stage: 'ready', quizAnswered: true, hasLook: true, catNamed: true, tomorrowOn: true } as const
    expect(showGettingStarted(allDone, [])).toBe(false)
    expect(showGettingStarted(fresh, [GETTING_STARTED_KEY])).toBe(false)
  })

  it('has copy for every step in both languages', () => {
    for (const messages of [es, en]) {
      const steps = messages.firstRun.gettingStarted.steps as Record<string, { title: string; body: string }>
      for (const { key } of gettingStartedSteps(fresh)) {
        expect(steps[key].title).toBeTruthy()
        expect(steps[key].body).toBeTruthy()
      }
    }
  })
})
