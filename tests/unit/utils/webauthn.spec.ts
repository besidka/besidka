import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  isPasskeyCeremonyCancelled,
} from '../../../app/utils/webauthn'

describe('browserSupportsWebAuthn', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns false when PublicKeyCredential is not defined', () => {
    vi.stubGlobal('PublicKeyCredential', undefined)

    expect(browserSupportsWebAuthn()).toBe(false)
  })

  it('returns true when PublicKeyCredential is defined', () => {
    vi.stubGlobal('PublicKeyCredential', {})

    expect(browserSupportsWebAuthn()).toBe(true)
  })
})

describe('browserSupportsWebAuthnAutofill', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns false when PublicKeyCredential is not defined', async () => {
    vi.stubGlobal('PublicKeyCredential', undefined)

    expect(await browserSupportsWebAuthnAutofill()).toBe(false)
  })

  it(
    'returns false when isConditionalMediationAvailable is not a function',
    async () => {
      vi.stubGlobal('PublicKeyCredential', {})

      expect(await browserSupportsWebAuthnAutofill()).toBe(false)
    },
  )

  it(
    'resolves whatever isConditionalMediationAvailable resolves',
    async () => {
      vi.stubGlobal('PublicKeyCredential', {
        isConditionalMediationAvailable: vi.fn(async () => true),
      })

      expect(await browserSupportsWebAuthnAutofill()).toBe(true)

      vi.stubGlobal('PublicKeyCredential', {
        isConditionalMediationAvailable: vi.fn(async () => false),
      })

      expect(await browserSupportsWebAuthnAutofill()).toBe(false)
    },
  )
})

describe('isPasskeyCeremonyCancelled', () => {
  it('returns false when no code is given', () => {
    expect(isPasskeyCeremonyCancelled(undefined)).toBe(false)
  })

  it('returns false for an unrelated error code', () => {
    expect(isPasskeyCeremonyCancelled('AUTHENTICATION_FAILED')).toBe(false)
  })

  it('returns true when the user dismissed the browser prompt', () => {
    expect(isPasskeyCeremonyCancelled('ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY'))
      .toBe(true)
  })

  it('returns true when the ceremony was programmatically aborted', () => {
    expect(isPasskeyCeremonyCancelled('ERROR_CEREMONY_ABORTED')).toBe(true)
  })
})
