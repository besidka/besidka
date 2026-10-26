import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import LandingFooter from '../../../app/components/LandingFooter.vue'

const mocks = vi.hoisted(() => ({
  useCookieConsentUi: vi.fn(),
  expand: vi.fn(),
  keyGuides: [] as Array<{ path: string, title: string, provider: string }>,
  queryCollection: vi.fn(),
}))

mockNuxtImport('useCookieConsentUi', () => mocks.useCookieConsentUi)
mockNuxtImport('queryCollection', () => mocks.queryCollection)

const COOKIE_SETTINGS = '[data-testid="footer-cookie-settings"]'

describe('LandingFooter.vue', () => {
  beforeEach(() => {
    mocks.expand.mockReset()
    mocks.useCookieConsentUi.mockReset()
    mocks.useCookieConsentUi.mockReturnValue({ expand: mocks.expand })
    mocks.keyGuides = []
    mocks.queryCollection.mockReset()
    mocks.queryCollection.mockImplementation(() => {
      const query = {
        select: () => query,
        order: () => query,
        all: async () => mocks.keyGuides,
      }

      return query
    })
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

  it('links the memory guide from every landing-layout page', async () => {
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
    const link = wrapper.get('[data-testid="landing-footer-memory-link"]')

    expect(link.attributes('href')).toBe('/memory')
    expect(link.text()).toBe('Memory guide')

    wrapper.unmount()
  })

  describe('key guide links', () => {
    const linkStub = {
      NuxtLink: {
        props: ['to'],
        template: '<a :href="to"><slot /></a>',
      },
    }

    it('renders nothing extra in the Guides list when there are no key '
      + 'guides', async () => {
      const wrapper = await mountSuspended(LandingFooter, {
        global: { stubs: linkStub },
      })
      const guideLinks = wrapper.findAll('nav[aria-label="Guides"] a')

      expect(mocks.queryCollection).toHaveBeenCalledWith('keyGuides')
      expect(guideLinks).toHaveLength(2)
      expect(guideLinks[0]!.attributes('data-testid'))
        .toBe('landing-footer-byok-link')
      expect(guideLinks[1]!.attributes('data-testid'))
        .toBe('landing-footer-memory-link')

      wrapper.unmount()
    })

    it('appends one link per key guide after the BYOK and memory links', async () => {
      mocks.keyGuides = [
        {
          path: '/guides/gemini-api-key',
          title: 'How to get a Gemini API key',
          provider: 'google',
        },
        {
          path: '/guides/openai-api-key',
          title: 'How to get an OpenAI API key',
          provider: 'openai',
        },
      ]

      const wrapper = await mountSuspended(LandingFooter, {
        global: { stubs: linkStub },
      })
      const guideLinks = wrapper.findAll('nav[aria-label="Guides"] a')

      expect(guideLinks.map((link: any) => link.attributes('href')))
        .toEqual([
          '/byok',
          '/memory',
          '/guides/gemini-api-key',
          '/guides/openai-api-key',
        ])

      const geminiLink = wrapper.get(
        '[data-testid="landing-footer-guide-link-gemini-api-key"]',
      )

      expect(geminiLink.text()).toBe('How to get a Gemini API key')
      expect(
        wrapper.find(
          '[data-testid="landing-footer-guide-link-openai-api-key"]',
        ).exists(),
      ).toBe(true)

      wrapper.unmount()
    })

    it('still renders the footer when the guides query fails', async () => {
      mocks.queryCollection.mockImplementation(() => {
        throw new Error('content database unavailable')
      })

      const wrapper = await mountSuspended(LandingFooter, {
        global: { stubs: linkStub },
      })

      expect(
        wrapper.find('[data-testid="landing-footer-byok-link"]').exists(),
      ).toBe(true)

      wrapper.unmount()
    })
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
