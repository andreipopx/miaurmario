import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

import { applyStreamEvent, createSSEParser, type ChatMessage } from '@/lib/stinky-chat'
import { MEMORY_KINDS, groupByKind, type StinkyMemory } from '@/lib/hooks/use-stinky-memory'
import es from '@/messages/es.json'
import en from '@/messages/en.json'

// ---- mocks -----------------------------------------------------------------------

const h = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/dashboard/settings/memory',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { accessToken: 'tok' }, status: 'authenticated' }),
}))

vi.mock('@/lib/api', async (orig) => {
  const actual = await orig<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: { ...actual.api, get: h.get, put: h.put, patch: h.patch, delete: h.del },
  }
})

vi.mock('@/components/native/lazy-stinky', () => ({
  LazyStinky: () => <span data-testid="lazy-stinky" />,
}))

import StinkyMemoryPage from '@/app/dashboard/settings/memory/page'

// ---- helpers ---------------------------------------------------------------------

function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) =>
    value && typeof value === 'object'
      ? flatten(value as Record<string, unknown>, `${prefix}${key}.`)
      : [`${prefix}${key}`]
  )
}

const memory = (over: Partial<StinkyMemory> = {}): StinkyMemory => ({
  id: 'm1',
  kind: 'preference',
  text: 'le gusta el lino',
  source: 'chat',
  pinned: false,
  created_at: '2026-09-20T10:00:00Z',
  updated_at: '2026-09-20T10:00:00Z',
  ...over,
})

const listResponse = (memories: StinkyMemory[], call_name: string | null = null) => ({
  call_name,
  memories,
  max_entries: 60,
  max_text_chars: 200,
})

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="es" messages={es}>
        <StinkyMemoryPage />
      </NextIntlClientProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  h.get.mockReset().mockResolvedValue(listResponse([]))
  h.put.mockReset().mockResolvedValue(listResponse([], 'Andrea'))
  h.patch.mockReset()
  h.del.mockReset().mockResolvedValue(undefined)
})

// ---- i18n ------------------------------------------------------------------------

describe('«Stinky recuerda» copy', () => {
  it('has the same keys in Spanish and English', () => {
    expect(flatten(en.stinkyMemory as Record<string, unknown>).sort()).toEqual(
      flatten(es.stinkyMemory as Record<string, unknown>).sort()
    )
    expect(flatten(en.settings.stinkyMemory as Record<string, unknown>).sort()).toEqual(
      flatten(es.settings.stinkyMemory as Record<string, unknown>).sort()
    )
    expect(flatten(en.stinkyChat as Record<string, unknown>).sort()).toEqual(
      flatten(es.stinkyChat as Record<string, unknown>).sort()
    )
  })

  it('names every kind the API can return, in both languages', () => {
    for (const kind of MEMORY_KINDS) {
      expect((es.stinkyMemory.kinds as Record<string, string>)[kind]).toBeTruthy()
      expect((en.stinkyMemory.kinds as Record<string, string>)[kind]).toBeTruthy()
    }
  })

  it('tells the user Stinky writes it and that they are in control', () => {
    expect(es.stinkyMemory.pageDescription).toMatch(/Stinky/)
    expect(es.stinkyMemory.how.body).toMatch(/él mismo/)
    // The sensitive-topics promise is stated where the user can read it.
    expect(es.stinkyMemory.how.point2).toMatch(/salud/)
    expect(es.stinkyMemory.how.point3).toMatch(/no se comparten/)
  })
})

// ---- grouping ---------------------------------------------------------------------

describe('groupByKind', () => {
  it('groups by kind and drops empty groups', () => {
    const groups = groupByKind([
      memory({ id: 'a', kind: 'preference' }),
      memory({ id: 'b', kind: 'dislike' }),
      memory({ id: 'c', kind: 'preference' }),
    ])
    expect(groups.map(([kind]) => kind)).toEqual(['preference', 'dislike'])
    expect(groups[0][1].map((m) => m.id)).toEqual(['a', 'c'])
  })
})

// ---- the page ---------------------------------------------------------------------

