import { describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import CtaButtons from '../../../../app/components/landing/CtaButtons.vue'

const mocks = vi.hoisted(() => {
  return { track: vi.fn() }
})

mockNuxtImport('useLandingAnalytics', () => {
  return () => {
    return { track: mocks.track }
  }
})

// Stub NuxtLink so we can tell a router link apart from a plain <a>: both
// otherwise render as <a href="...">, which would hide the bug being fixed.
const mountOptions = {
  global: {
    stubs: {
      NuxtLink: {
        props: ['to'],
        template: '<a class="js-nuxt-link" :href="to"><slot /></a>',
      },
    },
  },
}

describe('CtaButtons.vue', () => {
  it('renders a hash href as a plain anchor (native scroll, not NuxtLink)',
    async () => {
      const wrapper = await mountSuspended(CtaButtons, {
        props: { primary: { label: 'How it works', href: '#how-it-works' } },
        ...mountOptions,
      })

      const link = wrapper.get('a')

      expect(link.attributes('href')).toBe('#how-it-works')
      expect(link.classes()).not.toContain('js-nuxt-link')
      expect(link.attributes('target')).toBeUndefined()
    })

  it('renders an internal path as a NuxtLink', async () => {
    const wrapper = await mountSuspended(CtaButtons, {
      props: { primary: { label: 'Start', href: '/signup' } },
      ...mountOptions,
    })

    expect(wrapper.find('.js-nuxt-link').exists()).toBe(true)
    expect(wrapper.get('a').attributes('href')).toBe('/signup')
  })

  it('renders an external href as a new-tab anchor', async () => {
    const wrapper = await mountSuspended(CtaButtons, {
      props: {
        primary: { label: 'GitHub', href: 'https://github.com/besidka/besidka' },
      },
      ...mountOptions,
    })

    const link = wrapper.get('a')

    expect(link.classes()).not.toContain('js-nuxt-link')
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toBe('noopener noreferrer')
    expect(wrapper.text()).toContain('(opens in new tab)')
  })

  it('renders the secondary anchor button when provided', async () => {
    const wrapper = await mountSuspended(CtaButtons, {
      props: {
        primary: { label: 'Start chatting', href: '/signup' },
        secondary: { label: 'How it works', href: '#how-it-works' },
      },
      ...mountOptions,
    })

    const secondary = wrapper.get('a[href="#how-it-works"]')

    expect(secondary.classes()).not.toContain('js-nuxt-link')
    expect(secondary.text()).toContain('How it works')
  })

  it('tracks a cta_click on press', async () => {
    mocks.track.mockClear()

    const wrapper = await mountSuspended(CtaButtons, {
      props: { primary: { label: 'How it works', href: '#how-it-works' } },
      ...mountOptions,
    })

    await wrapper.get('a').trigger('click')

    expect(mocks.track).toHaveBeenCalledWith(
      'cta_click',
      { target: '#how-it-works' },
    )
  })
})
