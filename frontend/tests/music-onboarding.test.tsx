import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

import esMessages from '@/messages/es.json'
import enMessages from '@/messages/en.json'

const { apiPost } = vi.hoisted(() => ({ apiPost: vi.fn() }))

// Only the POST is faked; ApiError stays the real class so the 429 branch is
// exercised the way the app sees it.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: { ...actual.api, post: (...args: unknown[]) => apiPost(...args) },
  }
})

import { ApiError } from '@/lib/api'

import { LastfmGuide, LASTFM_APPS_URL, LASTFM_JOIN_URL, LASTFM_PRIVACY_URL } from '@/components/music/lastfm-guide'
import { SpotifySeatRequest } from '@/components/music/spotify-seat-request'

function renderWithProviders(ui: React.ReactElement, locale: 'es' | 'en' = 'es') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale={locale} messages={locale === 'en' ? enMessages : esMessages}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>
  )
}

const keys = (o: object, prefix = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]
  )

describe('LastfmGuide', () => {
  it('starts collapsed and opens the three steps on demand', () => {
    renderWithProviders(<LastfmGuide />)
    const toggle = screen.getByRole('button', { name: /Ver la guía en 3 pasos/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText(/Crea tu cuenta en Last.fm/)).toBeNull()

    fireEvent.click(toggle)

    expect(screen.getByRole('button', { name: /Ocultar la guía/ }).getAttribute('aria-expanded')).toBe('true')
    const steps = screen.getAllByRole('listitem')
    expect(steps).toHaveLength(3)
    expect(steps[0].textContent).toMatch(/Crea tu cuenta en Last.fm/)
    expect(steps[1].textContent).toMatch(/scrobbling/)
    expect(steps[2].textContent).toMatch(/Pega tu usuario aquí/)
  })

  it('is already open when the user has nothing connected, and links out to last.fm', () => {
    renderWithProviders(<LastfmGuide defaultOpen />)
    expect(screen.getByRole('button', { name: /Ocultar la guía/ })).toBeTruthy()

    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(hrefs).toContain(LASTFM_JOIN_URL)
    expect(hrefs).toContain(LASTFM_APPS_URL)
    expect(hrefs).toContain(LASTFM_PRIVACY_URL)
    for (const a of screen.getAllByRole('link')) {
      expect(a.getAttribute('target')).toBe('_blank')
      expect(a.getAttribute('rel')).toContain('noopener')
    }
  })

  it('says the listens must be public and where that setting lives', () => {
    renderWithProviders(<LastfmGuide defaultOpen />)
    expect(screen.getByText(/Tus escuchas tienen que ser públicas/)).toBeTruthy()
    expect(screen.getByText(/Privacidad/)).toBeTruthy()
  })
})

describe('SpotifySeatRequest', () => {
  beforeEach(() => {
    apiPost.mockReset()
  })

  it('sends only the Spotify email and confirms that Andrei was asked', async () => {
    apiPost.mockResolvedValue({ status: 'ok' })
    renderWithProviders(<SpotifySeatRequest defaultOpen />)

    fireEvent.change(screen.getByLabelText('Correo de tu cuenta de Spotify'), {
      target: { value: ' fan@spotify.example ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Pedir plaza' }))

    await waitFor(() => expect(screen.getByText('Plaza pedida')).toBeTruthy())
    expect(screen.getByText(/se lo hemos pedido a Andrei/i)).toBeTruthy()
    expect(apiPost).toHaveBeenCalledWith('/integrations/spotify/seat-request', {
      email: 'fan@spotify.example',
    })
  })

  it('opens from a button when it is not the first thing on the card', () => {
    renderWithProviders(<SpotifySeatRequest />)
    expect(screen.queryByLabelText('Correo de tu cuenta de Spotify')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Pedir plaza de Spotify' }))
    expect(screen.getByLabelText('Correo de tu cuenta de Spotify')).toBeTruthy()
  })

  it('refuses a non-email without calling the API', () => {
    renderWithProviders(<SpotifySeatRequest defaultOpen />)
    fireEvent.change(screen.getByLabelText('Correo de tu cuenta de Spotify'), {
      target: { value: 'nope' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Pedir plaza' }))
    expect(screen.getByRole('alert').textContent).toMatch(/Escribe el correo/)
    expect(apiPost).not.toHaveBeenCalled()
  })

  it('explains the rate limit instead of a raw error', async () => {
    apiPost.mockRejectedValue(new ApiError('too many', 429, null))
    renderWithProviders(<SpotifySeatRequest defaultOpen />)
    fireEvent.change(screen.getByLabelText('Correo de tu cuenta de Spotify'), {
      target: { value: 'fan@spotify.example' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Pedir plaza' }))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Ya se lo hemos pedido/))
  })

  it('falls back to a generic message on any other failure', async () => {
    apiPost.mockRejectedValue(new ApiError('boom', 500, null))
    renderWithProviders(<SpotifySeatRequest defaultOpen />)
    fireEvent.change(screen.getByLabelText('Correo de tu cuenta de Spotify'), {
      target: { value: 'fan@spotify.example' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Pedir plaza' }))

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/No hemos podido enviar la petición/)
    )
  })
})

describe('integrations copy', () => {
  it('keeps es and en in step', () => {
    expect(keys(esMessages.integrations).sort()).toEqual(keys(enMessages.integrations).sort())
  })

  it('tells the truth about Pinterest instead of blaming the server', () => {
    expect(esMessages.integrations.pinterest.notConfigured).toMatch(/Pendiente de que Pinterest/)
    expect(esMessages.integrations.pinterest.notConfigured).not.toMatch(/servidor/)
    expect(enMessages.integrations.pinterest.notConfigured).not.toMatch(/server/)
  })

  it('presents Last.fm as the one for everybody and Spotify as the limited one', () => {
    expect(esMessages.integrations.lastfm.availabilityBadge).toBe('Para todo el mundo')
    expect(esMessages.integrations.lastfm.availability).toMatch(/Para todo el mundo/)
    expect(esMessages.integrations.spotify.availability).toMatch(/Plazas limitadas/)
    expect(esMessages.integrations.spotify.errors.not_allowlisted).toMatch(/Pide una aquí abajo/)
  })

  it('gives every card a "what you get" line', () => {
    for (const key of ['lastfm', 'spotify', 'pinterest'] as const) {
      expect(esMessages.integrations[key].gives.length).toBeGreaterThan(10)
      expect(esMessages.integrations[key].availability.length).toBeGreaterThan(10)
    }
  })
})
