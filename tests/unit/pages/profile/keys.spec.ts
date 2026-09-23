import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import KeysPage from '../../../../app/pages/profile/keys.vue'

const mocks = vi.hoisted(() => ({
  providers: [] as Array<{ id: string, models: [] }>,
}))

mockNuxtImport('useRuntimeConfig', () => {
  return () => ({
    app: { baseURL: '/' },
    public: { providers: mocks.providers },
  })
})

function stubs() {
  return {
    ProfileKeysProviderKeyCard: {
      props: {
        providerId: { type: String, default: '' },
        group: { type: String, default: '' },
        open: { type: Boolean, default: false },
      },
      template:
        '<div data-testid="provider-card" :data-provider="providerId"'
        + ' :data-group="group" :data-open="String(open)" />',
    },
    ProfileKeysCloudflareGateway: {
      props: {
        open: { type: Boolean, default: false },
      },
      template:
        '<div data-testid="cloudflare-gateway-card"'
        + ' :data-open="String(open)" />',
    },
  }
}

function mountPage() {
  return mountSuspended(KeysPage, { global: { stubs: stubs() } })
}

describe('profile keys page', () => {
  beforeEach(() => {
    vi.stubGlobal('definePageMeta', vi.fn())
    vi.stubGlobal('useSeoMeta', vi.fn())
    mocks.providers = [
      { id: 'anthropic', models: [] },
      { id: 'google', models: [] },
      { id: 'openai', models: [] },
      { id: 'xai', models: [] },
      { id: 'deepseek', models: [] },
      { id: 'moonshotai', models: [] },
    ]
  })

  it('lists every configured provider in catalog order', async () => {
    const wrapper = await mountPage()

    const providersPanel = wrapper.get(
      '[data-testid="key-panel-providers"]',
    )
    const providerIds = providersPanel
      .findAll('[data-testid="provider-card"]')
      .map((card: any) => {
        return card.attributes('data-provider')
      })

    expect(providerIds).toEqual([
      'anthropic',
      'google',
      'openai',
      'xai',
      'deepseek',
      'moonshotai',
    ])
  })

  it('skips a configured provider with no key metadata', async () => {
    mocks.providers = [
      { id: 'anthropic', models: [] },
      { id: 'not-a-provider', models: [] },
    ]

    const wrapper = await mountPage()

    const providersPanel = wrapper.get(
      '[data-testid="key-panel-providers"]',
    )
    const providerIds = providersPanel
      .findAll('[data-testid="provider-card"]')
      .map((card: any) => {
        return card.attributes('data-provider')
      })

    expect(providerIds).toContain('anthropic')
    expect(providerIds).not.toContain('not-a-provider')
  })

  it('collapses provider cards into one shared accordion group', async () => {
    const wrapper = await mountPage()

    const providersPanel = wrapper.get(
      '[data-testid="key-panel-providers"]',
    )
    const cards = providersPanel.findAll('[data-testid="provider-card"]')

    cards.forEach((card: any) => {
      expect(card.attributes('data-group')).toBe('profile-provider-keys')
      expect(card.attributes('data-open')).toBe('false')
    })
  })

  it('renders a tab bar with the providers tab active by default',
    async () => {
      const wrapper = await mountPage()

      const providersTab = wrapper.get('[data-testid="key-tab-providers"]')
      const searchTab = wrapper.get('[data-testid="key-tab-search"]')

      expect(providersTab.classes()).toContain('tab-active')
      expect(providersTab.text()).toContain('Per provider')
      expect(searchTab.classes()).not.toContain('tab-active')
      expect(searchTab.text()).not.toContain('Search providers')
    })

  it('shows the providers panel and hides the search panel by default',
    async () => {
      const wrapper = await mountPage()

      const providersPanel = wrapper.get(
        '[data-testid="key-panel-providers"]',
      )
      const searchPanel = wrapper.get('[data-testid="key-panel-search"]')

      expect((providersPanel.element as HTMLElement).style.display)
        .not.toBe('none')
      expect((searchPanel.element as HTMLElement).style.display)
        .toBe('none')
    })

  it('swaps to the search panel when the search tab is clicked',
    async () => {
      const wrapper = await mountPage()

      await wrapper.get('[data-testid="key-tab-search"]').trigger('click')

      const providersPanel = wrapper.get(
        '[data-testid="key-panel-providers"]',
      )
      const searchPanel = wrapper.get('[data-testid="key-panel-search"]')
      const searchTab = wrapper.get('[data-testid="key-tab-search"]')

      expect((searchPanel.element as HTMLElement).style.display)
        .not.toBe('none')
      expect((providersPanel.element as HTMLElement).style.display)
        .toBe('none')
      expect(searchTab.classes()).toContain('tab-active')
      expect(searchTab.text()).toContain('Search providers')
    })

  it('lists Brave then Exa in the search panel, in that order',
    async () => {
      const wrapper = await mountPage()

      await wrapper.get('[data-testid="key-tab-search"]').trigger('click')

      const searchPanel = wrapper.get('[data-testid="key-panel-search"]')
      const providerIds = searchPanel
        .findAll('[data-testid="provider-card"]')
        .map((card: any) => {
          return card.attributes('data-provider')
        })

      expect(providerIds).toEqual(['brave', 'exa'])
    })

  it('collapses search provider cards into their own accordion group',
    async () => {
      const wrapper = await mountPage()

      await wrapper.get('[data-testid="key-tab-search"]').trigger('click')

      const searchPanel = wrapper.get('[data-testid="key-panel-search"]')
      const cards = searchPanel.findAll('[data-testid="provider-card"]')

      cards.forEach((card: any) => {
        expect(card.attributes('data-group'))
          .toBe('profile-search-provider-keys')
      })
    })

  it('renders five tabs in the order providers, search, cloudflare, '
    + 'openrouter, vercel', async () => {
    const wrapper = await mountPage()

    const tabIds = wrapper.findAll('[class~="tab"]').map((tab: any) => {
      return tab.attributes('id')
    })

    expect(tabIds).toEqual([
      'key-tab-providers',
      'key-tab-search',
      'key-tab-cloudflare',
      'key-tab-openrouter',
      'key-tab-vercel',
    ])
  })

  it('renders the gateway blurb and one pre-expanded card per gateway tab',
    async () => {
      const wrapper = await mountPage()

      await wrapper.get('[data-testid="key-tab-cloudflare"]').trigger('click')

      const cloudflarePanel = wrapper.get(
        '[data-testid="key-panel-cloudflare"]',
      )

      expect(cloudflarePanel.text()).toContain(
        'Gateways proxy to many models using your own gateway account, '
        + 'instead of a single provider\'s key',
      )
      expect(
        cloudflarePanel.find('[data-testid="cloudflare-gateway-card"]')
          .attributes('data-open'),
      ).toBe('true')
      expect(
        cloudflarePanel.find('[data-testid="provider-card"]').exists(),
      ).toBe(false)

      await wrapper.get('[data-testid="key-tab-openrouter"]').trigger('click')

      const openrouterPanel = wrapper.get(
        '[data-testid="key-panel-openrouter"]',
      )
      const openrouterCard = openrouterPanel.get(
        '[data-testid="provider-card"]',
      )

      expect(openrouterCard.attributes('data-provider')).toBe('openrouter')
      expect(openrouterCard.attributes('data-open')).toBe('true')
      expect(
        openrouterPanel.find('[data-testid="cloudflare-gateway-card"]')
          .exists(),
      ).toBe(false)

      await wrapper.get('[data-testid="key-tab-vercel"]').trigger('click')

      const vercelPanel = wrapper.get('[data-testid="key-panel-vercel"]')
      const vercelCard = vercelPanel.get('[data-testid="provider-card"]')

      expect(vercelCard.attributes('data-provider')).toBe('vercel')
      expect(vercelCard.attributes('data-open')).toBe('true')
    })
})
