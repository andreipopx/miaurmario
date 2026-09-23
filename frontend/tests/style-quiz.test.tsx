import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import React from 'react'

import {
  GARMENT_PREFS,
  MAX_CHIPS,
  MAX_CHIP_LENGTH,
  QUICK_CARD_IDS,
  SIZE_KEYS,
  STYLE_CARDS,
  STYLE_CARD_IDS,
  addChip,
  applySwipe,
  cardsFor,
  continueDeck,
  currentAnswer,
  deckFromProfile,
  deckProgress,
  diffAnswers,
  emptyDeck,
  emptyProfile,
  hasAnswers,
  hasSizes,
  isDeckDone,
  mergeDeck,
  mergeSizes,
  sizesFrom,
  remainingCards,
  removeChip,
  stepBack,
} from '@/lib/style-quiz/cards'
import { STYLE_QUIZ_KEY, shouldAutoOpenStyleQuiz } from '@/lib/onboarding/first-run'
import { openStyleQuiz, useStyleQuiz } from '@/lib/hooks/use-style-quiz'
import es from '@/messages/es.json'
import en from '@/messages/en.json'

// ---- mocks -----------------------------------------------------------------------

const h = vi.hoisted(() => ({
  user: null as null | Record<string, unknown>,
  patch: vi.fn(),
  put: vi.fn(),
  get: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { accessToken: 'tok' }, status: 'authenticated' }),
}))

vi.mock('@/lib/hooks/use-auth', () => ({
  useAuth: () => {
    const q = useQuery({ queryKey: ['auth-user'], queryFn: () => h.user, initialData: h.user, staleTime: Infinity })
    return { user: q.data ?? undefined, isAuthenticated: !!q.data, isLoading: false }
  },
}))

vi.mock('@/lib/api', async (orig) => {
  const actual = await orig<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, patch: h.patch, put: h.put, get: h.get } }
})

vi.mock('@/components/stinky/stinky', () => ({
  Stinky: ({ state }: { state?: string }) => <span data-testid="stinky" data-state={state} />,
}))

vi.mock('@/components/native/lazy-stinky', () => ({
  LazyStinky: ({ state }: { state?: string }) => <span data-testid="lazy-stinky" data-state={state} />,
}))

import { StyleQuizDialog } from '@/components/style-quiz/style-quiz-dialog'
import { StyleCardTile } from '@/components/style-quiz/style-card-tile'
import { useSizeSummary } from '@/components/style-quiz/size-fields'
import { useGarmentWord } from '@/lib/garment-words'
import StyleProfilePage from '@/app/dashboard/settings/style/page'

const baseUser = (seen: string[] | undefined) => ({
  id: 'u1',
  email: 'a@b.c',
  username: 'ana',
  display_name: 'ana',
  role: 'member',
  onboarding_completed: true,
  seen_tips: seen,
})

const savedResponse = (profile: Partial<ReturnType<typeof emptyProfile>>, summary: string[] = []) => ({
  profile: { ...emptyProfile(), ...profile },
  answered: summary.length > 0,
  summary,
  cards: [...STYLE_CARD_IDS],
  max_chips: MAX_CHIPS,
  max_chip_length: MAX_CHIP_LENGTH,
})

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="es" messages={es}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>
  )
}

/** Reduced motion by default: the deck then advances synchronously. */
function setReducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

/** Pick a length and walk past the (optional) "qué ropa te propongo" question. */
function startDeck(length: 'quick' | 'deep') {
  fireEvent.click(screen.getByTestId(`quiz-length-${length}`))
  fireEvent.click(screen.getByTestId('quiz-garment-next'))
}

/** Answer the whole deck of `total` cards with "me gusta". */
function likeAll(total: number) {
  for (let i = 0; i < total; i += 1) fireEvent.click(screen.getByLabelText(/^Me gusta:/))
}

beforeEach(() => {
  setReducedMotion(true)
  h.user = null
  h.patch.mockReset().mockResolvedValue({ seen_tips: [] })
  h.put.mockReset().mockResolvedValue(savedResponse({}, ['Te gusta: minimalismo limpio.']))
  h.get.mockReset().mockResolvedValue(savedResponse({}))
  window.localStorage.clear()
})

// ---- the deck, as pure logic -----------------------------------------------------

