import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

import { StinkyMeals, nextReward, weekOf } from '@/components/today/stinky-meals'
import type { Habit } from '@/lib/hooks/use-habit'
import es from '@/messages/es.json'
import en from '@/messages/en.json'

const h = vi.hoisted(() => ({ habit: null as Habit | null }))

vi.mock('@/lib/hooks/use-habit', () => ({
  useHabit: () => ({ data: h.habit }),
  useHabitFollowsChanges: () => {},
}))
vi.mock('@/components/native/lazy-stinky', () => ({
  LazyStinky: ({ state }: { state?: string }) => <span data-testid="stinky" data-state={state} />,
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), message: vi.fn() } }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const BASE: Habit = {
  today: '2026-10-22',
  fed_today: false,
  meals: 5,
  level: 1,
  level_starts_at: 3,
  next_level_at: 7,
  week_days: ['2026-10-20'],
  weekly_goal: 3,
  week_met: false,
  streak_weeks: 2,
  best_streak_weeks: 4,
  frozen_weeks: [],
  comodin_left_this_month: true,
  unlocked: ['pajarita'],
  accessories: { pajarita: 1, cascabel: 2, panuelo: 3, lazo: 4, perlas: 5, 'pajarita-dorada': 6 },
  accessory: 'pajarita',
  last_meal: '2026-10-20',
  welcome_back: false,
  levels: [0, 3, 7, 15, 30, 60, 100, 180, 365],
}

function renderCard(habit: Habit) {
  h.habit = habit
  const client = new QueryClient()
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="es" messages={es}>
        <StinkyMeals />
      </NextIntlClientProvider>
    </QueryClientProvider>
  )
}

describe('Stinky meals', () => {
  it('lays the week out Monday first', () => {
    const days = weekOf('2026-10-22')
    expect(days[0]).toBe('2026-10-19')
    expect(days[6]).toBe('2026-10-25')
  })

  it('knows the next thing his meals unlock', () => {
    expect(nextReward(BASE)).toEqual({ accessory: 'cascabel', at: 7 })
    expect(nextReward({ ...BASE, level: 6 })).toBeNull()
  })

  it('asks what you wore, with the photo way out, while he is hungry', () => {
    renderCard(BASE)
    expect(screen.getByRole('heading', { name: '¿Qué te has puesto hoy?' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /¿Llevas otra cosa\?/ })).toHaveAttribute('href', '/dashboard/selfie')
    expect(screen.getByText('2 comidas para el cascabel')).toBeInTheDocument()
    expect(screen.getByText('Racha de 2 semanas')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Tu mes/ })).toHaveAttribute('href', '/dashboard/wrapped')
  })

  it('says he ate, quietly: no face, no paragraph', () => {
    renderCard({ ...BASE, fed_today: true, week_days: ['2026-10-20', '2026-10-22'] })
    expect(screen.getByRole('heading', { name: '¡Ñam! Hoy ya he comido' })).toBeInTheDocument()
    expect(screen.queryByTestId('stinky')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /otra cosa/ })).not.toBeInTheDocument()
  })

  it('welcomes you back instead of scolding', () => {
    renderCard({ ...BASE, welcome_back: true })
    expect(screen.getByRole('heading', { name: '¡Has vuelto!' })).toBeInTheDocument()
  })

  it('offers to dress him once something is unlocked and not worn', () => {
    renderCard({ ...BASE, accessory: null })
    expect(screen.getByRole('link', { name: /Ponle la pajarita/ })).toHaveAttribute(
      'href',
      '/dashboard/stinky/customize#armario'
    )
  })

  it('has every habit message in both languages', () => {
    const keys = (o: object): string[] =>
      Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v).map((s) => `${k}.${s}`) : [k]))
    expect(keys(es.habit).sort()).toEqual(keys(en.habit).sort())
    expect(keys(es.wrapped).sort()).toEqual(keys(en.wrapped).sort())
  })
})
