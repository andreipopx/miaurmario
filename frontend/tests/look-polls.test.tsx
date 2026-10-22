import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

import { PollCard, leader } from '@/components/social/poll-card'
import type { LookPoll } from '@/lib/hooks/use-social'
import es from '@/messages/es.json'
import en from '@/messages/en.json'

const h = vi.hoisted(() => ({ vote: vi.fn() }))
vi.mock('@/lib/hooks/use-social', async (orig) => ({
  ...(await orig<typeof import('@/lib/hooks/use-social')>()),
  useVotePoll: () => ({ mutate: h.vote, isPending: false }),
  useDeletePoll: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('@/components/social/outfit-composition', () => ({ OutfitComposition: () => <span /> }))
vi.mock('@/components/social/person-avatar', () => ({ PersonAvatar: () => <span /> }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const author = { username: 'ana', display_name: 'Ana', avatar_url: null, bio: null }
const look = (id: string) => ({ id, items: [] }) as unknown as LookPoll['options'][number]['outfit']
const POLL: LookPoll = {
  id: 'p1',
  author,
  is_mine: false,
  question: '¿Cena?',
  created_at: '2026-10-22T10:00:00Z',
  closes_at: '2026-10-22T22:00:00Z',
  is_open: true,
  options: [
    { outfit: look('a'), votes: null },
    { outfit: look('b'), votes: null },
  ],
  total_votes: 0,
  my_vote: null,
}

function renderPoll(poll: LookPoll) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="es" messages={es} timeZone="Europe/Madrid">
        <PollCard poll={poll} />
      </NextIntlClientProvider>
    </QueryClientProvider>
  )
}

describe('¿Cuál me pongo?', () => {
  it('finds the leading look, or none on a tie', () => {
    const counted = (a: number, b: number) => ({
      ...POLL,
      options: [
        { outfit: look('a'), votes: a },
        { outfit: look('b'), votes: b },
      ],
    })
    expect(leader(counted(2, 1))).toBe(0)
    expect(leader(counted(1, 1))).toBe(-1)
    expect(leader(counted(0, 0))).toBe(-1)
  })

  it("lets a friend vote and hides the counts until then", () => {
    renderPoll(POLL)
    expect(screen.getByText('Ana pregunta')).toBeInTheDocument()
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Votar el look 2' }))
    expect(h.vote).toHaveBeenCalledWith({ pollId: 'p1', outfitId: 'b' }, expect.anything())
  })

  it('shows the author who is winning', () => {
    renderPoll({
      ...POLL,
      is_mine: true,
      total_votes: 3,
      options: [
        { outfit: look('a'), votes: 1 },
        { outfit: look('b'), votes: 2 },
      ],
    })
    expect(screen.getByText('Tu pregunta')).toBeInTheDocument()
    expect(screen.getByText(/Va ganando el look 2 \(3 votos\)/)).toBeInTheDocument()
    expect(screen.getByText('67%')).toBeInTheDocument()
  })

  it('has the poll copy in both languages', () => {
    expect(Object.keys(es.social.polls).sort()).toEqual(Object.keys(en.social.polls).sort())
    expect(Object.keys(es.social.today).sort()).toEqual(Object.keys(en.social.today).sort())
  })
})
