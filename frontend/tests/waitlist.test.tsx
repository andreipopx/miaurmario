import { describe, it, expect, vi, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import React from 'react'

import { WaitlistCard } from '@/components/waitlist-card'
import { adminBadgeTotal, WAITLIST_MESSAGE_MAX } from '@/lib/admin'
import esMessages from '@/messages/es.json'

function renderCard(props: React.ComponentProps<typeof WaitlistCard> = {}) {
  return render(
    <NextIntlClientProvider locale="es" messages={esMessages}>
      <WaitlistCard {...props} />
    </NextIntlClientProvider>
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('adminBadgeTotal', () => {
  it('adds new feedback and pending waitlist requests', () => {
    expect(adminBadgeTotal({ feedback_new: 2, waitlist_pending: 3 })).toBe(5)
    expect(adminBadgeTotal({ feedback_new: 1 })).toBe(1)
    expect(adminBadgeTotal(undefined)).toBe(0)
  })
})

describe('WaitlistCard', () => {
  it('shows the closed-beta notice and a visible waitlist link', () => {
    renderCard()
    expect(screen.getByText('Miaurmario está en beta cerrada')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Apúntate a la lista de espera/ })).toBeTruthy()
  })

  it('prefills the typed email and posts the request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 202 })
    vi.stubGlobal('fetch', fetchMock)
    renderCard({ email: 'ana@example.com', defaultOpen: true })

    const email = screen.getByLabelText('Tu correo') as HTMLInputElement
    expect(email.value).toBe('ana@example.com')
    const message = screen.getByLabelText('¿Por qué quieres entrar? (opcional)') as HTMLTextAreaElement
    expect(message.maxLength).toBe(WAITLIST_MESSAGE_MAX)
    fireEvent.change(screen.getByLabelText('Tu nombre (opcional)'), { target: { value: ' Ana ' } })
    fireEvent.change(message, { target: { value: 'Quiero probar a Stinky' } })
    expect(screen.getByText(`22/${WAITLIST_MESSAGE_MAX}`)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Apuntarme' }))

    await waitFor(() => expect(screen.getByText('¡Apuntado!')).toBeTruthy())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/waitlist')
    expect(JSON.parse(init.body)).toEqual({
      email: 'ana@example.com',
      name: 'Ana',
      message: 'Quiero probar a Stinky',
      locale: 'es',
    })
  })

  it('explains rate limiting', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 429 }))
    renderCard({ email: 'x@example.com', defaultOpen: true })
    fireEvent.click(screen.getByRole('button', { name: 'Apuntarme' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Demasiados intentos/))
  })
})
