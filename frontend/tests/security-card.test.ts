import { describe, it, expect } from 'vitest'
import { ApiError } from '@/lib/api'
import { PasswordRequestError } from '@/lib/hooks/use-password'
import { localPasswordError, passwordErrorKey } from '@/components/settings/security-card'
import es from '@/messages/es.json'
import en from '@/messages/en.json'

describe('security card helpers', () => {
  it('maps backend error codes to message keys', () => {
    expect(passwordErrorKey(new PasswordRequestError('password_too_common', 422))).toBe(
      'password_too_common',
    )
    expect(passwordErrorKey(new PasswordRequestError('current_password_invalid', 400))).toBe(
      'current_password_invalid',
    )
    expect(passwordErrorKey(new PasswordRequestError('Too many requests', 429))).toBe('rateLimited')
    expect(passwordErrorKey(new PasswordRequestError('boom', 500))).toBe('generic')
    // Raw ApiErrors never reach the card (they'd also trigger the global toast).
    expect(passwordErrorKey(new ApiError('password_too_common', 422, {}))).toBe('generic')
    expect(passwordErrorKey(new Error('x'))).toBe('generic')
  })

  it('pre-checks length and confirmation locally', () => {
    expect(localPasswordError('short', 'short')).toBe('password_too_short')
    expect(localPasswordError('y'.repeat(129), 'y'.repeat(129))).toBe('password_too_long')
    expect(localPasswordError('long-enough-1', 'long-enough-2')).toBe('mismatch')
    expect(localPasswordError('long-enough-1', 'long-enough-1')).toBeNull()
  })

  it('has every error key in both locales', () => {
    const keys = [
      'mismatch',
      'current_password_required',
      'current_password_invalid',
      'password_too_short',
      'password_too_long',
      'password_too_common',
      'password_matches_identity',
      'rateLimited',
      'generic',
    ]
    for (const messages of [es, en]) {
      const errors = messages.settings.security.errors as Record<string, string>
      for (const k of keys) expect(errors[k], k).toBeTruthy()
      expect(Object.keys(messages.login.password).sort()).toEqual(
        Object.keys(es.login.password).sort(),
      )
    }
  })
})
