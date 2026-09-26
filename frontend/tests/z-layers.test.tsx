/**
 * The app's stacking order.
 *
 * The upload status bar used to hide behind the wardrobe's pagination row, so
 * these specs pin both halves of the fix: the named layer scale (one source of
 * truth, in globals.css and tailwind.config.js) and where the bar actually
 * renders — above the dock and the page's own floating pills, below drawers,
 * dialogs and toasts, and never in the same bottom slot as the pagination.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import React from 'react'

import es from '@/messages/es.json'

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: unknown }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

const queue = vi.hoisted(() => ({
  photos: [{ id: 'p1', name: 'camisa.jpg', state: 'uploading', progress: 40 }],
  counts: { total: 3, saved: 1, duplicate: 0, failed: 0, busy: 2, settled: false },
}))
vi.mock('@/lib/bulk-upload/bulk-upload-context', () => ({
  useBulkUpload: () => queue,
}))

import { UploadStatusBar } from '@/components/bulk-upload/upload-status-bar'
import { BulkActionToolbar } from '@/components/bulk-action-toolbar'

const root = path.resolve(__dirname, '..')
const globalsCss = readFileSync(path.join(root, 'app/globals.css'), 'utf8')
const tailwind = readFileSync(path.join(root, 'tailwind.config.js'), 'utf8')

/** The scale, lowest first. */
const ORDER = [
  'page',
  'header',
  'dock',
  'float',
  'status',
  'drawer',
  'modal',
  'popover',
  'lightbox',
  'toast',
] as const

function layerValue(name: string): number {
  const match = globalsCss.match(new RegExp(`--z-${name}:\\s*(\\d+);`))
  expect(match, `--z-${name} is defined in app/globals.css`).toBeTruthy()
  return Number(match![1])
}

/** Unprefixed classes only: `lg:bottom-float-1` is a different question. */
function classesOf(el: HTMLElement): string[] {
  return el.className.split(/\s+/).filter((c) => c && !c.includes(':'))
}

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="es" messages={es}>
      {ui}
    </NextIntlClientProvider>
  )
}

describe('layer tokens', () => {
  it('defines every layer once, in order, and maps it to a Tailwind class', () => {
    const values = ORDER.map(layerValue)
    expect(values).toEqual([...values].sort((a, b) => a - b))
    expect(new Set(values).size).toBe(values.length)
    for (const name of ORDER) {
      expect(tailwind).toContain(`${name}: 'var(--z-${name})'`)
    }
  })

  it('keeps the third-party layers on the scale instead of their own numbers', () => {
    // yet-another-react-lightbox defaults to 9999, sonner to 999999999.
    expect(globalsCss).toContain('--yarl__portal_zindex: var(--z-lightbox);')
    expect(globalsCss).toMatch(/\[data-sonner-toaster\]\s*\{[^}]*z-index:\s*var\(--z-toast\);/)
    expect(layerValue('toast')).toBeGreaterThan(layerValue('lightbox'))
  })

  it('puts the upload status bar above the page and below anything modal', () => {
    const status = layerValue('status')
    expect(status).toBeGreaterThan(layerValue('dock'))
    expect(status).toBeGreaterThan(layerValue('float'))
    expect(status).toBeLessThan(layerValue('drawer'))
    expect(status).toBeLessThan(layerValue('modal'))
    expect(status).toBeLessThan(layerValue('toast'))
  })

  it('stacks the bottom slots far enough apart to clear a 44px tap target', () => {
    expect(globalsCss).toContain('--float-slot-2: calc(var(--float-slot-1) + var(--float-slot-height));')
    const height = globalsCss.match(/--float-slot-height:\s*([\d.]+)rem;/)
    expect(height).toBeTruthy()
    // 44px target + 12px of pill padding, in rem so it still clears at 125% font size.
    expect(Number(height![1])).toBeGreaterThanOrEqual(3.5)
  })
})

describe('upload status bar', () => {
  it('carries the status layer and the second floating slot', () => {
    renderWithIntl(<UploadStatusBar />)
    const bar = screen.getByTestId('bulk-status-bar')
    expect(classesOf(bar)).toContain('z-status')
    expect(classesOf(bar)).toContain('bottom-float-2')
    // No inline z-index/bottom sneaking back in beside the tokens.
    expect(bar.getAttribute('style')).toBeNull()
  })

  it('reserves the room it floats in, so it cannot sit on the last row', () => {
    expect(globalsCss).toMatch(/\.pb-dock\s*\{[^}]*var\(--float-extra, 0px\)/)
    const { unmount } = renderWithIntl(<UploadStatusBar />)
    expect(document.documentElement.style.getPropertyValue('--float-extra')).toBe('var(--float-slot-height)')
    unmount()
    expect(document.documentElement.style.getPropertyValue('--float-extra')).toBe('')
  })

  it('does not share its slot or its layer with the wardrobe pagination', () => {
    renderWithIntl(
      <>
        <UploadStatusBar />
        <BulkActionToolbar
          selection={{ mode: 'none', selectedIds: new Set(), excludedIds: new Set() }}
          totalItems={60}
          pageItems={20}
          onSelectAll={() => {}}
          onSelectAllMatching={() => {}}
          onClear={() => {}}
          onDelete={() => {}}
          onReanalyze={() => {}}
          page={1}
          pageSize={20}
          onPageChange={() => {}}
        />
      </>
    )
    const bar = screen.getByTestId('bulk-status-bar')
    const toolbar = screen.getByRole('toolbar')
    // The pagination row is real: "1/3" with its arrows.
    expect(screen.getByText('1/3')).toBeInTheDocument()

    expect(classesOf(toolbar)).toContain('bottom-float-1')
    expect(classesOf(toolbar)).toContain('z-float')
    expect(classesOf(bar)).not.toContain('bottom-float-1')
    expect(classesOf(bar)).not.toContain('z-float')
    expect(layerValue('status')).toBeGreaterThan(layerValue('float'))
  })
})