describe('deck logic', () => {
  it('records a like, a dislike and a pass, and always moves forward', () => {
    let state = emptyDeck()
    state = applySwipe(state, 'like')
    state = applySwipe(state, 'dislike')
    state = applySwipe(state, 'pass')
    expect(state.index).toBe(3)
    expect(state.liked).toEqual([STYLE_CARDS[0].id])
    expect(state.disliked).toEqual([STYLE_CARDS[1].id])
    // "Ni fu ni fa" is not an answer, so only the first two count as touched…
    expect(state.touched).toEqual(STYLE_CARDS.slice(0, 2).map((c) => c.id))
    // …but all three were asked, so none of them comes round again.
    expect(state.seen).toEqual(STYLE_CARDS.slice(0, 3).map((c) => c.id))
  })

  it('"ni fu ni fa" leaves an answer the user already gave exactly as it was', () => {
    let state = applySwipe(emptyDeck(), 'like')
    state = applySwipe(stepBack(state), 'pass')
    expect(state.liked).toEqual([STYLE_CARDS[0].id])
    expect(state.disliked).toEqual([])
    expect(state.index).toBe(1)
  })

  it('"ni fu ni fa" on a re-run keeps what was saved before', () => {
    const state = applySwipe(deckFromProfile({ liked: ['minimal'], disliked: [] }), 'pass')
    expect(state.liked).toEqual(['minimal'])
    expect(state.touched).toEqual([])
  })

  it('never puts a card in both piles when the answer changes', () => {
    let state = applySwipe(emptyDeck(), 'like')
    state = applySwipe(stepBack(state), 'dislike')
    expect(state.liked).toEqual([])
    expect(state.disliked).toEqual([STYLE_CARDS[0].id])
  })

  it('shows the previous answer when the user steps back', () => {
    const state = applySwipe(emptyDeck(), 'like')
    expect(currentAnswer(state)).toBe('pass')
    expect(currentAnswer(stepBack(state))).toBe('like')
  })

  it('stops at the ends', () => {
    expect(stepBack(emptyDeck()).index).toBe(0)
    let state = emptyDeck()
    for (let i = 0; i < STYLE_CARDS.length + 3; i += 1) state = applySwipe(state, 'pass')
    expect(state.index).toBe(STYLE_CARDS.length)
    expect(isDeckDone(state)).toBe(true)
  })

  it('reports progress from nothing to everything', () => {
    expect(deckProgress(emptyDeck())).toBe(0)
    expect(deckProgress({ ...emptyDeck(), index: STYLE_CARDS.length })).toBe(100)
  })

  it('pre-fills a re-run from the saved profile but marks nothing as touched', () => {
    const state = deckFromProfile({ liked: ['minimal', 'ghost-card'], disliked: ['boho'] })
    expect(state.liked).toEqual(['minimal'])
    expect(state.disliked).toEqual(['boho'])
    expect(state.touched).toEqual([])
    expect(state.index).toBe(0)
  })
})

describe('quick vs thorough', () => {
  it('the short deck is a real subset and short enough to finish', () => {
    const quick = cardsFor('quick')
    expect(quick).toHaveLength(QUICK_CARD_IDS.length)
    expect(quick.length).toBeGreaterThanOrEqual(6)
    expect(quick.length).toBeLessThanOrEqual(8)
    expect(quick.every((c) => STYLE_CARD_IDS.includes(c.id))).toBe(true)
    expect(cardsFor('deep')).toHaveLength(STYLE_CARDS.length)
  })

  it('the short deck covers every kind of card', () => {
    expect(new Set(cardsFor('quick').map((c) => c.category))).toEqual(
      new Set(['aesthetic', 'silhouette', 'palette'])
    )
  })

  it('"seguir afinando" only asks what the short run never showed', () => {
    let state = emptyDeck()
    const quick = cardsFor('quick')
    // A mix of answers and skips: a skipped card was still asked.
    for (let i = 0; i < quick.length; i += 1) state = applySwipe(state, i % 2 ? 'pass' : 'like', quick)

    const rest = remainingCards(state)
    expect(rest).toHaveLength(STYLE_CARDS.length - quick.length)
    expect(rest.some((c) => QUICK_CARD_IDS.includes(c.id))).toBe(false)
    expect(continueDeck(state).index).toBe(0)
    expect(continueDeck(state).liked).toEqual(state.liked)
  })
})

