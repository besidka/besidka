import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LegalConsentState } from '#shared/types/legal-consent.d'
import { useLegalConsent } from '../../../app/composables/legal-consent'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  useErrorMessage: vi.fn(),
}))

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useErrorMessage', () => mocks.useErrorMessage)

function consentState(
  overrides: Partial<LegalConsentState> = {},
): LegalConsentState {
  return {
    currentVersion: '2026-11-a',
    status: 'current',
    termsAcceptedAt: '2026-11-01T00:00:00.000Z',
    termsVersion: '2026-11-a',
    ageConfirmedAt: '2026-11-01T00:00:00.000Z',
    sensitiveContentConsentAt: '2026-11-01T00:00:00.000Z',
    sensitiveContentConsentVersion: '2026-11-a',
    sensitiveContentConsentWithdrawnAt: null,
    transfers: [
      {
        providerId: 'deepseek',
        label: 'DeepSeek',
        country: 'China',
        consentedAt: null,
        withdrawnAt: null,
        isGranted: false,
      },
      {
        providerId: 'moonshotai',
        label: 'Moonshot AI',
        country: 'Singapore',
        consentedAt: null,
        withdrawnAt: null,
        isGranted: false,
      },
      {
        providerId: 'qwen',
        label: 'Qwen',
        country: 'Singapore',
        consentedAt: '2026-11-01T00:00:00.000Z',
        withdrawnAt: null,
        isGranted: true,
      },
    ],
    ...overrides,
  }
}

describe('useLegalConsent', () => {
  beforeEach(() => {
    const consent = useLegalConsent()

    consent.bindUser(null)
    consent.reset()
    mocks.fetch.mockReset()
    mocks.useErrorMessage.mockReset()
  })

  it('lets a send through without a dialog when consent is current',
    async () => {
      mocks.fetch.mockResolvedValue(consentState())

      const consent = useLegalConsent()

      expect(await consent.ensureSendConsent('openai')).toBe(true)
      expect(consent.isConsentModalOpen.value).toBe(false)
      expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/profiles/consent')
    })

  it('opens the consent dialog and waits for the answer', async () => {
    mocks.fetch.mockResolvedValue(consentState({ status: 'missing' }))

    const consent = useLegalConsent()
    const result = consent.ensureSendConsent('openai')

    await flushPromises()

    expect(consent.isConsentModalOpen.value).toBe(true)

    consent.resolveConsentModal(false)

    expect(await result).toBe(false)
    expect(consent.isConsentModalOpen.value).toBe(false)
  })

  it('continues to the send after the user consents', async () => {
    mocks.fetch.mockResolvedValue(consentState({ status: 'withdrawn' }))

    const consent = useLegalConsent()
    const result = consent.ensureSendConsent(null)

    await flushPromises()
    consent.resolveConsentModal(true)

    expect(await result).toBe(true)
  })

  it('asks for a transfer consent before a DeepSeek send', async () => {
    mocks.fetch.mockResolvedValue(consentState())

    const consent = useLegalConsent()
    const result = consent.ensureSendConsent('deepseek')

    await flushPromises()

    expect(consent.transferRequest.value).toEqual({
      providerId: 'deepseek',
      context: 'send',
    })

    consent.resolveTransferModal(false)

    expect(await result).toBe(false)
  })

  it('needs no transfer dialog once that transfer is granted', async () => {
    mocks.fetch.mockResolvedValue(consentState())

    const consent = useLegalConsent()

    expect(await consent.ensureSendConsent('qwen')).toBe(true)
    expect(consent.transferRequest.value).toBeNull()
  })

  it('asks for the transfer consent when a key is added', async () => {
    mocks.fetch.mockResolvedValue(consentState())

    const consent = useLegalConsent()
    const result = consent.ensureTransferConsent('moonshotai', 'key')

    await flushPromises()

    expect(consent.transferRequest.value).toEqual({
      providerId: 'moonshotai',
      context: 'key',
    })

    consent.resolveTransferModal(true)

    expect(await result).toBe(true)
  })

  it('leaves the decision to the server when the status cannot load',
    async () => {
      mocks.fetch.mockRejectedValue(new Error('offline'))

      const consent = useLegalConsent()

      expect(await consent.ensureSendConsent('deepseek')).toBe(true)
    })

  it('posts both boxes with the version it showed', async () => {
    mocks.fetch.mockResolvedValueOnce(consentState({ status: 'missing' }))
    mocks.fetch.mockResolvedValueOnce(consentState())

    const consent = useLegalConsent()

    await consent.load({ force: true })

    expect(await consent.giveConsent()).toBe(true)
    expect(mocks.fetch).toHaveBeenLastCalledWith(
      '/api/v1/profiles/consent',
      {
        method: 'POST',
        body: {
          version: '2026-11-a',
          acceptTerms: true,
          confirmAge: true,
          sensitiveContentConsent: true,
        },
      },
    )
    expect(consent.isCurrent.value).toBe(true)
  })

  it('shows the server error and keeps the state when saving fails',
    async () => {
      mocks.fetch.mockResolvedValueOnce(consentState({ status: 'current' }))
      mocks.fetch.mockRejectedValueOnce(new Error('Forbidden'))

      const consent = useLegalConsent()

      await consent.load({ force: true })

      expect(await consent.withdrawConsent()).toBe(false)
      expect(mocks.useErrorMessage).toHaveBeenCalled()
      expect(consent.isCurrent.value).toBe(true)
    })

  describe('per-user cache', () => {
    it('never reuses another user\'s state', async () => {
      mocks.fetch.mockResolvedValueOnce(consentState())
      mocks.fetch.mockResolvedValueOnce(consentState({ status: 'missing' }))

      const consent = useLegalConsent()

      consent.bindUser('user-1')
      await consent.load()

      expect(consent.isCurrent.value).toBe(true)

      consent.bindUser('user-2')

      expect(consent.state.value).toBeNull()

      const result = consent.ensureSendConsent('openai')

      await flushPromises()

      expect(mocks.fetch).toHaveBeenCalledTimes(2)
      expect(consent.isConsentModalOpen.value).toBe(true)

      consent.resolveConsentModal(false)

      expect(await result).toBe(false)
    })

    it('discards a response that arrives after the user changed',
      async () => {
        let resolveFirst: (value: LegalConsentState) => void = () => {}

        mocks.fetch.mockImplementationOnce(() => {
          return new Promise((resolve) => {
            resolveFirst = resolve
          })
        })

        const consent = useLegalConsent()

        consent.bindUser('user-1')

        const pending = consent.load()

        consent.bindUser('user-2')
        resolveFirst(consentState())

        expect(await pending).toBeNull()
        expect(consent.state.value).toBeNull()
      })

    it('clears the state and refuses an open dialog on sign-out',
      async () => {
        mocks.fetch.mockResolvedValue(consentState({ status: 'missing' }))

        const consent = useLegalConsent()

        consent.bindUser('user-1')

        const result = consent.ensureSendConsent('openai')

        await flushPromises()

        expect(consent.isConsentModalOpen.value).toBe(true)

        consent.bindUser(null)

        expect(await result).toBe(false)
        expect(consent.state.value).toBeNull()
        expect(consent.isConsentModalOpen.value).toBe(false)
      })

    it('keeps the cache while the same user stays signed in', async () => {
      mocks.fetch.mockResolvedValue(consentState())

      const consent = useLegalConsent()

      consent.bindUser('user-1')
      await consent.load()
      consent.bindUser('user-1')
      await consent.load()

      expect(mocks.fetch).toHaveBeenCalledTimes(1)
    })
  })
})
