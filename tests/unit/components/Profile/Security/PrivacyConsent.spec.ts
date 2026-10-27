import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { shallowRef } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LegalConsentState } from '#shared/types/legal-consent.d'
import PrivacyConsent from '../../../../../app/components/Profile/Security/PrivacyConsent.vue'

const mocks = vi.hoisted(() => ({
  state: { value: null as unknown },
  load: vi.fn(),
  openConsentModal: vi.fn(),
  withdrawConsent: vi.fn(),
  withdrawTransferConsent: vi.fn(),
  requestAccountDeletion: vi.fn(),
  confirm: vi.fn(),
  useInfoMessage: vi.fn(),
}))

mockNuxtImport('useLegalConsent', () => () => ({
  state: mocks.state,
  isSaving: shallowRef(false),
  load: mocks.load,
  openConsentModal: mocks.openConsentModal,
  withdrawConsent: mocks.withdrawConsent,
  withdrawTransferConsent: mocks.withdrawTransferConsent,
}))
mockNuxtImport('useAccountDeletion', () => () => ({
  isDeleting: shallowRef(false),
  requestAccountDeletion: mocks.requestAccountDeletion,
}))
mockNuxtImport('useConfirm', () => mocks.confirm)
mockNuxtImport('useInfoMessage', () => mocks.useInfoMessage)

enableAutoUnmount(afterEach)

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
        route: 'direct',
        consentedAt: '2026-11-01T00:00:00.000Z',
        withdrawnAt: null,
        isGranted: true,
      },
      {
        providerId: 'moonshotai',
        label: 'Moonshot AI',
        country: 'Singapore',
        route: 'direct',
        consentedAt: null,
        withdrawnAt: null,
        isGranted: false,
      },
      {
        providerId: 'qwen',
        label: 'Qwen',
        country: 'Singapore',
        route: 'direct',
        consentedAt: null,
        withdrawnAt: null,
        isGranted: false,
      },
      {
        providerId: 'zai',
        label: 'Z.ai (Zhipu AI)',
        country: 'Singapore',
        route: 'gateway',
        consentedAt: null,
        withdrawnAt: null,
        isGranted: false,
      },
      {
        providerId: 'router',
        label: 'Router and preset models',
        country: 'any country, including China and Singapore',
        route: 'router',
        consentedAt: null,
        withdrawnAt: null,
        isGranted: false,
      },
    ],
    ...overrides,
  }
}

describe('Privacy & consent block', () => {
  beforeEach(() => {
    mocks.state = shallowRef(consentState())
    mocks.load.mockReset()
    mocks.openConsentModal.mockReset()
    mocks.withdrawConsent.mockReset()
    mocks.withdrawConsent.mockResolvedValue(true)
    mocks.withdrawTransferConsent.mockReset()
    mocks.withdrawTransferConsent.mockResolvedValue(true)
    mocks.requestAccountDeletion.mockReset()
    mocks.confirm.mockReset()
    mocks.confirm.mockResolvedValue({ index: 0 })
  })

  it('shows the version consented to and offers withdrawal', async () => {
    const wrapper = await mountSuspended(PrivacyConsent)

    expect(mocks.load).toHaveBeenCalledWith({ force: true })
    expect(wrapper.get('[data-testid="privacy-consent-status"]').text())
      .toContain('2026-11-a')
    expect(wrapper.find('[data-testid="privacy-consent-withdraw"]').exists())
      .toBe(true)
  })

  it('says when gateway-only and router consents are asked', async () => {
    const wrapper = await mountSuspended(PrivacyConsent)

    expect(wrapper.get('[data-testid="privacy-consent-transfer-qwen"]').text())
      .toContain('Asked when you add a Qwen key')
    expect(wrapper.get('[data-testid="privacy-consent-transfer-zai"]').text())
      .toContain('Asked before your first message to Z.ai (Zhipu AI) models '
        + 'through a gateway')
    expect(wrapper.get('[data-testid="privacy-consent-transfer-router"]')
      .text()).toContain('router or preset model')
  })

  it('withdraws only after a confirmation', async () => {
    mocks.confirm.mockResolvedValueOnce(null)

    const wrapper = await mountSuspended(PrivacyConsent)

    await wrapper.get('[data-testid="privacy-consent-withdraw"]')
      .trigger('click')
    await flushPromises()

    expect(mocks.withdrawConsent).not.toHaveBeenCalled()

    await wrapper.get('[data-testid="privacy-consent-withdraw"]')
      .trigger('click')
    await flushPromises()

    expect(mocks.withdrawConsent).toHaveBeenCalledTimes(1)
  })

  it('offers re-consent and account deletion after withdrawal', async () => {
    mocks.state = shallowRef(consentState({
      status: 'withdrawn',
      sensitiveContentConsentWithdrawnAt: '2026-11-02T00:00:00.000Z',
    }))

    const wrapper = await mountSuspended(PrivacyConsent)

    await wrapper.get('[data-testid="privacy-consent-give"]')
      .trigger('click')
    await wrapper.get('[data-testid="privacy-consent-delete-account"]')
      .trigger('click')

    expect(mocks.openConsentModal).toHaveBeenCalledTimes(1)
    expect(mocks.requestAccountDeletion).toHaveBeenCalledTimes(1)
  })

  it('lists transfer consents and withdraws one provider', async () => {
    const wrapper = await mountSuspended(PrivacyConsent)

    expect(wrapper.get('[data-testid="privacy-consent-transfer-deepseek"]')
      .text()).toContain('DeepSeek in China')
    expect(wrapper.find(
      '[data-testid="privacy-consent-transfer-withdraw-qwen"]',
    ).exists()).toBe(false)

    await wrapper.get(
      '[data-testid="privacy-consent-transfer-withdraw-deepseek"]',
    ).trigger('click')
    await flushPromises()

    expect(mocks.withdrawTransferConsent).toHaveBeenCalledWith('deepseek')
  })
})