describe('merging a re-run with the old profile', () => {
  const previous = { liked: ['minimal', 'boho'], disliked: ['sporty'] }

  it('leaves untouched cards exactly as they were', () => {
    expect(mergeDeck(previous, emptyDeck())).toEqual(previous)
  })

  it('lets the newer answer win on a card the user saw again', () => {
    const run = { ...emptyDeck(), disliked: ['minimal'], touched: ['minimal'] }
    const merged = mergeDeck(previous, run)
    expect(merged.liked).toEqual(['boho'])
    expect(merged.disliked).toEqual(['minimal', 'sporty'].filter((id) => merged.disliked.includes(id)))
    expect(merged.disliked).toContain('minimal')
    expect(merged.disliked).toContain('sporty')
  })

  it('leaves the old answer alone when the card got "ni fu ni fa"', () => {
    // The whole short deck, skipped card by card: nothing may move.
    const quick = cardsFor('quick')
    let run = deckFromProfile(previous)
    for (let i = 0; i < quick.length; i += 1) run = applySwipe(run, 'pass', quick)
    expect(run.seen).toHaveLength(quick.length)
    expect(mergeDeck(previous, run)).toEqual(previous)
  })

  it('reports what changed, and says nothing when nothing did', () => {
    expect(diffAnswers(previous, previous)).toEqual([])
    expect(diffAnswers(previous, { liked: ['minimal'], disliked: ['sporty', 'boho'] })).toEqual([
      { card: 'boho', from: 'like', to: 'dislike' },
    ])
  })
})

describe('free-text chips', () => {
  it('trims, collapses whitespace and ignores blanks', () => {
    expect(addChip([], '  Acne   Studios ')).toEqual(['Acne Studios'])
    expect(addChip([], '   ')).toEqual([])
  })

  it('ignores case-insensitive duplicates', () => {
    expect(addChip(['Acne'], 'acne')).toEqual(['Acne'])
  })

  it('caps the length and the count', () => {
    expect(addChip([], 'x'.repeat(200))[0]).toHaveLength(MAX_CHIP_LENGTH)
    const full = Array.from({ length: MAX_CHIPS }, (_, i) => `b${i}`)
    expect(addChip(full, 'one more')).toEqual(full)
  })

  it('removes by value', () => {
    expect(removeChip(['a', 'b'], 'a')).toEqual(['b'])
  })

  it('knows when a profile is worth saving', () => {
    expect(hasAnswers(emptyProfile())).toBe(false)
    expect(hasAnswers({ ...emptyProfile(), completed: true })).toBe(false)
    expect(hasAnswers({ ...emptyProfile(), occasions: ['oficina'] })).toBe(true)
  })
})

// ---- show-once rules -------------------------------------------------------------

describe('when the quiz offers itself', () => {
  it('waits for the tour and then asks exactly once', () => {
    expect(shouldAutoOpenStyleQuiz(baseUser([]))).toBe(false)
    expect(shouldAutoOpenStyleQuiz(baseUser(['tour']))).toBe(true)
    expect(shouldAutoOpenStyleQuiz(baseUser(['tour', STYLE_QUIZ_KEY]))).toBe(false)
    expect(shouldAutoOpenStyleQuiz(baseUser(['tour']), [STYLE_QUIZ_KEY])).toBe(false)
  })

  it('never opens before onboarding, or on a backend without seen_tips', () => {
    expect(shouldAutoOpenStyleQuiz(null)).toBe(false)
    expect(shouldAutoOpenStyleQuiz({ ...baseUser(['tour']), onboarding_completed: false })).toBe(false)
    expect(shouldAutoOpenStyleQuiz({ ...baseUser(['tour']), username: null })).toBe(false)
    expect(shouldAutoOpenStyleQuiz(baseUser(undefined))).toBe(false)
  })
})

// ---- the dialog ------------------------------------------------------------------

