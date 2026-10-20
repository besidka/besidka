import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { reactive } from 'vue'
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

const mockRoute = reactive<{ query: Record<string, unknown> }>({
  query: {},
})

mockNuxtImport('useRoute', () => {
  return () => mockRoute
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
        group: { type: String, default: '' },
        open: { type: Boolean, default: false },
      },
      template:
        '<div data-testid="cloudflare-gateway-card"'
        + ' :data-group="group" :data-open="String(open)" />',
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
    mockRoute.query = {}
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
      expect(providersTab.text()).toContain('Direct Providers')
      expect(searchTab.classes()).not.toContain('tab-active')
      expect(searchTab.text()).not.toContain('Search Providers')
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
      expect(searchTab.text()).toContain('Search Providers')
    })

  it('shows the search providers info block in the search panel',
    async () => {
      const wrapper = await mountPage()

      await wrapper.get('[data-testid="key-tab-search"]').trigger('click')

      const searchPanel = wrapper.get('[data-testid="key-panel-search"]')

      expect(
        searchPanel.find('[data-testid="search-providers-info"]').exists(),
      ).toBe(true)
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

  it('renders three tabs in the order providers, search, gateways',
    async () => {
      const wrapper = await mountPage()

      const tabIds = wrapper.findAll('[class~="tab"]').map((tab: any) => {
        return tab.attributes('id')
      })

      expect(tabIds).toEqual([
        'key-tab-providers',
        'key-tab-search',
        'key-tab-gateways',
      ])
    })

  it('renders the gateway blurb and one collapsed card per gateway, '
    + 'sharing one accordion group', async () => {
    const wrapper = await mountPage()

    await wrapper.get('[data-testid="key-tab-gateways"]').trigger('click')

    const gatewaysPanel = wrapper.get('[data-testid="key-panel-gateways"]')

    expect(
      gatewaysPanel.find('[data-testid="gateways-info"]').exists(),
    ).toBe(true)

    const cloudflareCard = gatewaysPanel.get(
      '[data-testid="cloudflare-gateway-card"]',
    )

    expect(cloudflareCard.attributes('data-group'))
      .toBe('profile-gateway-keys')
    expect(cloudflareCard.attributes('data-open')).toBe('false')

    const providerCards = gatewaysPanel.findAll(
      '[data-testid="provider-card"]',
    )
    const gatewayIds = providerCards.map((card: any) => {
      return card.attributes('data-provider')
    })

    expect(gatewayIds).toEqual(['openrouter', 'vercel'])
    providerCards.forEach((card: any) => {
      expect(card.attributes('data-group')).toBe('profile-gateway-keys')
      expect(card.attributes('data-open')).toBe('false')
    })
  })

  it('opens the search tab when the tab query param is "search"',
    async () => {
      mockRoute.query = { tab: 'search' }

      const wrapper = await mountPage()

      const searchTab = wrapper.get('[data-testid="key-tab-search"]')
      const providersPanel = wrapper.get(
        '[data-testid="key-panel-providers"]',
      )
      const searchPanel = wrapper.get('[data-testid="key-panel-search"]')

      expect(searchTab.classes()).toContain('tab-active')
      expect((searchPanel.element as HTMLElement).style.display)
        .not.toBe('none')
      expect((providersPanel.element as HTMLElement).style.display)
        .toBe('none')
    })

  it('falls back to the providers tab for an unknown tab query param',
    async () => {
      mockRoute.query = { tab: 'not-a-tab' }

      const wrapper = await mountPage()

      const providersTab = wrapper.get('[data-testid="key-tab-providers"]')

      expect(providersTab.classes()).toContain('tab-active')
    })
  describe('provider deep link', () => {
    const scrollIntoView = vi.fn()

    beforeEach(() => {
      scrollIntoView.mockReset()
      Element.prototype.scrollIntoView = scrollIntoView
    })

    function readOpenStates(wrapper: any): Record<string, string> {
      const providersPanel = wrapper.get(
        '[data-testid="key-panel-providers"]',
      )
      const states: Record<string, string> = {}

      providersPanel
        .findAll('[data-testid="provider-card"]')
        .forEach((card: any) => {
          states[card.attributes('data-provider')]
            = card.attributes('data-open')
        })

      return states
    }

    it('opens only the card named by the provider query param', async () => {
      mockRoute.query = { provider: 'google' }

      const wrapper = await mountPage()

      expect(readOpenStates(wrapper)).toEqual({
        anthropic: 'false',
        google: 'true',
        openai: 'false',
        xai: 'false',
        deepseek: 'false',
        moonshotai: 'false',
      })
    })

    it('forces the providers tab even when another tab is requested',
      async () => {
        mockRoute.query = { provider: 'google', tab: 'search' }

        const wrapper = await mountPage()

        expect(wrapper.get('[data-testid="key-tab-providers"]').classes())
          .toContain('tab-active')
        expect(wrapper.get('[data-testid="key-tab-search"]').classes())
          .not.toContain('tab-active')
      })

    it('opens nothing for an unknown provider id', async () => {
      mockRoute.query = { provider: 'not-a-provider' }

      const wrapper = await mountPage()

      Object.values(readOpenStates(wrapper)).forEach((state) => {
        expect(state).toBe('false')
      })
      expect(scrollIntoView).not.toHaveBeenCalled()
    })

    it('opens nothing for a provider that is not in the enabled list',
      async () => {
        mockRoute.query = { provider: 'qwen' }

        const wrapper = await mountPage()

        Object.values(readOpenStates(wrapper)).forEach((state) => {
          expect(state).toBe('false')
        })
      })

    it('opens nothing when the provider query param is repeated',
      async () => {
        mockRoute.query = { provider: ['google', 'openai'] }

        const wrapper = await mountPage()

        Object.values(readOpenStates(wrapper)).forEach((state) => {
          expect(state).toBe('false')
        })
      })

    it('scrolls the opened card into view on mount', async () => {
      mockRoute.query = { provider: 'google' }

      const wrapper = await mountSuspended(KeysPage, {
        attachTo: document.body,
        global: { stubs: stubs() },
      })

      await vi.waitFor(() => {
        expect(scrollIntoView).toHaveBeenCalledTimes(1)
      })

      const target = wrapper.get('.js-key-provider-target')

      expect(target.find('[data-provider="google"]').exists()).toBe(true)
      expect(scrollIntoView).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'start',
      })

      wrapper.unmount()
    })

    function readPanelOpenStates(
      wrapper: any,
      panelId: string,
      cardTestId: string,
    ): Record<string, string> {
      const states: Record<string, string> = {}

      wrapper
        .get(`[data-testid="key-panel-${panelId}"]`)
        .findAll(`[data-testid="${cardTestId}"]`)
        .forEach((card: any, index: number) => {
          const key = card.attributes('data-provider') ?? `card-${index}`

          states[key] = card.attributes('data-open')
        })

      return states
    }

    it('forces the gateways tab and opens a gateway provider card',
      async () => {
        mockRoute.query = { provider: 'openrouter', tab: 'search' }

        const wrapper = await mountPage()

        expect(wrapper.get('[data-testid="key-tab-gateways"]').classes())
          .toContain('tab-active')
        expect(wrapper.get('[data-testid="key-tab-providers"]').classes())
          .not.toContain('tab-active')
        expect(
          readPanelOpenStates(wrapper, 'gateways', 'provider-card'),
        ).toEqual({ openrouter: 'true', vercel: 'false' })
        expect(
          wrapper
            .get('[data-testid="cloudflare-gateway-card"]')
            .attributes('data-open'),
        ).toBe('false')
      })

    it('opens the Cloudflare gateway card for provider=cloudflare',
      async () => {
        mockRoute.query = { provider: 'cloudflare' }

        const wrapper = await mountPage()

        expect(wrapper.get('[data-testid="key-tab-gateways"]').classes())
          .toContain('tab-active')
        expect(
          wrapper
            .get('[data-testid="cloudflare-gateway-card"]')
            .attributes('data-open'),
        ).toBe('true')
        expect(
          readPanelOpenStates(wrapper, 'gateways', 'provider-card'),
        ).toEqual({ openrouter: 'false', vercel: 'false' })
      })

    it('forces the search tab and opens a search provider card',
      async () => {
        mockRoute.query = { provider: 'exa' }

        const wrapper = await mountPage()

        expect(wrapper.get('[data-testid="key-tab-search"]').classes())
          .toContain('tab-active')
        expect(
          readPanelOpenStates(wrapper, 'search', 'provider-card'),
        ).toEqual({ brave: 'false', exa: 'true' })
      })

    it('scrolls a gateway card into view on mount', async () => {
      mockRoute.query = { provider: 'openrouter' }

      const wrapper = await mountSuspended(KeysPage, {
        attachTo: document.body,
        global: { stubs: stubs() },
      })

      await vi.waitFor(() => {
        expect(scrollIntoView).toHaveBeenCalledTimes(1)
      })

      const target = wrapper.get('.js-key-provider-target')

      expect(target.find('[data-provider="openrouter"]').exists()).toBe(true)

      wrapper.unmount()
    })

    it('scrolls the Cloudflare gateway card into view on mount',
      async () => {
        mockRoute.query = { provider: 'cloudflare' }

        const wrapper = await mountSuspended(KeysPage, {
          attachTo: document.body,
          global: { stubs: stubs() },
        })

        await vi.waitFor(() => {
          expect(scrollIntoView).toHaveBeenCalledTimes(1)
        })

        const target = wrapper.get('.js-key-provider-target')

        expect(
          target.find('[data-testid="cloudflare-gateway-card"]').exists(),
        ).toBe(true)

        wrapper.unmount()
      })

    it('does not scroll when no provider is requested', async () => {
      await mountPage()

      expect(scrollIntoView).not.toHaveBeenCalled()
    })
  })
})