describe('Ajustes → Stinky recuerda', () => {
  it('shows the empty state until Stinky has written something', async () => {
    renderPage()
    expect(await screen.findByText(es.stinkyMemory.list.empty)).toBeInTheDocument()
  })

  it('lists the notes grouped by kind', async () => {
    h.get.mockResolvedValue(
      listResponse([
        memory({ id: 'a', kind: 'preference', text: 'le gusta el lino' }),
        memory({ id: 'b', kind: 'dislike', text: 'no lleva rojo' }),
      ])
    )
    renderPage()
    expect(await screen.findByText('le gusta el lino')).toBeInTheDocument()
    expect(screen.getByText('no lleva rojo')).toBeInTheDocument()
    expect(screen.getByTestId('memory-group-preference')).toBeInTheDocument()
    expect(screen.getByTestId('memory-group-dislike')).toBeInTheDocument()
  })

  it('edits a note', async () => {
    h.get.mockResolvedValue(listResponse([memory()]))
    h.patch.mockResolvedValue(memory({ text: 'le gusta el lino arrugado', source: 'user' }))
    renderPage()

    fireEvent.click(await screen.findByTestId('memory-edit'))
    fireEvent.change(screen.getByTestId('memory-edit-input'), {
      target: { value: 'le gusta el lino arrugado' },
    })
    fireEvent.click(screen.getByTestId('memory-edit-save'))

    await waitFor(() =>
      expect(h.patch).toHaveBeenCalledWith('/stinky/memory/m1', {
        text: 'le gusta el lino arrugado',
      })
    )
  })

  it('pins and unpins a note', async () => {
    h.get.mockResolvedValue(listResponse([memory()]))
    h.patch.mockResolvedValue(memory({ pinned: true }))
    renderPage()

    fireEvent.click(await screen.findByTestId('memory-pin'))
    await waitFor(() =>
      expect(h.patch).toHaveBeenCalledWith('/stinky/memory/m1', { pinned: true })
    )
  })

  it('deletes one note', async () => {
    h.get.mockResolvedValue(listResponse([memory()]))
    renderPage()

    fireEvent.click(await screen.findByTestId('memory-delete'))
    await waitFor(() => expect(h.del).toHaveBeenCalledWith('/stinky/memory/m1'))
  })

  it('asks before «borrar todo» and then wipes everything', async () => {
    h.get.mockResolvedValue(listResponse([memory()]))
    h.del.mockResolvedValue({ deleted: 1 })
    renderPage()

    // The button stays disabled until the notebook has loaded.
    await screen.findByText('le gusta el lino')
    await waitFor(() =>
      expect(screen.getByTestId('memory-clear-all')).not.toBeDisabled()
    )
    fireEvent.click(screen.getByTestId('memory-clear-all'))
    expect(await screen.findByText(es.stinkyMemory.clear.confirmTitle)).toBeInTheDocument()
    expect(h.del).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('confirm-clear-all'))
    await waitFor(() => expect(h.del).toHaveBeenCalledWith('/stinky/memory'))
  })

  it('saves «¿cómo quieres que te llame?»', async () => {
    renderPage()
    const input = await screen.findByTestId('call-name-input')
    fireEvent.change(input, { target: { value: 'Andrea' } })
    fireEvent.click(screen.getByTestId('call-name-save'))
    await waitFor(() =>
      expect(h.put).toHaveBeenCalledWith('/stinky/memory/name', { name: 'Andrea' })
    )
  })

  it('shows the name Stinky already uses', async () => {
    h.get.mockResolvedValue(listResponse([], 'Andrea'))
    renderPage()
    await waitFor(() =>
      expect((screen.getByTestId('call-name-input') as HTMLInputElement).value).toBe('Andrea')
    )
  })
})

// ---- the inline note in the chat ---------------------------------------------------

describe('"Stinky ha tomado nota" in the chat stream', () => {
  const base = (): ChatMessage => ({ id: 'm', role: 'assistant', content: '', cards: [] })

  it('collects memory events onto the streaming message', () => {
    const after = applyStreamEvent(base(), {
      event: 'memory',
      data: { note: { kind: 'preference', text: 'le gusta el lino', action: 'created' } },
    })
    expect(after.notes).toEqual([
      { kind: 'preference', text: 'le gusta el lino', action: 'created' },
    ])
  })

  it('parses a memory event off the wire', () => {
    const seen: unknown[] = []
    const parser = createSSEParser((ev) => seen.push(ev))
    parser.push(
      'event: memory\ndata: {"note":{"kind":"dislike","text":"no lleva rojo","action":"created"}}\n\n'
    )
    parser.end()
    expect(seen).toEqual([
      {
        event: 'memory',
        data: { note: { kind: 'dislike', text: 'no lleva rojo', action: 'created' } },
      },
    ])
  })

  it('has copy for both writing and forgetting a note', () => {
    expect(es.stinkyChat.memoryNote).toMatch(/\{text\}/)
    expect(es.stinkyChat.memoryForgot).toMatch(/\{text\}/)
    expect(en.stinkyChat.memoryNote).toMatch(/\{text\}/)
    expect(es.stinkyChat.statusTool.remember).toBeTruthy()
    expect(es.stinkyChat.statusTool.forget).toBeTruthy()
  })
})