describe('StyleQuizDialog', () => {
  it('stays shut until the tour is done', () => {
    h.user = baseUser([])
    renderWithProviders(<StyleQuizDialog />)
    expect(screen.queryByTestId('style-quiz')).toBeNull()
  })

  it('opens after the tour and asks how long it should be', async () => {
    h.user = baseUser(['tour'])
    renderWithProviders(<StyleQuizDialog />)
    await screen.findByTestId('style-quiz')
    expect(screen.getByText(es.firstRun.styleQuiz.length.title)).toBeInTheDocument()
    expect(screen.getByTestId('quiz-length-quick')).toBeInTheDocument()
    expect(screen.getByTestId('quiz-length-deep')).toBeInTheDocument()
  })

  it('says how many cards each length has', async () => {
    h.user = baseUser(['tour'])
    renderWithProviders(<StyleQuizDialog />)
    await screen.findByTestId('style-quiz')
    expect(screen.getByText(new RegExp(`${cardsFor('quick').length} tarjetas`))).toBeInTheDocument()
    expect(screen.getByText(new RegExp(`${STYLE_CARDS.length} tarjetas`))).toBeInTheDocument()
  })

  it('walks the short deck with the buttons and counts down', async () => {
    h.user = baseUser(['tour'])
    renderWithProviders(<StyleQuizDialog />)
    await screen.findByTestId('style-quiz')
    startDeck('quick')

    const total = cardsFor('quick').length
    expect(screen.getByText(`Tarjeta 1 de ${total}`)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(/^Me gusta:/))
    expect(screen.getByText(`Tarjeta 2 de ${total}`)).toBeInTheDocument()
  })

  it('advances after the fly-out when motion is allowed', async () => {
    setReducedMotion(false)
    h.user = baseUser(['tour'])
    renderWithProviders(<StyleQuizDialog />)
    await screen.findByTestId('style-quiz')
    startDeck('quick')

    fireEvent.click(screen.getByLabelText(/^Me gusta:/))
    // The card animates out first, so the counter only moves once it lands.
    await screen.findByText(`Tarjeta 2 de ${cardsFor('quick').length}`)
  })

  it('takes the arrow keys as swipes', async () => {
    h.user = baseUser(['tour'])
    renderWithProviders(<StyleQuizDialog />)
    await screen.findByTestId('style-quiz')
    startDeck('quick')

    const total = cardsFor('quick').length
    fireEvent.keyDown(screen.getByTestId('style-quiz'), { key: 'ArrowRight' })
    expect(screen.getByText(`Tarjeta 2 de ${total}`)).toBeInTheDocument()
    fireEvent.keyDown(screen.getByTestId('style-quiz'), { key: 'ArrowLeft' })
    expect(screen.getByText(`Tarjeta 3 de ${total}`)).toBeInTheDocument()
  })

  it('saves and marks itself seen at the end of the short run', async () => {
    h.user = baseUser(['tour'])
    renderWithProviders(<StyleQuizDialog />)
    await screen.findByTestId('style-quiz')
    startDeck('quick')

    likeAll(cardsFor('quick').length)

    // fit -> essentials -> finish
    expect(screen.getByText(es.firstRun.styleQuiz.fit.title)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: es.firstRun.styleQuiz.next }))
    expect(screen.getByText(es.firstRun.styleQuiz.neverWear.title)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: es.firstRun.styleQuiz.finish }))

    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1))
    const [endpoint, payload] = h.put.mock.calls[0]
    expect(endpoint).toBe('/users/me/preferences/style-quiz')
    expect(payload.liked).toHaveLength(cardsFor('quick').length)
    expect(payload.completed).toBe(true)
    expect(h.patch).toHaveBeenCalledWith('/users/me/seen-tips', { add: [STYLE_QUIZ_KEY] })
  })

  it('offers to keep tuning after the short run, and shows what Stinky read', async () => {
    h.user = baseUser(['tour'])
    renderWithProviders(<StyleQuizDialog />)
    await screen.findByTestId('style-quiz')
    startDeck('quick')
    likeAll(cardsFor('quick').length)

    expect(screen.getByText(es.firstRun.styleQuiz.fit.title)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: es.firstRun.styleQuiz.next }))
    fireEvent.click(screen.getByRole('button', { name: es.firstRun.styleQuiz.finish }))

    const summary = await screen.findByTestId('style-quiz-summary')
    expect(summary).toHaveTextContent('Te gusta: minimalismo limpio.')
    expect(screen.getByTestId('style-quiz-keep-going')).toBeInTheDocument()
  })

  it('says what the three buttons do on the first card, and only there', async () => {
    h.user = baseUser(['tour'])
    renderWithProviders(<StyleQuizDialog />)
    await screen.findByTestId('style-quiz')
    startDeck('quick')

    expect(screen.getByTestId('deck-intro')).toHaveTextContent(es.firstRun.styleQuiz.deckIntro)
    // The "no cambia nada" hint stays on the button itself for the whole deck.
    expect(screen.getByTestId('quiz-pass')).toHaveTextContent(es.firstRun.styleQuiz.skipCardHint)

    fireEvent.click(screen.getByTestId('quiz-pass'))
    expect(screen.queryByTestId('deck-intro')).toBeNull()
    expect(screen.getByTestId('quiz-pass')).toHaveTextContent(es.firstRun.styleQuiz.skipCardHint)
  })

  it('"ni fu ni fa" in a merge run saves the old answers untouched', async () => {
    h.user = baseUser(['tour', STYLE_QUIZ_KEY])
    h.get.mockResolvedValue(savedResponse({ liked: ['minimal'], disliked: ['boho'] }, ['Te gusta: minimalismo limpio.']))
    renderWithProviders(<StyleQuizDialog />)

    await waitFor(() => expect(h.get).toHaveBeenCalled())
    act(() => openStyleQuiz('merge'))
    await screen.findByTestId('style-quiz')
    startDeck('quick')

    const total = cardsFor('quick').length
    for (let i = 0; i < total; i += 1) fireEvent.click(screen.getByTestId('quiz-pass'))
    fireEvent.click(screen.getByRole('button', { name: es.firstRun.styleQuiz.next }))
    fireEvent.click(screen.getByRole('button', { name: es.firstRun.styleQuiz.finish }))

    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1))
    const payload = h.put.mock.calls[0][1]
    expect(payload.liked).toEqual(['minimal'])
    expect(payload.disliked).toEqual(['boho'])
  })

  it('skipping saves nothing when nothing was answered, but still stops asking', async () => {
    h.user = baseUser(['tour'])
    renderWithProviders(<StyleQuizDialog />)
    await screen.findByTestId('style-quiz')
    fireEvent.click(screen.getByRole('button', { name: es.firstRun.styleQuiz.skip }))

    await waitFor(() => expect(h.patch).toHaveBeenCalledWith('/users/me/seen-tips', { add: [STYLE_QUIZ_KEY] }))
    expect(h.put).not.toHaveBeenCalled()
    expect(screen.queryByTestId('style-quiz')).toBeNull()
  })

  it('skipping halfway keeps the answers already given', async () => {
    h.user = baseUser(['tour'])
    renderWithProviders(<StyleQuizDialog />)
    await screen.findByTestId('style-quiz')
    startDeck('quick')
    fireEvent.click(screen.getByLabelText(/^Me gusta:/))
    expect(screen.getByText(/Tarjeta 2 de/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: es.firstRun.styleQuiz.skip }))

    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1))
    expect(h.put.mock.calls[0][1].liked).toHaveLength(1)
    expect(h.put.mock.calls[0][1].completed).toBe(false)
  })
})

