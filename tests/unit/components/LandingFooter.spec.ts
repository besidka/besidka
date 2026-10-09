import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import LandingFooter from '../../../app/components/LandingFooter.vue'

const mocks = vi.hoisted(() => ({
  useCookieConsentUi: vi.fn(),
  expand: vi.fn(),
}))

mockNuxtImport('useCookieConsentUi', () => mocks.useCookieConsentUi)

const COOKIE_SETTINGS = '[data-testid="footer-cookie-settings"]'

describe('LandingFooter.vue', () => {
  beforeEach(() => {
    mocks.expand.mockReset()
    mocks.useCookieConsentUi.mockReset()
    mocks.useCookieConsentUi.mockReturnValue({ expand: mocks.expand })
  })

  it('renders a Cookie settings button that opens a dialog', async () => {
    const wrapper = await mountSuspended(LandingFooter)
    const button = wrapper.get(COOKIE_SETTINGS)

    expect(button.element.tagName).toBe('BUTTON')
    expect(button.attributes('type')).toBe('button')
    expect(button.attributes('aria-haspopup')).toBe('dialog')
    expect(button.text()).toBe('Cookie settings')

    wrapper.unmount()
  })

  it('does not touch the consent UI composable while rendering', async () => {
    const wrapper = await mountSuspended(LandingFooter)

    expect(mocks.useCookieConsentUi).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('expands the consent settings on click, anchored to the button',
    async () => {
      const wrapper = await mountSuspended(LandingFooter)
      const button = wrapper.get(COOKIE_SETTINGS)

      await button.trigger('click')

      expect(mocks.useCookieConsentUi).toHaveBeenCalledTimes(1)
      expect(mocks.expand).toHaveBeenCalledTimes(1)
      expect(mocks.expand).toHaveBeenCalledWith({
        userInitiated: true,
        trigger: button.element,
      })

      wrapper.unmount()
    })
})
