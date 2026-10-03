import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import GatewaysInfo
  from '../../../../../app/components/Profile/Keys/GatewaysInfo.vue'

const mountOptions = {
  global: {
    stubs: {
      NuxtLink: {
        props: ['to'],
        template: '<a :href="to"><slot /></a>',
      },
    },
  },
}

describe('Profile/Keys/GatewaysInfo', () => {
  it('renders as an info alert with an info icon', async () => {
    const wrapper = await mountSuspended(GatewaysInfo, mountOptions)

    const alert = wrapper.get('[data-testid="gateways-info"]')

    expect(alert.attributes('role')).toBe('alert')
    expect(alert.classes()).toContain('alert-info')
    expect(alert.find('.iconify').exists()).toBe(true)
  })

  it('explains the pros of routing through a gateway', async () => {
    const wrapper = await mountSuspended(GatewaysInfo, mountOptions)

    const text = wrapper.text()

    expect(text).toContain('many vendors\' models under a single bill')
    expect(text).toContain('one invoice instead of a separate bill')
  })

  it('explains the cons and links to the privacy policy', async () => {
    const wrapper = await mountSuspended(GatewaysInfo, mountOptions)

    const text = wrapper.text()
    const privacyLink = wrapper.get('a[href="/privacy-policy"]')

    expect(text).toContain('the gateway sees your prompts too')
    expect(text).toContain('may add its own fees or credit markup')
    expect(text).toContain('deep research is direct-provider only')
    expect(text).toContain('Cloudflare\'s gateway lists Workers AI '
      + 'models only')
    expect(privacyLink.text()).toBe('Privacy Policy')
  })

  it('states that direct providers are the default routing path',
    async () => {
      const wrapper = await mountSuspended(GatewaysInfo, mountOptions)

      const text = wrapper.text()

      expect(text).toContain('Direct providers are used by default')
      expect(text).toContain('a gateway is only used when you pick a '
        + 'gateway model')
    })
})