// ---- "¿qué ropa quieres que te proponga?" ----------------------------------------

describe('what clothes to propose', () => {
  it('starts unanswered and stays that way if the user walks past it', async () => {
    h.user = baseUser(['tour'])
    renderWithProviders(<StyleQuizDialog />)
    await screen.findByTestId('style-quiz')

    fireEvent.click(screen.getByTestId('quiz-length-quick'))
    const step = screen.getByTestId('quiz-garment')
    expect(step).toHaveTextContent(es.firstRun.styleQuiz.garment.title)
    // Every option is offered and none of them is preselected.
    for (const option of GARMENT_PREFS) {
      expect(screen.getByTestId(`garment-${option}`)).toHaveAttribute('aria-pressed', 'false')
    }

    fireEvent.click(screen.getByTestId('quiz-garment-next'))
    likeAll(cardsFor('quick').length)
    fireEvent.click(screen.getByRole('button', { name: es.firstRun.styleQuiz.next }))
    fireEvent.click(screen.getByRole('button', { name: es.firstRun.styleQuiz.finish }))

    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1))
    expect(h.put.mock.calls[0][1].garment_pref).toBeNull()
  })

  it('saves the answer the user picked, and lets them take it back', async () => {
    h.user = baseUser(['tour'])
    renderWithProviders(<StyleQuizDialog />)
    await screen.findByTestId('style-quiz')
    fireEvent.click(screen.getByTestId('quiz-length-quick'))

    fireEvent.click(screen.getByTestId('garment-femenina'))
    expect(screen.getByTestId('garment-femenina')).toHaveAttribute('aria-pressed', 'true')
    // Tapping it again means "actually, never mind": back to unanswered.
    fireEvent.click(screen.getByTestId('garment-femenina'))
    expect(screen.getByTestId('garment-femenina')).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByTestId('garment-masculina'))

    fireEvent.click(screen.getByTestId('quiz-garment-next'))
    likeAll(cardsFor('quick').length)
    fireEvent.click(screen.getByRole('button', { name: es.firstRun.styleQuiz.next }))
    fireEvent.click(screen.getByRole('button', { name: es.firstRun.styleQuiz.finish }))

    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1))
    expect(h.put.mock.calls[0][1].garment_pref).toBe('masculina')
  })

  it('is asked before the deck and can be stepped back to', async () => {
    h.user = baseUser(['tour'])
    renderWithProviders(<StyleQuizDialog />)
    await screen.findByTestId('style-quiz')
    startDeck('quick')
    expect(screen.getByText(/Tarjeta 1 de/)).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText(es.firstRun.styleQuiz.back))
    expect(screen.getByTestId('quiz-garment')).toBeInTheDocument()
  })

  it('counts as an answer worth saving on its own', () => {
    expect(hasAnswers(emptyProfile())).toBe(false)
    expect(hasAnswers({ ...emptyProfile(), garment_pref: 'ambas' })).toBe(true)
  })

  it('never frames it as anything but clothes', () => {
    const banned = /\bhombre|\bmujer|género|sexo|\bchico|\bchica|identi/i
    const walk = (value: unknown): string[] =>
      typeof value === 'string'
        ? [value]
        : value && typeof value === 'object'
          ? Object.values(value as Record<string, unknown>).flatMap(walk)
          : []
    for (const line of [...walk(es.firstRun.styleQuiz.garment), ...walk(en.firstRun.styleQuiz.garment)]) {
      expect(line, line).not.toMatch(banned)
    }
  })
})

