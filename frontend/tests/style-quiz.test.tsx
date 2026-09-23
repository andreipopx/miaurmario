import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import React from 'react'

import {
  MAX_CHIPS,
  MAX_CHIP_LENGTH,
  QUICK_CARD_IDS,
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
  isDeckDone,
  mergeDeck,
  remainingCards,
  removeChip,
  stepBack,
} from '@/lib/style-quiz/cards'
import { STYLE_QUIZ_KEY, shouldAutoOpenStyleQuiz } from '@/lib/onboarding/first-run'
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
    expect(state.touched).toEqual(STYLE_CARDS.slice(0, 3).map((c) => c.id))
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
    for (let i = 0; i < quick.length; i += 1) state = applySwipe(state, 'like', quick)

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

  it('treats "ni fu ni fa" as a fresh answer that clears the old one', () => {
    const run = { ...emptyDeck(), touched: ['boho'] }
    expect(mergeDeck(previous, run).liked).toEqual(['minimal'])
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
    fireEvent.click(screen.getByTestId('quiz-length-quick'))

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
    fireEvent.click(screen.getByTestId('quiz-length-quick'))

    fireEvent.click(screen.getByLabelText(/^Me gusta:/))
    // The card animates out first, so the counter only moves once it lands.
    await screen.findByText(`Tarjeta 2 de ${cardsFor('quick').length}`)
  })

  it('takes the arrow keys as swipes', async () => {
    h.user = baseUser(['tour'])
    renderWithProviders(<StyleQuizDialog />)
    await screen.findByTestId('style-quiz')
    fireEvent.click(screen.getByTestId('quiz-length-quick'))

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
    fireEvent.click(screen.getByTestId('quiz-length-quick'))

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
    fireEvent.click(screen.getByTestId('quiz-length-quick'))
    likeAll(cardsFor('quick').length)

    expect(screen.getByText(es.firstRun.styleQuiz.fit.title)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: es.firstRun.styleQuiz.next }))
    fireEvent.click(screen.getByRole('button', { name: es.firstRun.styleQuiz.finish }))

    const summary = await screen.findByTestId('style-quiz-summary')
    expect(summary).toHaveTextContent('Te gusta: minimalismo limpio.')
    expect(screen.getByTestId('style-quiz-keep-going')).toBeInTheDocument()
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
    fireEvent.click(screen.getByTestId('quiz-length-quick'))
    fireEvent.click(screen.getByLabelText(/^Me gusta:/))
    expect(screen.getByText(/Tarjeta 2 de/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: es.firstRun.styleQuiz.skip }))

    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1))
    expect(h.put.mock.calls[0][1].liked).toHaveLength(1)
    expect(h.put.mock.calls[0][1].completed).toBe(false)
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

  it('has a title and a body for every card in the deck', () => {
    const cards = es.firstRun.styleQuiz.cards as Record<string, { title: string; body: string }>
    for (const card of STYLE_CARDS) {
      expect(cards[card.id]?.title, card.id).toBeTruthy()
      expect(cards[card.id]?.body, card.id).toBeTruthy()
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
