import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { shallowRef } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ConsentModal from '../../../../app/components/Legal/ConsentModal.client.vue'

const mocks = vi.hoisted(() => ({
  state: { value: null as unknown },
  isSaving: { value: false },
  giveConsent: vi.fn(),
  resolveConsentModal: vi.fn(),
  requestAccountDeletion: vi.fn(),
}))

mockNuxtImport('useLegalConsent', () => () => ({
  state: mocks.state,
  isSaving: mocks.isSaving,
  giveConsent: mocks.giveConsent,
  resolveConsentModal: mocks.resolveConsentModal,
}))
mockNuxtImport('useAccountDeletion', () => () => ({
  isDeleting: shallowRef(false),
  requestAccountDeletion: mocks.requestAccountDeletion,
}))

enableAutoUnmount(afterEach)

async function mountModal() {
  return await mountSuspended(ConsentModal, { attachTo: document.body })
}

describe('Legal consent modal', () => {
  beforeEach(() => {
    mocks.state = shallowRef({ status: 'missing' })
    mocks.isSaving = shallowRef(false)
    mocks.giveConsent.mockReset()
    mocks.giveConsent.mockResolvedValue(true)
    mocks.resolveConsentModal.mockReset()
    mocks.requestAccountDeletion.mockReset()
  })

  it('opens as a modal dialog with both boxes unticked', async () => {
    const wrapper = await mountModal()
    const dialog = wrapper.get('[data-testid="legal-consent-modal"]')
    const terms = wrapper.get('[data-testid="legal-consent-terms"]')
    const sensitive = wrapper.get('[data-testid="legal-consent-sensitive"]')

    expect((dialog.element as HTMLDialogElement).open).toBe(true)
    expect(dialog.attributes('aria-labelledby')).toBe('legal-consent-title')
    expect((terms.element as HTMLInputElement).checked).toBe(false)
    expect((sensitive.element as HTMLInputElement).checked).toBe(false)
    expect(wrapper.text()).toContain('I explicitly consent')
    expect(wrapper.text()).toContain('I am 18 or over and I accept the')
  })

  it('keeps Continue disabled until both boxes are ticked', async () => {
    const wrapper = await mountModal()
    const continueButton = wrapper.get(
      '[data-testid="legal-consent-continue"]',
    )

    expect(continueButton.attributes('disabled')).toBeDefined()

    await wrapper.get('[data-testid="legal-consent-terms"]').setValue(true)

    expect(continueButton.attributes('disabled')).toBeDefined()

    await wrapper.get('[data-testid="legal-consent-terms"]').setValue(false)
    await wrapper.get('[data-testid="legal-consent-sensitive"]')
      .setValue(true)

    expect(continueButton.attributes('disabled')).toBeDefined()

    await wrapper.get('[data-testid="legal-consent-terms"]').setValue(true)

    expect(continueButton.attributes('disabled')).toBeUndefined()
  })

  it('records the consent and resolves the send', async () => {
    const wrapper = await mountModal()

    await wrapper.get('[data-testid="legal-consent-terms"]').setValue(true)
    await wrapper.get('[data-testid="legal-consent-sensitive"]')
      .setValue(true)
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(mocks.giveConsent).toHaveBeenCalledTimes(1)
    expect(mocks.resolveConsentModal).toHaveBeenCalledWith(true)
  })

  it('stays open when saving the consent fails', async () => {
    mocks.giveConsent.mockResolvedValue(false)

    const wrapper = await mountModal()

    await wrapper.get('[data-testid="legal-consent-terms"]').setValue(true)
    await wrapper.get('[data-testid="legal-consent-sensitive"]')
      .setValue(true)
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(mocks.resolveConsentModal).not.toHaveBeenCalled()
  })

  it('never records consent when submitted with unticked boxes', async () => {
    const wrapper = await mountModal()

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(mocks.giveConsent).not.toHaveBeenCalled()
    expect(mocks.resolveConsentModal).not.toHaveBeenCalled()
  })

  it('declines without sending on Not now and on Escape', async () => {
    const wrapper = await mountModal()

    await wrapper.get('[data-testid="legal-consent-decline"]')
      .trigger('click')

    expect(mocks.resolveConsentModal).toHaveBeenCalledWith(false)

    mocks.resolveConsentModal.mockReset()

    const second = await mountModal()

    await second.get('[data-testid="legal-consent-modal"]').trigger('cancel')

    expect(mocks.resolveConsentModal).toHaveBeenCalledWith(false)
    expect(mocks.giveConsent).not.toHaveBeenCalled()
  })

  it('offers export and account deletion on the refusal path', async () => {
    const wrapper = await mountModal()
    const refusal = wrapper.get('[data-testid="legal-consent-refusal"]')
    const exportLink = wrapper.get('[data-testid="legal-consent-export"]')

    expect(refusal.text()).toContain('you can still read, export and delete')
    expect(exportLink.attributes('href')).toBe('/api/v1/memory/export')
    expect(exportLink.attributes('download')).toBeDefined()

    await wrapper.get('[data-testid="legal-consent-delete-account"]')
      .trigger('click')
    await flushPromises()

    expect(mocks.resolveConsentModal).toHaveBeenCalledWith(false)
    expect(mocks.requestAccountDeletion).toHaveBeenCalledTimes(1)
  })

  it('names the changed text when the consent is outdated', async () => {
    mocks.state = shallowRef({ status: 'outdated' })

    const wrapper = await mountModal()

    expect(wrapper.get('#legal-consent-title').text())
      .toBe('The consent text has changed')
  })
})
