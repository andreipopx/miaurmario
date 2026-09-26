import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import React from 'react'

import { buildFlatLay, flatLayRole, type FlatLayInput } from '@/lib/outfit-flat-lay'
import {
  MAX_CHIPS,
  MAX_CHIP_LENGTH,
  STYLE_CARD_IDS,
  emptyProfile,
  hasAnswers,
} from '@/lib/style-quiz/cards'
import es from '@/messages/es.json'
import en from '@/messages/en.json'

// ---- mocks -----------------------------------------------------------------------

const h = vi.hoisted(() => ({
  user: null as null | Record<string, unknown>,
  patch: vi.fn(),
  put: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
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
    const q = useQuery({
      queryKey: ['auth-user'],
      queryFn: () => h.user,
      initialData: h.user,
      staleTime: Infinity,
    })
    return { user: q.data ?? undefined, isAuthenticated: !!q.data, isLoading: false }
  },
}))

vi.mock('@/lib/api', async (orig) => {
  const actual = await orig<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, patch: h.patch, put: h.put, get: h.get, post: h.post } }
})

vi.mock('@/components/native/lazy-stinky', () => ({
  LazyStinky: ({ state }: { state?: string }) => <span data-testid="lazy-stinky" data-state={state} />,
}))

vi.mock('@/components/stinky/stinky', () => ({
  Stinky: ({ state }: { state?: string }) => <span data-testid="stinky" data-state={state} />,
}))

import StyleProfilePage from '@/app/dashboard/settings/style/page'
import { DetailsPanel } from '@/components/studio/details-panel'

const item = (id: string, type: string): FlatLayInput => ({ id, type, name: type })

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

/**
 * The editor is on screen from the first render, but the page keeps its draft in
 * sync with the server while it is not being edited — so a test has to let the
 * fetch land before touching a control, exactly as a real user would.
 */
async function openFreshEditor() {
  renderWithProviders(<StyleProfilePage />)
  await screen.findByText(es.firstRun.styleQuiz.emptyState)
  return screen.getByTestId('edit-layering')
}

async function openSavedEditor() {
  renderWithProviders(<StyleProfilePage />)
  fireEvent.click(await screen.findByTestId('restyle-adjust'))
  return screen.getByTestId('edit-layering')
}

const savedResponse = (profile: Partial<ReturnType<typeof emptyProfile>>, summary: string[] = []) => ({
  profile: { ...emptyProfile(), ...profile },
  answered: summary.length > 0,
  summary,
  cards: [...STYLE_CARD_IDS],
  max_chips: MAX_CHIPS,
  max_chip_length: MAX_CHIP_LENGTH,
})

// ---- 1. The flat lay lays the dress over the trousers -----------------------------

describe('flat lay: a dress worn over a bottom', () => {
  const zOf = (pieces: ReturnType<typeof buildFlatLay>['pieces'], id: string) =>
    pieces.find((p) => p.item.id === id)!.z

  it('paints the dress in front of the bottom', () => {
    const { pieces } = buildFlatLay([item('d', 'dress'), item('j', 'jeans'), item('b', 'boots')])
    expect(zOf(pieces, 'd')).toBeGreaterThan(zOf(pieces, 'j'))
  })

  it('still puts the bottom in its own band below, so neither hides the other', () => {
    const { pieces } = buildFlatLay([item('d', 'dress'), item('j', 'jeans')])
    const dress = pieces.find((p) => p.item.id === 'd')!
    const jeans = pieces.find((p) => p.item.id === 'j')!
    expect(jeans.y).toBeGreaterThan(dress.y)
  })

  it('leaves the coat behind both of them', () => {
    const { pieces } = buildFlatLay([item('c', 'coat'), item('d', 'dress'), item('j', 'jeans')])
    expect(zOf(pieces, 'c')).toBeLessThan(zOf(pieces, 'j'))
    expect(zOf(pieces, 'c')).toBeLessThan(zOf(pieces, 'd'))
  })

  it('keeps a top layered over the dress in front of it', () => {
    const { pieces } = buildFlatLay([item('d', 'dress'), item('j', 'jeans'), item('t', 'shirt')])
    expect(zOf(pieces, 't')).toBeGreaterThan(zOf(pieces, 'd'))
  })

  it('changes nothing for a look with no dress', () => {
    const items = [item('t', 'shirt'), item('j', 'jeans'), item('b', 'boots')]
    const { pieces } = buildFlatLay(items)
    expect(zOf(pieces, 't')).toBeGreaterThan(zOf(pieces, 'j'))
    expect(zOf(pieces, 'b')).toBeGreaterThan(zOf(pieces, 't'))
  })

  it('changes nothing for a dress with no bottom', () => {
    const { pieces } = buildFlatLay([item('d', 'dress'), item('t', 'shirt'), item('b', 'boots')])
    // Without a bottom present the dress keeps its usual place under the top.
    expect(zOf(pieces, 'd')).toBeLessThan(zOf(pieces, 't'))
  })

  it('treats a jumpsuit and a suit the same way', () => {
    for (const type of ['jumpsuit', 'suit']) {
      expect(flatLayRole(type)).toBe('full_body')
      const { pieces } = buildFlatLay([item('f', type), item('j', 'pants')])
      expect(zOf(pieces, 'f')).toBeGreaterThan(zOf(pieces, 'j'))
    }
  })

  it('is still deterministic whatever order the items arrive in', () => {
    const a = buildFlatLay([item('d', 'dress'), item('j', 'jeans'), item('b', 'boots')])
    const b = buildFlatLay([item('b', 'boots'), item('j', 'jeans'), item('d', 'dress')])
    expect(a).toEqual(b)
  })
})

