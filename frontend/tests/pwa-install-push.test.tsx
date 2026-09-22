import { describe, it, expect, vi, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import React from 'react'

import {
  detectPlatform,
  iosSupportsWebPush,
  iosVersion,
  isIOSUserAgent,
  pushSupport,
} from '@/lib/pwa/platform'
import { urlBase64ToUint8Array } from '@/lib/pwa/push'
import { InstallGuide, guideTabFor } from '@/components/install/install-guide'
import { InstallHint } from '@/components/install/install-hint'
import esMessages from '@/messages/es.json'

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  iphoneOld:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1',
  ipadDesktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  samsung:
    'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  huawei:
    'Mozilla/5.0 (Linux; Android 10; HarmonyOS; ELS-NX9) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/99.0.4844.88 HuaweiBrowser/14.0.5.302 Mobile Safari/537.36',
  androidWebView:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36',
  desktopChrome:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
}

function stubUA(ua: string, maxTouchPoints = 0) {
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(ua)
  Object.defineProperty(window.navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true })
}

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('detectPlatform', () => {
  it.each([
    [UA.iphone, 0, 'ios'],
    [UA.ipadDesktop, 5, 'ios'],
    [UA.ipadDesktop, 0, 'desktop'], // a real Mac
    [UA.androidChrome, 0, 'android-chrome'],
    [UA.samsung, 0, 'android-other'],
    [UA.androidWebView, 0, 'android-other'],
    [UA.huawei, 0, 'huawei'],
    [UA.desktopChrome, 0, 'desktop'],
  ] as const)('%s -> %s', (ua, touch, expected) => {
    expect(detectPlatform(ua, touch)).toBe(expected)
  })

  it('maps platforms onto guide tabs', () => {
    expect(guideTabFor('huawei')).toBe('other')
    expect(guideTabFor('android-other')).toBe('other')
    expect(guideTabFor('android-chrome')).toBe('android')
  })
})

describe('iOS versions', () => {
  it('parses the UA', () => {
    expect(iosVersion(UA.iphone)).toEqual([17, 4])
    expect(iosVersion(UA.androidChrome)).toBeNull()
    expect(isIOSUserAgent(UA.iphone)).toBe(true)
  })

  it('needs 16.4+ for web push', () => {
    expect(iosSupportsWebPush(UA.iphone)).toBe(true)
    expect(iosSupportsWebPush(UA.iphoneOld)).toBe(false)
    expect(iosSupportsWebPush(UA.iphone.replace('17_4', '16_4'))).toBe(true)
  })
})

describe('pushSupport', () => {
  const full = { hasServiceWorker: true, hasPushManager: true, hasNotification: true }

  it('asks iPhone users in a Safari tab to install first', () => {
    expect(pushSupport({ ua: UA.iphone, standalone: false, ...full })).toBe('needs-install')
    // A Safari tab on iOS has no PushManager at all: still "install", not "unsupported".
    expect(
      pushSupport({ ua: UA.iphone, standalone: false, hasServiceWorker: true, hasPushManager: false, hasNotification: false })
    ).toBe('needs-install')
  })

  it('works on the home-screen app and on Android Chrome', () => {
    expect(pushSupport({ ua: UA.iphone, standalone: true, ...full })).toBe('supported')
    expect(pushSupport({ ua: UA.androidChrome, standalone: false, ...full })).toBe('supported')
  })

  it('flags old iOS and browsers without the Push API', () => {
    expect(pushSupport({ ua: UA.iphoneOld, standalone: true, ...full })).toBe('ios-too-old')
    expect(
      pushSupport({ ua: UA.huawei, standalone: false, hasServiceWorker: true, hasPushManager: false, hasNotification: false })
    ).toBe('unsupported')
  })
})

describe('urlBase64ToUint8Array', () => {
  it('decodes base64url without padding', () => {
    // bytes 0xfb 0xff 0xfe -> "-__-" in base64url
    expect(Array.from(urlBase64ToUint8Array('-__-'))).toEqual([0xfb, 0xff, 0xfe])
    expect(urlBase64ToUint8Array('BJ8xjo_6pefUPs4NIAmsmkVRG5DBQpVB7SKtgjfbzLAOnQkjKhWkAhxOslehsVttlu7HJ5gO3X-Nlt1AS7dtVrQ').length).toBe(65)
  })
})

function withIntl(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="es" messages={esMessages}>
      {node}
    </NextIntlClientProvider>
  )
}

describe('InstallGuide', () => {
  it('opens on the detected platform (iPhone: Safari share steps + push note)', () => {
    stubUA(UA.iphone)
    withIntl(<InstallGuide />)
    expect(screen.getByRole('tab', { name: /iPhone/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getAllByText(/Añadir a pantalla de inicio/).length).toBeGreaterThan(0)
    expect(screen.getByText(/También en la UE/)).toBeTruthy()
  })

  it('Huawei users get the menu steps and the "use Chrome for push" note', () => {
    stubUA(UA.huawei)
    withIntl(<InstallGuide />)
    expect(screen.getByRole('tab', { name: /Huawei/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText(/usa Chrome/)).toBeTruthy()
  })

  it('lets people switch platform by hand', () => {
    stubUA(UA.desktopChrome)
    withIntl(<InstallGuide />)
    fireEvent.click(screen.getByRole('tab', { name: /Android/ }))
    expect(screen.getByText(/Instalar aplicación/)).toBeTruthy()
  })
})

describe('InstallHint', () => {
  it('shows once on mobile browsers and stays dismissed', () => {
    stubUA(UA.androidChrome)
    const { unmount } = withIntl(<InstallHint />)
    expect(screen.getByText(/Instala Miaurmario en tu móvil/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(screen.queryByText(/Instala Miaurmario en tu móvil/)).toBeNull()
    unmount()
    withIntl(<InstallHint />)
    expect(screen.queryByText(/Instala Miaurmario en tu móvil/)).toBeNull()
  })

  it('never shows on desktop', () => {
    stubUA(UA.desktopChrome)
    withIntl(<InstallHint />)
    expect(screen.queryByText(/Instala Miaurmario en tu móvil/)).toBeNull()
  })
})