// ---- habitual sizes --------------------------------------------------------------

describe('habitual sizes', () => {
  it('reads and merges the three keys the measurements form already stores', () => {
    expect(sizesFrom({ height: 170, shirt_size: 'M', shoe_size: 42 })).toEqual({
      shirt_size: 'M',
      shoe_size: '42',
    })
    expect(hasSizes({})).toBe(false)
    expect(hasSizes({ shirt_size: ' ' })).toBe(false)
    expect(hasSizes({ pants_size: '40' })).toBe(true)

    // Everything else in there is left alone, and a blanked size is removed.
    expect(mergeSizes({ height: 170, shirt_size: 'M' }, { shirt_size: '', pants_size: '40' })).toEqual({
      height: 170,
      pants_size: '40',
    })
  })

  it('never stores the measurement the app deliberately dropped', () => {
    expect(Object.keys(mergeSizes({}, { shirt_size: 'M' }))).toEqual(['shirt_size'])
    expect(SIZE_KEYS).not.toContain('inseam')
  })

  it('asks for them in the long run and saves them on the profile, not the quiz', async () => {
    h.user = baseUser(['tour'])
    renderWithProviders(<StyleQuizDialog />)
    await screen.findByTestId('style-quiz')
    startDeck('deep')
    likeAll(STYLE_CARDS.length)

    // fit -> sizes
    fireEvent.click(screen.getByRole('button', { name: es.firstRun.styleQuiz.next }))
    expect(screen.getByTestId('quiz-sizes')).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('size-top'), { target: { value: 'M' } })
    fireEvent.change(screen.getByTestId('size-shoe'), { target: { value: '42' } })

    // likes -> avoid -> finish
    fireEvent.click(screen.getByRole('button', { name: es.firstRun.styleQuiz.next }))
    fireEvent.click(screen.getByRole('button', { name: es.firstRun.styleQuiz.next }))
    fireEvent.click(screen.getByRole('button', { name: es.firstRun.styleQuiz.finish }))

    await waitFor(() => expect(h.patch).toHaveBeenCalledWith('/users/me', {
      body_measurements: { shirt_size: 'M', shoe_size: '42' },
    }))
    // The quiz payload stays about taste only.
    const payload = h.put.mock.calls[0][1]
    expect(Object.keys(payload).some((k) => k.includes('size'))).toBe(false)
  })

  it('leaves the profile alone when nobody types a size', async () => {
    h.user = baseUser(['tour'])
    renderWithProviders(<StyleQuizDialog />)
    await screen.findByTestId('style-quiz')
    startDeck('quick')
    likeAll(cardsFor('quick').length)
    fireEvent.click(screen.getByRole('button', { name: es.firstRun.styleQuiz.next }))
    fireEvent.click(screen.getByRole('button', { name: es.firstRun.styleQuiz.finish }))

    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1))
    expect(h.patch).not.toHaveBeenCalledWith('/users/me', expect.anything())
  })
})

// ---- what a garment is called ----------------------------------------------------

function GarmentWord({ type }: { type: string }) {
  const word = useGarmentWord()
  const { data } = useStyleQuiz()
  return (
    <span data-testid="word" data-loaded={data ? '1' : '0'}>
      {word(type)}
    </span>
  )
}

function SizeLine({ values }: { values: Record<string, string> }) {
  const summary = useSizeSummary()
  return <span data-testid="line">{summary(values)}</span>
}

