import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, shallowRef } from 'vue'
import GeminiPaidTier
  from '../../../../../app/components/Profile/Keys/GeminiPaidTier.vue'
import { GOOGLE_DATA_PAID_TIER_STATEMENT } from '../../../../../shared/utils/google-data-recipient'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  refresh: vi.fn(),
  confirmed: null as unknown as { value: boolean },
  successMessage: vi.fn(),
  errorMessage: vi.fn(),
}))

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useSuccessMessage', () => mocks.successMessage)
mockNuxtImport('useErrorMessage', () => mocks.errorMessage)
mockNuxtImport('useUserKeys', () => {
  return () => ({
    isGeminiPaidTierConfirmed: computed(() => mocks.confirmed.value),
    refresh: mocks.refresh,
  })
})

async function flushPromises() {
  for (let tick = 0; tick < 6; tick += 1) {
    await Promise.resolve()
  }
}

describe('Profile/Keys/GeminiPaidTier', () => {
  beforeEach(() => {
    mocks.fetch.mockReset()
    mocks.fetch.mockResolvedValue({ paidTierConfirmed: true })
    mocks.refresh.mockReset()
    mocks.refresh.mockResolvedValue(undefined)
    mocks.successMessage.mockReset()
    mocks.errorMessage.mockReset()
    mocks.confirmed = shallowRef<boolean>(false)
  })

  it('states the pre-check sentence and why it matters', async () => {
    const wrapper = await mountSuspended(GeminiPaidTier)

    expect(wrapper.text()).toContain(GOOGLE_DATA_PAID_TIER_STATEMENT)
    expect(wrapper.get('[data-testid="gemini-paid-tier-note"]').text())
      .toContain('Unpaid Gemini API traffic may be used for training')
  })

  it('reflects the stored confirmation', async () => {
    mocks.confirmed.value = true

    const wrapper = await mountSuspended(GeminiPaidTier)
    const input = wrapper.get('[data-testid="gemini-paid-tier-toggle"]')

    expect((input.element as HTMLInputElement).checked).toBe(true)
  })

  it('posts the confirmation and refreshes the key summary', async () => {
    const wrapper = await mountSuspended(GeminiPaidTier)
    const input = wrapper.get('[data-testid="gemini-paid-tier-toggle"]')

    await input.setValue(true)
    await flushPromises()

    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/v1/profiles/keys/google/paid-tier',
      { method: 'POST', body: { confirmed: true } },
    )
    expect(mocks.refresh).toHaveBeenCalledOnce()
    expect(mocks.successMessage).toHaveBeenCalled()
  })

  it('withdraws the confirmation', async () => {
    mocks.confirmed.value = true

    const wrapper = await mountSuspended(GeminiPaidTier)

    await wrapper.get('[data-testid="gemini-paid-tier-toggle"]')
      .setValue(false)
    await flushPromises()

    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/v1/profiles/keys/google/paid-tier',
      { method: 'POST', body: { confirmed: false } },
    )
  })

  it('shows the server error and puts the box back', async () => {
    mocks.fetch.mockRejectedValue(Object.assign(new Error('Gemini API key '
      + 'not found'), { status: 404 }))

    const wrapper = await mountSuspended(GeminiPaidTier)
    const input = wrapper.get('[data-testid="gemini-paid-tier-toggle"]')

    await input.setValue(true)
    await flushPromises()

    expect(mocks.errorMessage).toHaveBeenCalled()
    expect((input.element as HTMLInputElement).checked).toBe(false)
  })
})