// ---- 2. The builder never calls a layered look a mistake --------------------------

describe('outfit builder: a hand-built layered look is not flagged', () => {
  const studioItem = (id: string, type: string) => ({
    id,
    type,
    name: type,
    thumbnail_url: null,
    image_url: null,
    primary_color: 'black',
  })

  const renderPanel = (items: ReturnType<typeof studioItem>[]) =>
    renderWithProviders(
      <DetailsPanel
        items={items}
        name=""
        occasion="casual"
        onNameChange={() => {}}
        onOccasionChange={() => {}}
        onAiMerge={() => {}}
      />
    )

  const warnings = Object.values(es.detailsPanel.warnings)

  it('says nothing about a dress worn over trousers', () => {
    renderPanel([studioItem('d', 'dress'), studioItem('j', 'jeans'), studioItem('b', 'boots')])
    for (const text of warnings) expect(screen.queryByText(text)).toBeNull()
  })

  it('says nothing about two tops over a bottom', () => {
    renderPanel([
      studioItem('t', 'shirt'),
      studioItem('s', 'sweater'),
      studioItem('j', 'jeans'),
      studioItem('b', 'boots'),
    ])
    for (const text of warnings) expect(screen.queryByText(text)).toBeNull()
  })

  it('still points out two bottoms, which is not layering', () => {
    renderPanel([studioItem('j', 'jeans'), studioItem('s', 'shorts'), studioItem('b', 'boots')])
    expect(screen.getByText(es.detailsPanel.warnings.multiBottoms)).toBeInTheDocument()
  })
})

// ---- 3. The setting in «Tu estilo» ----------------------------------------------

