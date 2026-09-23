import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import React from 'react'

import { HapticsCard } from '@/components/settings/haptics-card'
import { isNotificationHapticEnabled } from '@/lib/native/notification-haptic'
import esMessages from '@/messages/es.json'

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'

const t = esMessages.settings.haptics

function setUp(opts: {
  ua: string
  permission?: NotificationPermission
  hasRegistration?: boolean
  hasVibrate?: boolean
}) {
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(opts.ua)
  if (opts.hasVibrate) {
    Object.defineProperty(navigator, 'vibrate', { value: vi.fn(() => true), configurable: true, writable: true })
  }
  if (opts.permission) vi.stubGlobal('Notification', { permission: opts.permission })
  const registration = {
    showNotification: vi.fn(async () => {}),
    getNotifications: vi.fn(async () => []),
  }
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    writable: true,
    value: { getRegistration: vi.fn(async () => (opts.hasRegistration === false ? undefined : registration)) },
  })
  return registration
}

function renderCard() {
  return render(
    <NextIntlClientProvider locale="es" messages={esMessages}>
      <HapticsCard />
    </NextIntlClientProvider>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.localStorage.clear()
  // @ts-expect-error -- only present when a test installed it
  delete navigator.vibrate
  // @ts-expect-error -- only present when a test installed it
  delete navigator.serviceWorker
})

beforeEach(() => {
  window.localStorage.clear()
})

describe('HapticsCard — the iPhone notification experiment', () => {
  it('always shows the plain vibration test', async () => {
    setUp({ ua: ANDROID_UA, hasVibrate: true, permission: 'granted' })
    renderCard()
    expect(screen.getByRole('button', { name: t.test })).toBeInTheDocument()
  })

  it('stays hidden on Android, where the Vibration API already works', async () => {
    setUp({ ua: ANDROID_UA, hasVibrate: true, permission: 'granted' })
    renderCard()
    await waitFor(() => expect(screen.getByRole('button', { name: t.test })).toBeInTheDocument())
    expect(screen.queryByLabelText(t.notifyLabel)).not.toBeInTheDocument()
    expect(screen.queryByText(t.notifyNeedsPermission)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.notifyTest })).not.toBeInTheDocument()
  })

  it('offers the toggle on an iPhone once notifications are granted', async () => {
    setUp({ ua: IPHONE_UA, permission: 'granted' })
    renderCard()
    const toggle = await screen.findByLabelText(t.notifyLabel)
    expect(toggle).not.toBeChecked()
    expect(screen.getByText(t.notifyNote)).toBeInTheDocument()
    // The test button is there but useless until the experiment is switched on.
    expect(screen.getByRole('button', { name: t.notifyTest })).toBeDisabled()
  })

  it('points at Ajustes → Notificaciones when permission is missing', async () => {
    setUp({ ua: IPHONE_UA, permission: 'default' })
    renderCard()
    expect(await screen.findByText(t.notifyNeedsPermission)).toBeInTheDocument()
    expect(screen.queryByLabelText(t.notifyLabel)).not.toBeInTheDocument()
  })

  it('stays hidden without a service worker registration', async () => {
    setUp({ ua: IPHONE_UA, permission: 'granted', hasRegistration: false })
    renderCard()
    await waitFor(() => expect(screen.getByRole('button', { name: t.test })).toBeInTheDocument())
    expect(screen.queryByLabelText(t.notifyLabel)).not.toBeInTheDocument()
    expect(screen.queryByText(t.notifyNeedsPermission)).not.toBeInTheDocument()
  })

  it('stores the toggle on this device and enables the test button', async () => {
    setUp({ ua: IPHONE_UA, permission: 'granted' })
    renderCard()
    const toggle = await screen.findByLabelText(t.notifyLabel)
    fireEvent.click(toggle)
    await waitFor(() => expect(isNotificationHapticEnabled()).toBe(true))
    expect(screen.getByRole('button', { name: t.notifyTest })).toBeEnabled()

    fireEvent.click(toggle)
    await waitFor(() => expect(isNotificationHapticEnabled()).toBe(false))
  })
})