describe('naming a garment', () => {
  const withPref = async (garment_pref: string | null, type: string) => {
    h.get.mockResolvedValue(savedResponse({ garment_pref } as never))
    const view = renderWithProviders(<GarmentWord type={type} />)
    await waitFor(() => expect(screen.getByTestId('word')).toHaveAttribute('data-loaded', '1'))
    const text = screen.getByTestId('word').textContent
    view.unmount()
    return text
  }

  it('uses the words of the section the user asked for', async () => {
    expect(await withPref('femenina', 'shirt')).toBe('Blusa')
    expect(await withPref('masculina', 'shirt')).toBe('Camisa')
  })

  it('says exactly what it said before when nobody answered', async () => {
    // Unanswered, "ambas" and a refusal must all be indistinguishable.
    const plain = await withPref(null, 'shirt')
    expect(plain).toBe('Camisa')
    expect(await withPref('ambas', 'shirt')).toBe(plain)
    expect(await withPref('sin_decir', 'shirt')).toBe(plain)
  })

  it('leaves alone every garment that has only one name', async () => {
    expect(await withPref('femenina', 'jeans')).toBe('Vaqueros')
    expect(await withPref('masculina', 'jeans')).toBe('Vaqueros')
  })

  it('reads the sizes back as a line for a shop link', () => {
    renderWithProviders(<SizeLine values={{ shirt_size: 'M', shoe_size: '42' }} />)
    expect(screen.getByTestId('line')).toHaveTextContent('arriba M · calzado 42')
  })
})

// ---- the cards themselves --------------------------------------------------------

describe('what a card looks like', () => {
  it('draws every card, and keeps the drawing out of the accessibility tree', () => {
    for (const card of STYLE_CARDS) {
      const { unmount } = renderWithProviders(<StyleCardTile card={card} />)
      const art = screen.getByTestId(`style-card-art-${card.id}`)
      expect(art.tagName.toLowerCase()).toBe('svg')
      expect(art).toHaveAttribute('aria-hidden')
      // Something is actually drawn: garments, not an empty frame.
      expect(art.querySelectorAll('path').length).toBeGreaterThan(1)
      unmount()
    }
  })

  it('paints the palette cards with their own colours', () => {
    const jewel = STYLE_CARDS.find((c) => c.id === 'jewel')!
    renderWithProviders(<StyleCardTile card={jewel} />)
    const fills = Array.from(
      screen.getByTestId('style-card-art-jewel').querySelectorAll('path'),
      (p) => p.getAttribute('fill')
    )
    for (const hex of jewel.swatches!.slice(0, 3)) {
      expect(fills.some((f) => f?.toLowerCase() === hex.toLowerCase()), hex).toBe(true)
    }
  })

  it('spells out the examples on the big card and keeps the small one short', () => {
    const { unmount } = renderWithProviders(<StyleCardTile card={STYLE_CARDS[0]} />)
    expect(screen.getByText(es.firstRun.styleQuiz.cards.minimal.examples)).toBeInTheDocument()
    unmount()
    renderWithProviders(<StyleCardTile card={STYLE_CARDS[0]} compact />)
    expect(screen.queryByText(es.firstRun.styleQuiz.cards.minimal.examples)).toBeNull()
  })
})

// ---- Ajustes -> Tu estilo --------------------------------------------------------