describe('«Me gusta superponer prendas»', () => {
  beforeEach(() => {
    h.get.mockReset()
    h.put.mockReset()
    h.patch.mockReset()
    h.user = { id: 'u1', email: 'a@b.c', username: 'ana', display_name: 'ana', role: 'member' }
    h.put.mockImplementation(async (_url: string, body: unknown) => savedResponse(body as never, ['x']))
    h.patch.mockResolvedValue({})
  })

  it('is off by default in a fresh profile', () => {
    expect(emptyProfile().layering).toBe(false)
    expect(hasAnswers(emptyProfile())).toBe(false)
  })

  it('counts as something worth saving once it is on', () => {
    expect(hasAnswers({ ...emptyProfile(), layering: true })).toBe(true)
  })

  it('renders off, with Spanish copy, for someone who never touched it', async () => {
    h.get.mockResolvedValue(savedResponse({}))
    const toggle = await openFreshEditor()
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText(es.firstRun.styleQuiz.layering.title)).toBeInTheDocument()
    expect(screen.getByText(es.firstRun.styleQuiz.layering.off)).toBeInTheDocument()
  })

  it('reads back as on for someone who saved it', async () => {
    h.get.mockResolvedValue(savedResponse({ layering: true }, ['Te gusta: minimalismo limpio.']))
    expect(await openSavedEditor()).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText(es.firstRun.styleQuiz.layering.on)).toBeInTheDocument()
  })

  it('is a real switch: named, focusable and reachable from the keyboard', async () => {
    h.get.mockResolvedValue(savedResponse({}))
    const toggle = await openFreshEditor()
    expect(toggle).toHaveAttribute('role', 'switch')
    // Radix renders a <button>: natively focusable, and Space/Enter activate it.
    expect(toggle.tagName).toBe('BUTTON')
    expect(toggle).not.toHaveAttribute('tabindex', '-1')
    expect(toggle).not.toBeDisabled()
    expect(toggle.id).toBe('style-layering')
    // A <label for> on a button both names it and activates it when clicked.
    expect(document.querySelector('label[for="style-layering"]')?.textContent).toBe(
      es.firstRun.styleQuiz.layering.label
    )
    expect(screen.getByRole('switch', { name: es.firstRun.styleQuiz.layering.label })).toBe(toggle)

    toggle.focus()
    expect(document.activeElement).toBe(toggle)
  })

  it('sits in a row at least 44px tall, so the touch target is big enough', async () => {
    h.get.mockResolvedValue(savedResponse({}))
    const toggle = await openFreshEditor()
    const row = toggle.closest('div')!
    expect(row.className).toContain('min-h-[44px]')
    // The pill itself gets a 44x44 hit area from an invisible ::before.
    expect(toggle.className).toContain('before:h-11')
    expect(toggle.className).toContain('before:w-11')
    // It wraps instead of overflowing at 320px, and the colours are tokens, so
    // dark mode and a 125% font size need no separate rules.
    expect(row.className).toContain('flex-wrap')
    expect(row.className).toContain('bg-panel')
  })

  it('saves the whole profile with the flag on', async () => {
    h.get.mockResolvedValue(savedResponse({}))
    fireEvent.click(await openFreshEditor())
    expect(screen.getByTestId('edit-layering')).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByTestId('style-editor-save'))
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1))
    expect(h.put.mock.calls[0][1]).toMatchObject({ layering: true })
  })

  it('leaves the flag alone when the user edits something else', async () => {
    h.get.mockResolvedValue(savedResponse({ layering: true }, ['Te gusta: minimalismo limpio.']))
    await openSavedEditor()
    fireEvent.click(screen.getByTestId('card-toggle-preppy'))
    fireEvent.click(screen.getByTestId('style-editor-save'))
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1))
    expect(h.put.mock.calls[0][1]).toMatchObject({ layering: true })
  })

  it('can be turned back off', async () => {
    h.get.mockResolvedValue(savedResponse({ layering: true }, ['Te gusta: minimalismo limpio.']))
    fireEvent.click(await openSavedEditor())
    expect(screen.getByTestId('edit-layering')).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(screen.getByTestId('style-editor-save'))
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1))
    expect(h.put.mock.calls[0][1]).toMatchObject({ layering: false })
  })
})

// ---- 4. Copy in both languages ---------------------------------------------------

describe('layering copy', () => {
  const keys = ['title', 'body', 'label', 'on', 'off'] as const

  it('exists in Spanish and in English', () => {
    for (const key of keys) {
      expect(es.firstRun.styleQuiz.layering[key]).toBeTruthy()
      expect(en.firstRun.styleQuiz.layering[key]).toBeTruthy()
    }
  })

  it('has the same keys in both locales', () => {
    expect(Object.keys(es.firstRun.styleQuiz.layering).sort()).toEqual(
      Object.keys(en.firstRun.styleQuiz.layering).sort()
    )
  })

  it('is written as a permission, not an obligation', () => {
    expect(es.firstRun.styleQuiz.layering.body).toContain('nunca')
    expect(en.firstRun.styleQuiz.layering.body.toLowerCase()).toContain('never')
  })

  it('says nothing about the user, only about the clothes', () => {
    for (const locale of [es, en]) {
      const text = Object.values(locale.firstRun.styleQuiz.layering).join(' ').toLowerCase()
      for (const word of ['cuerpo', 'figura', 'favorec', 'body', 'flatter', 'slim']) {
        expect(text).not.toContain(word)
      }
    }
  })
})
