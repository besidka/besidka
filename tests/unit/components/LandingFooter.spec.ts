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

  it('links the BYOK guide from every landing-layout page', async () => {
    const wrapper = await mountSuspended(LandingFooter, {
      global: {
        stubs: {
          NuxtLink: {
            props: ['to'],
            template: '<a :href="to"><slot /></a>',
          },
        },
      },
    })
    const link = wrapper.get('[data-testid="landing-footer-byok-link"]')

    expect(link.attributes('href')).toBe('/byok')
    expect(link.text()).toBe('BYOK guide')

    wrapper.unmount()
  })

  it('keeps footer link lists left-aligned on desktop, so the Cookie '
    + 'settings button does not stretch to the column width and center its '
    + 'text away from the links above it', async () => {
    const wrapper = await mountSuspended(LandingFooter)
    const legalNav = wrapper.get('nav[aria-label="Legal links"]')

    expect(legalNav.classes()).toContain('items-start')
    expect(legalNav.classes()).toContain('max-sm:items-center')

    wrapper.unmount()
  })
})