describe('Ajustes → Tu estilo', () => {
  const answered = () =>
    savedResponse(
      { liked: ['minimal'], disliked: ['boho'], updated_at: '2026-09-20T10:00:00+00:00' },
      ['Te gusta: minimalismo limpio.']
    )

  it('invites the user to take the quiz when there is nothing yet', async () => {
    h.get.mockResolvedValue(savedResponse({}))
    renderWithProviders(<StyleProfilePage />)
    expect(await screen.findByText(es.firstRun.styleQuiz.emptyState)).toBeInTheDocument()
    expect(screen.queryByTestId('restyle-fresh')).toBeNull()
    // With nothing saved, the editor is open straight away.
    expect(screen.getByTestId('style-editor')).toBeInTheDocument()
  })

  it('shows what Stinky read and when it was last tuned', async () => {
    h.get.mockResolvedValue(answered())
    renderWithProviders(<StyleProfilePage />)
    expect(await screen.findByTestId('style-summary')).toHaveTextContent('Te gusta: minimalismo limpio.')
    expect(screen.getByTestId('style-updated-at')).toHaveTextContent('20 sep 2026')
  })

  it('offers the three ways to re-run it', async () => {
    h.get.mockResolvedValue(answered())
    renderWithProviders(<StyleProfilePage />)
    await screen.findByTestId('restyle-adjust')
    expect(screen.getByTestId('restyle-merge')).toBeInTheDocument()
    expect(screen.getByTestId('restyle-fresh')).toBeInTheDocument()
    // The editor stays out of the way until "reajustar" is chosen.
    expect(screen.queryByTestId('style-editor')).toBeNull()
  })

  it('"reajustar" opens the editor with the saved answers already set', async () => {
    h.get.mockResolvedValue(answered())
    renderWithProviders(<StyleProfilePage />)
    fireEvent.click(await screen.findByTestId('restyle-adjust'))

    const liked = screen.getByTestId('card-toggle-minimal')
    expect(liked.getAttribute('aria-label')).toContain('te gusta')
    expect(screen.getByTestId('card-toggle-boho').getAttribute('aria-label')).toContain('no te va')
    expect(screen.getByTestId('card-toggle-preppy').getAttribute('aria-label')).toContain('sin opinión')
  })

  it('cycles a card through the three answers and saves the lot', async () => {
    h.get.mockResolvedValue(answered())
    renderWithProviders(<StyleProfilePage />)
    fireEvent.click(await screen.findByTestId('restyle-adjust'))

    fireEvent.click(screen.getByTestId('card-toggle-preppy'))
    expect(screen.getByTestId('card-toggle-preppy').getAttribute('aria-label')).toContain('te gusta')
    fireEvent.click(screen.getByTestId('card-toggle-preppy'))
    expect(screen.getByTestId('card-toggle-preppy').getAttribute('aria-label')).toContain('no te va')

    fireEvent.click(screen.getByTestId('style-editor-save'))
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1))
    const payload = h.put.mock.calls[0][1]
    expect(payload.liked).toEqual(['minimal'])
    expect(payload.disliked).toEqual(expect.arrayContaining(['boho', 'preppy']))
  })

  it('"empezar de cero" asks first, then clears the profile', async () => {
    h.get.mockResolvedValue(answered())
    renderWithProviders(<StyleProfilePage />)
    fireEvent.click(await screen.findByTestId('restyle-fresh'))

    expect(await screen.findByText(es.firstRun.styleQuiz.restyle.fresh.confirmTitle)).toBeInTheDocument()
    expect(h.put).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('confirm-fresh'))
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1))
    expect(h.put.mock.calls[0][1]).toEqual(emptyProfile())
  })

  it('free text survives a round trip through the editor', async () => {
    h.get.mockResolvedValue(answered())
    renderWithProviders(<StyleProfilePage />)
    fireEvent.click(await screen.findByTestId('restyle-adjust'))

    const input = screen.getByTestId('edit-never')
    fireEvent.change(input, { target: { value: '  tacones  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByLabelText('Quitar tacones')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('style-editor-save'))
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1))
    expect(h.put.mock.calls[0][1].never_wear).toEqual(['tacones'])
  })
})

// ---- copy ------------------------------------------------------------------------

describe('copy', () => {
  it('has both languages in step with each other', () => {
    const flat = (obj: Record<string, unknown>, prefix = ''): string[] =>
      Object.entries(obj).flatMap(([k, v]) =>
        v && typeof v === 'object' ? flat(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`]
      )
    expect(flat(es.firstRun.styleQuiz).sort()).toEqual(flat(en.firstRun.styleQuiz).sort())
    expect(flat(es.settings.styleQuiz).sort()).toEqual(flat(en.settings.styleQuiz).sort())
  })

  it('has a title, a body and concrete examples for every card in the deck', () => {
    const cards = es.firstRun.styleQuiz.cards as Record<string, { title: string; body: string; examples: string }>
    for (const card of STYLE_CARDS) {
      expect(cards[card.id]?.title, card.id).toBeTruthy()
      expect(cards[card.id]?.body, card.id).toBeTruthy()
      // Real garments, not adjectives: "camiseta blanca + pantalón recto + …".
      expect(cards[card.id]?.examples, card.id).toMatch(/\w+ \+ \w+|,/)
    }
    expect(Object.keys(cards).sort()).toEqual([...STYLE_CARD_IDS].sort())
  })

  it('never talks about the user’s body', () => {
    const banned = /favorec|figura|silueta corporal|adelgaz|tu cuerpo|tu peso|tu talla/i
    const walk = (value: unknown): string[] =>
      typeof value === 'string'
        ? [value]
        : value && typeof value === 'object'
          ? Object.values(value as Record<string, unknown>).flatMap(walk)
          : []
    for (const line of [...walk(es.firstRun.styleQuiz), ...walk(en.firstRun.styleQuiz)]) {
      expect(line, line).not.toMatch(banned)
    }
  })
})
