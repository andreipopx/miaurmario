import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

import {
  NOTIFICATION_EVENTS,
  TIMED_EVENTS,
  TIMED_EVENT_TIME_KEY,
  type NotificationPreferences,
} from '@/lib/hooks/use-notifications'
import es from '@/messages/es.json'
import en from '@/messages/en.json'

// ---- mocks -----------------------------------------------------------------------

const h = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), post: vi.fn() }))

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { accessToken: 'tok' }, status: 'authenticated' }),
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

vi.mock('@/lib/api', async (orig) => {
  const actual = await orig<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, get: h.get, patch: h.patch, post: h.post } }
})

vi.mock('@/lib/pwa/use-push-device', () => ({
  usePushDevice: () => ({
    support: 'supported',
    permission: 'granted',
    subscribed: true,
    busy: false,
    enable: vi.fn(),
    disable: vi.fn(),
  }),
}))

import { DefaultChannelsCard } from '@/components/notifications/default-channels'

// ---- helpers ---------------------------------------------------------------------

function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) =>
    value && typeof value === 'object'
      ? flatten(value as Record<string, unknown>, `${prefix}${key}.`)
      : [`${prefix}${key}`]
  )
}

/** What the API returns for somebody who never opened Notificaciones. */
const defaultPrefs = (over: Partial<NotificationPreferences> = {}): NotificationPreferences => ({
  email: {
    friend_request: true,
    friend_accepted: true,
    daily_outfit: true,
    morning_look: false,
    friend_activity: false,
  },
  push: {
    friend_request: true,
    friend_accepted: true,
    daily_outfit: true,
    morning_look: false,
    friend_activity: true,
  },
  email_address: 'yo@example.com',
  email_available: true,
  push_available: true,
  vapid_public_key: 'BKey',
  push_devices: 1,
  morning_look_time: '07:30',
  friend_activity_time: '20:00',
  ...over,
})

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="es" messages={es}>
        <DefaultChannelsCard />
      </NextIntlClientProvider>
    </QueryClientProvider>
  )
}

const rowFor = async (title: string) =>
  (await screen.findByText(title)).closest('li') as HTMLElement

beforeEach(() => {
  h.get.mockReset().mockResolvedValue(defaultPrefs())
  h.patch.mockReset().mockImplementation(async (_url: string, body: object) => ({
    ...defaultPrefs(),
    ...body,
  }))
  h.post.mockReset()
})

// ---- copy ------------------------------------------------------------------------

describe('daily alert copy', () => {
  it('has the same keys in Spanish and English', () => {
    const esDefaults = es.notifications.defaults as unknown as Record<string, unknown>
    const enDefaults = en.notifications.defaults as unknown as Record<string, unknown>
    expect(flatten(enDefaults).sort()).toEqual(flatten(esDefaults).sort())
    expect(flatten(en.unsubscribe.scopes as unknown as Record<string, unknown>).sort()).toEqual(
      flatten(es.unsubscribe.scopes as unknown as Record<string, unknown>).sort()
    )
  })

  it('names every event, in both languages, including the unsubscribe scopes', () => {
    for (const messages of [es, en]) {
      const events = messages.notifications.defaults.events as Record<string, unknown>
      const scopes = messages.unsubscribe.scopes as Record<string, unknown>
      for (const event of NOTIFICATION_EVENTS) {
        expect(events[event]).toBeTruthy()
        expect(scopes[event]).toBeTruthy()
      }
      for (const event of TIMED_EVENTS) {
        const copy = events[event] as Record<string, string>
        expect(copy.timeHint).toBeTruthy()
        expect(copy.offHint).toBeTruthy()
      }
    }
  })

  it('says what the defaults are', () => {
    expect(es.notifications.defaults.dailyDefaults).toMatch(/desactivado/i)
    expect(en.notifications.defaults.dailyDefaults).toMatch(/off/i)
  })
})

// ---- the matrix ------------------------------------------------------------------

describe('Notificaciones · daily alerts', () => {
  it('shows the morning look off, with no time picker until it is on', async () => {
    renderCard()
    const row = await rowFor(es.notifications.defaults.events.morning_look.title)
    expect(
      within(row).getByText(es.notifications.defaults.events.morning_look.offHint)
    ).toBeTruthy()
    expect(within(row).queryByLabelText(es.notifications.defaults.timeLabel)).toBeNull()
  })

  it('turns the morning look on in one tap', async () => {
    renderCard()
    const row = await rowFor(es.notifications.defaults.events.morning_look.title)
    const pushSwitch = within(row).getByLabelText(
      `${es.notifications.defaults.events.morning_look.title} · ${es.notifications.defaults.channels.push}`
    )
    fireEvent.click(pushSwitch)
    await waitFor(() =>
      expect(h.patch).toHaveBeenCalledWith('/notifications/preferences', {
        push: { morning_look: true },
      })
    )
  })

  it('offers the friend digest time, on by default for this device only', async () => {
    renderCard()
    const row = await rowFor(es.notifications.defaults.events.friend_activity.title)
    const time = within(row).getByLabelText(es.notifications.defaults.timeLabel) as HTMLInputElement
    expect(time.value).toBe('20:00')
    expect(
      (
        within(row).getByLabelText(
          `${es.notifications.defaults.events.friend_activity.title} · ${es.notifications.defaults.channels.email}`
        ) as HTMLInputElement
      ).getAttribute('data-state')
    ).toBe('unchecked')
  })

  it('saves a new time as soon as it is a whole hour and minute', async () => {
    renderCard()
    const row = await rowFor(es.notifications.defaults.events.friend_activity.title)
    const time = within(row).getByLabelText(es.notifications.defaults.timeLabel)
    fireEvent.change(time, { target: { value: '21:1' } })
    expect(h.patch).not.toHaveBeenCalled()
    fireEvent.change(time, { target: { value: '21:15' } })
    await waitFor(() =>
      expect(h.patch).toHaveBeenCalledWith('/notifications/preferences', {
        friend_activity_time: '21:15',
      })
    )
  })

  it('maps each timed event to its own time field', () => {
    expect(TIMED_EVENT_TIME_KEY).toEqual({
      morning_look: 'morning_look_time',
      friend_activity: 'friend_activity_time',
    })
  })
})
