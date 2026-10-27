import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { shallowRef } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TransferConsentModal from '../../../../app/components/Legal/TransferConsentModal.client.vue'

const mocks = vi.hoisted(() => ({
  transferRequest: { value: null as unknown },
  isSaving: { value: false },
  giveTransferConsent: vi.fn(),
  resolveTransferModal: vi.fn(),
}))

mockNuxtImport('useLegalConsent', () => () => ({
  transferRequest: mocks.transferRequest,
  isSaving: mocks.isSaving,
  giveTransferConsent: mocks.giveTransferConsent,
  resolveTransferModal: mocks.resolveTransferModal,
}))

enableAutoUnmount(afterEach)

async function mountModal(providerId: string, context: 'key' | 'send') {
  mocks.transferRequest = shallowRef({ providerId, context })

  return await mountSuspended(TransferConsentModal, {
    attachTo: document.body,
  })
}

describe('Legal transfer consent modal', () => {
  beforeEach(() => {
    mocks.isSaving = shallowRef(false)
    mocks.giveTransferConsent.mockReset()
    mocks.giveTransferConsent.mockResolvedValue(true)
    mocks.resolveTransferModal.mockReset()
  })

  it.each([
    ['deepseek', 'DeepSeek', 'China'],
    ['moonshotai', 'Moonshot AI', 'Singapore'],
    ['qwen', 'Qwen', 'Singapore'],
    ['zai', 'Z.ai (Zhipu AI)', 'Singapore'],
    ['minimax', 'MiniMax', 'Singapore'],
    ['tencent', 'Tencent', 'China'],
    ['bytedance', 'ByteDance', 'Malaysia or Indonesia'],
    ['xiaomi', 'Xiaomi', 'China'],
    ['meituan', 'Meituan', 'China'],
    ['stepfun', 'StepFun', 'China'],
    ['inclusionai', 'inclusionAI', 'China'],
    ['teleai', 'TeleAI (China Telecom)', 'China'],
    ['dotsstudio', 'Dots Studio', 'China'],
  ])('names %s and its country', async (providerId, label, country) => {
    const wrapper = await mountModal(providerId, 'send')

    expect(wrapper.text()).toContain(`${label} processes data in ${country}`)
    expect(wrapper.text()).toContain('has not found')
  })

  it('explains that a router may send the request to any country',
    async () => {
      const wrapper = await mountModal('router', 'send')

      expect(wrapper.get('[data-testid="legal-transfer-consent-router-text"]')
        .text()).toContain('such as China or Singapore')
      expect(wrapper.text()).not.toContain('processes data in')
      expect(wrapper.text()).toContain('through router and preset models')

      await wrapper.get('[data-testid="legal-transfer-consent-checkbox"]')
        .setValue(true)
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(mocks.giveTransferConsent).toHaveBeenCalledWith('router')
    })

  it('starts unticked and needs the box before continuing', async () => {
    const wrapper = await mountModal('deepseek', 'key')
    const checkbox = wrapper.get(
      '[data-testid="legal-transfer-consent-checkbox"]',
    )
    const continueButton = wrapper.get(
      '[data-testid="legal-transfer-consent-continue"]',
    )

    expect((checkbox.element as HTMLInputElement).checked).toBe(false)
    expect(continueButton.attributes('disabled')).toBeDefined()
    expect(continueButton.text()).toBe('Add key')

    await checkbox.setValue(true)

    expect(continueButton.attributes('disabled')).toBeUndefined()
  })

  it('records the transfer consent for the provider', async () => {
    const wrapper = await mountModal('qwen', 'send')

    await wrapper.get('[data-testid="legal-transfer-consent-checkbox"]')
      .setValue(true)
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(mocks.giveTransferConsent).toHaveBeenCalledWith('qwen')
    expect(mocks.resolveTransferModal).toHaveBeenCalledWith(true)
  })

  it('explains that the key stays when a send is refused', async () => {
    const wrapper = await mountModal('moonshotai', 'send')

    expect(wrapper.text()).toContain('Your key stays saved')

    await wrapper.get('[data-testid="legal-transfer-consent-cancel"]')
      .trigger('click')

    expect(mocks.resolveTransferModal).toHaveBeenCalledWith(false)
    expect(mocks.giveTransferConsent).not.toHaveBeenCalled()
  })
})
