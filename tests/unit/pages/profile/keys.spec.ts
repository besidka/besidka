import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { computed, reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import KeysPage from '../../../../app/pages/profile/keys.vue'

const mocks = vi.hoisted(() => ({
  providers: [] as Array<{ id: string, models: [] }>,
  guides: [] as Array<{ provider: string, title: string }>,
  shouldAutoExpand: true,
  openAtMount: {} as Record<string, boolean>,
  expandCard: {} as Record<string, (isExpanded?: boolean) => void>,
  resizeObservers: [] as Array<{
    callback: () => void
    observed: Element[]
    disconnected: boolean
  }>,
}))

class FakeResizeObserver {
  record = {
    callback: () => {},
    observed: [] as Element[],
    disconnected: false,
  }

  constructor(callback: () => void) {
    this.record.callback = callback
    mocks.resizeObservers.push(this.record)
  }

  observe = (element: Element) => {
    this.record.observed.push(element)
  }

  unobserve = vi.fn()

  disconnect = () => {
    this.record.disconnected = true
  }
}

const keyState = reactive<{
  hasAnyKey: boolean
  googleStatus: string
  typesafeStatus: string
}>({
  hasAnyKey: true,
  googleStatus: 'unknown',
  typesafeStatus: 'missing',
})

mockNuxtImport('queryCollection', () => {
  return () => {
    return {
      all: () => {
        return Promise.resolve(mocks.guides)
      },
    }
  }
})

mockNuxtImport('useUserKeys', () => {
  return () => {
    return {
      hasAnyKey: computed(() => {
        return keyState.hasAnyKey
      }),
      keyStatusForProvider: (providerId: string) => {
        return providerId === 'typesafe'
          ? keyState.typesafeStatus
          : keyState.googleStatus
      },
    }
  }
})

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
    ProfileKeysTypesafeChecks: {
      template: '<section data-testid="typesafe-checks" />',
    },
    ProfileKeysProviderKeyCard: {
      props: {
        providerId: { type: String, default: '' },
        group: { type: String, default: '' },
        open: { type: Boolean, default: false },
        guide: { type: Object, default: null },
      },
      emits: ['expandedChange'],
      mounted(this: any) {
        mocks.openAtMount[this.providerId] = this.open
        mocks.expandCard[this.providerId] = (isExpanded = true) => {
          this.$emit('expandedChange', isExpanded)
        }

        if (mocks.shouldAutoExpand && this.open) {
          this.$emit('expandedChange', true)
        }
      },
      template:
        '<div data-testid="provider-card" :data-provider="providerId"'
        + ' :data-group="group" :data-open="String(open)"'
        + ' :data-guide="guide?.title" />',
    },
    ProfileKeysCloudflareGateway: {
      props: {
        group: { type: String, default: '' },
        open: { type: Boolean, default: false },
        guide: { type: Object, default: null },
      },
      emits: ['expandedChange'],
      mounted(this: any) {
        mocks.expandCard.cloudflare = (isExpanded = true) => {
          this.$emit('expandedChange', isExpanded)
        }

        if (mocks.shouldAutoExpand && this.open) {
          this.$emit('expandedChange', true)
        }
      },
      template:
        '<div data-testid="cloudflare-gateway-card"'
        + ' :data-group="group" :data-open="String(open)"'
        + ' :data-guide="guide?.title" />',
    },
  }
}

function mountPage() {
  return mountSuspended(KeysPage, { global: { stubs: stubs() } })
}

describe('profile keys page', () => {
  enableAutoUnmount(afterEach)

  afterEach(() => {
    vi.useRealTimers()
  })

  beforeEach(() => {
    vi.stubGlobal('definePageMeta', vi.fn())
    vi.stubGlobal('useSeoMeta', vi.fn())
    mockRoute.query = {}
    clearNuxtData()
    mocks.guides = []
    mocks.shouldAutoExpand = true
    mocks.expandCard = {}
    mocks.openAtMount = {}
    mocks.resizeObservers = []
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    keyState.hasAnyKey = true
    keyState.googleStatus = 'unknown'
    keyState.typesafeStatus = 'missing'
    HTMLElement.prototype.scrollIntoView = vi.fn()
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

  it('renders four tabs in the order providers, search, gateways, memory '
    + 'checks',
  async () => {
    const wrapper = await mountPage()

    const tabIds = wrapper.findAll('[class~="tab"]').map((tab: any) => {
      return tab.attributes('id')
    })

    expect(tabIds).toEqual([
      'key-tab-providers',
      'key-tab-search',
      'key-tab-gateways',
      'key-tab-memory-checks',
    ])
  })

  it('renders the memory checks blurb and the TypeSafe AI card in its own '
    + 'accordion group', async () => {
    const wrapper = await mountPage()

    await wrapper.get('[data-testid="key-tab-memory-checks"]').trigger('click')

    const panel = wrapper.get('[data-testid="key-panel-memory-checks"]')
    const info = panel.get('[data-testid="memory-checks-info"]')
    const providerCards = panel.findAll('[data-testid="provider-card"]')

    expect(info.text()).toContain('Each check sends TypeSafe AI (US) only '
      + 'the text it needs')
    expect(info.text()).not.toContain('never for chat')
    expect(info.get('[data-testid="memory-checks-guide-link"]').text())
      .toBe('How to get a TypeSafe AI API key')
    expect(providerCards.map((card: any) => {
      return card.attributes('data-provider')
    })).toEqual(['typesafe'])
    expect(providerCards[0]?.attributes('data-group'))
      .toBe('profile-memory-check-keys')
  })

  it('labels the TypeSafe AI tab Smart checks and keeps its id', async () => {
    const wrapper = await mountPage()
    const tab = wrapper.get('[data-testid="key-tab-memory-checks"]')

    expect(tab.attributes('aria-label')).toBe('Smart checks')
  })

  it.each(['missing', 'unknown'])(
    'hides the TypeSafe AI checks section when the key is %s',
    async (status) => {
      keyState.typesafeStatus = status

      const wrapper = await mountPage()

      expect(wrapper.find('[data-testid="typesafe-checks"]').exists())
        .toBe(false)
    },
  )

  it('shows the TypeSafe AI checks section in the Smart checks tab once the '
    + 'key is saved', async () => {
    keyState.typesafeStatus = 'saved'

    const wrapper = await mountPage()
    const panel = wrapper.get('[data-testid="key-panel-memory-checks"]')

    expect(panel.find('[data-testid="typesafe-checks"]').exists()).toBe(true)
  })

  it('opens the Smart checks tab for tab=memory-checks without expanding '
    + 'the card', async () => {
    mockRoute.query = { tab: 'memory-checks' }

    const wrapper = await mountPage()
    const card = wrapper.get('[data-provider="typesafe"]')

    expect(wrapper.get('[data-testid="key-tab-memory-checks"]').classes())
      .toContain('tab-active')
    expect(card.attributes('data-open')).toBe('false')
  })

  it('never renders the TypeSafe AI card in the direct providers tab',
    async () => {
      const wrapper = await mountPage()
      const providersPanel = wrapper.get('[data-testid="key-panel-providers"]')

      expect(providersPanel.find('[data-provider="typesafe"]').exists())
        .toBe(false)
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
      HTMLElement.prototype.scrollIntoView = scrollIntoView
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

    it('scrolls the opened card into view once it expands', async () => {
      mockRoute.query = { provider: 'google' }

      const wrapper = await mountSuspended(KeysPage, {
        attachTo: document.body,
        global: { stubs: stubs() },
      })

      await vi.waitFor(() => {
        expect(scrollIntoView).toHaveBeenCalledTimes(1)
      })

      const target = wrapper.get('[data-testid="key-provider-target"]')

      expect(target.find('[data-provider="google"]').exists()).toBe(true)
      expect(scrollIntoView).toHaveBeenCalledWith({
        block: 'start',
        behavior: 'instant',
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

    it('scrolls a gateway card into view once it expands', async () => {
      mockRoute.query = { provider: 'openrouter' }

      const wrapper = await mountSuspended(KeysPage, {
        attachTo: document.body,
        global: { stubs: stubs() },
      })

      await vi.waitFor(() => {
        expect(scrollIntoView).toHaveBeenCalledTimes(1)
      })

      const target = wrapper.get('[data-testid="key-provider-target"]')

      expect(target.find('[data-provider="openrouter"]').exists()).toBe(true)

      wrapper.unmount()
    })

    it('scrolls the Cloudflare gateway card into view once it expands',
      async () => {
        mockRoute.query = { provider: 'cloudflare' }

        const wrapper = await mountSuspended(KeysPage, {
          attachTo: document.body,
          global: { stubs: stubs() },
        })

        await vi.waitFor(() => {
          expect(scrollIntoView).toHaveBeenCalledTimes(1)
        })

        const target = wrapper.get('[data-testid="key-provider-target"]')

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

  function cardOpenState(wrapper: any, providerId: string): string {
    return wrapper
      .get(`[data-provider="${providerId}"]`)
      .attributes('data-open')
  }

  it('passes each provider card its key guide document', async () => {
    mocks.guides = [
      { provider: 'google', title: 'Google guide' },
      { provider: 'openrouter', title: 'OpenRouter guide' },
    ]

    const wrapper = await mountPage()

    expect(wrapper.get('[data-provider="google"]').attributes('data-guide'))
      .toBe('Google guide')
    expect(
      wrapper.get('[data-provider="anthropic"]').attributes('data-guide'),
    ).toBeUndefined()

    await wrapper.get('[data-testid="key-tab-gateways"]').trigger('click')

    expect(
      wrapper.get('[data-provider="openrouter"]').attributes('data-guide'),
    ).toBe('OpenRouter guide')
  })

  it('opens the gateways tab and expands the card for a gateway provider '
    + 'deep link', async () => {
    mockRoute.query = { provider: 'openrouter' }

    const wrapper = await mountPage()
    const gatewaysPanel = wrapper.get('[data-testid="key-panel-gateways"]')

    expect(wrapper.get('[data-testid="key-tab-gateways"]').classes())
      .toContain('tab-active')
    expect((gatewaysPanel.element as HTMLElement).style.display)
      .not.toBe('none')
    expect(cardOpenState(wrapper, 'openrouter')).toBe('true')
    expect(cardOpenState(wrapper, 'vercel')).toBe('false')
  })

  it('opens the memory checks tab and expands the TypeSafe AI card for '
    + 'provider=typesafe', async () => {
    mockRoute.query = { provider: 'typesafe' }

    const wrapper = await mountPage()

    expect(wrapper.get('[data-testid="key-tab-memory-checks"]').classes())
      .toContain('tab-active')
    expect(cardOpenState(wrapper, 'typesafe')).toBe('true')
  })

  it('opens the search tab for a search provider deep link', async () => {
    mockRoute.query = { provider: 'exa' }

    const wrapper = await mountPage()

    expect(wrapper.get('[data-testid="key-tab-search"]').classes())
      .toContain('tab-active')
    expect(cardOpenState(wrapper, 'exa')).toBe('true')
  })

  it('expands the cloudflare gateway card for its deep link', async () => {
    mockRoute.query = { provider: 'cloudflare' }

    const wrapper = await mountPage()

    expect(
      wrapper
        .get('[data-testid="cloudflare-gateway-card"]')
        .attributes('data-open'),
    ).toBe('true')
  })

  it('keeps the providers tab and expands the card for a direct provider '
    + 'deep link', async () => {
    mockRoute.query = { provider: 'openai' }

    const wrapper = await mountPage()

    expect(wrapper.get('[data-testid="key-tab-providers"]').classes())
      .toContain('tab-active')
    expect(cardOpenState(wrapper, 'openai')).toBe('true')
  })

  it('scrolls the deep-linked card into view once it has expanded on a '
    + 'hard load', async () => {
    mockRoute.query = { provider: 'openrouter' }

    await mountPage()
    await nextTick()
    await nextTick()

    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('does not scroll before the deep-linked card has expanded, then '
    + 'scrolls once when a late lazy card reports it (in-app navigation)',
  async () => {
    mocks.shouldAutoExpand = false
    mockRoute.query = { provider: 'openrouter' }

    await mountPage()
    await nextTick()
    await nextTick()

    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled()

    mocks.expandCard.openrouter!()
    await nextTick()
    await nextTick()

    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1)

    mocks.expandCard.openrouter!()
    await nextTick()
    await nextTick()

    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
  })

  async function expandDeepLinkedCard() {
    mocks.shouldAutoExpand = false
    mockRoute.query = { provider: 'openrouter' }

    const wrapper = await mountPage()

    mocks.expandCard.openrouter!()
    await nextTick()
    await nextTick()

    return wrapper
  }

  it('observes the list holding the deep-linked card', async () => {
    await expandDeepLinkedCard()

    const [resizeObserver] = mocks.resizeObservers

    expect(resizeObserver!.observed).toHaveLength(1)
    expect(resizeObserver!.observed[0]!.tagName).toBe('UL')
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
  })

  describe('with a page scroller', () => {
    let scroller: HTMLElement
    let itemTop = 0

    beforeEach(() => {
      itemTop = 0
      scroller = document.createElement('div')
      scroller.className = 'js-page-content'
      document.body.append(scroller)

      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
        .mockImplementation(function (this: HTMLElement) {
          return {
            top: this.classList.contains('js-page-content') ? 0 : itemTop,
          } as DOMRect
        })
    })

    afterEach(() => {
      vi.restoreAllMocks()
      scroller.remove()
    })

    async function mountInsideScroller() {
      mocks.shouldAutoExpand = false
      mockRoute.query = { provider: 'openrouter' }

      const wrapper = await mountSuspended(KeysPage, {
        global: { stubs: stubs() },
        attachTo: scroller,
      })

      mocks.expandCard.openrouter!()
      await nextTick()
      await nextTick()

      return wrapper
    }

    it('re-aligns the card when the router resets the scroll position',
      async () => {
        await mountInsideScroller()

        expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1)

        itemTop = 940
        scroller.dispatchEvent(new Event('scroll'))

        expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(2)
        expect(HTMLElement.prototype.scrollIntoView).toHaveBeenLastCalledWith({
          block: 'start',
          behavior: 'instant',
        })
      })

    it('re-aligns the card when the list above it resizes', async () => {
      await mountInsideScroller()

      itemTop = 640
      mocks.resizeObservers[0]!.callback()

      expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(2)
    })

    it('leaves the scroll alone while the card is already at the top',
      async () => {
        await mountInsideScroller()

        itemTop = 1
        scroller.dispatchEvent(new Event('scroll'))

        expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
      })

    it('stops re-aligning after the user scrolls', async () => {
      await mountInsideScroller()

      window.dispatchEvent(new Event('wheel'))
      itemTop = 940
      scroller.dispatchEvent(new Event('scroll'))

      expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
    })
  })

  it('stops aligning once the user interacts with the page', async () => {
    await expandDeepLinkedCard()

    const [resizeObserver] = mocks.resizeObservers

    window.dispatchEvent(new Event('wheel'))

    expect(resizeObserver!.disconnected).toBe(true)
  })

  it('stops aligning after the settle window', async () => {
    mocks.shouldAutoExpand = false
    mockRoute.query = { provider: 'openrouter' }

    await mountPage()
    vi.useFakeTimers()
    mocks.expandCard.openrouter!()
    await nextTick()
    await nextTick()

    const [resizeObserver] = mocks.resizeObservers

    expect(resizeObserver!.disconnected).toBe(false)

    vi.advanceTimersByTime(2000)

    expect(resizeObserver!.disconnected).toBe(true)
  })

  it('stops aligning when the page unmounts', async () => {
    const wrapper = await expandDeepLinkedCard()

    wrapper.unmount()

    expect(mocks.resizeObservers[0]!.disconnected).toBe(true)
  })

  it('ignores expansion reports from cards other than the deep-linked one',
    async () => {
      mocks.shouldAutoExpand = false
      mockRoute.query = { provider: 'openrouter' }

      await mountPage()

      mocks.expandCard.vercel!()
      mocks.expandCard.google!()
      await nextTick()
      await nextTick()

      expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled()
    })

  it('ignores a collapse report for the deep-linked card', async () => {
    mocks.shouldAutoExpand = false
    mockRoute.query = { provider: 'openrouter' }

    await mountPage()

    mocks.expandCard.openrouter!(false)
    await nextTick()
    await nextTick()

    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled()
  })

  it('scrolls to the cloudflare gateway card once it has expanded',
    async () => {
      mocks.shouldAutoExpand = false
      mockRoute.query = { provider: 'cloudflare' }

      await mountPage()
      await nextTick()

      expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled()

      mocks.expandCard.cloudflare!()
      await nextTick()
      await nextTick()

      expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
    })

  it('does not scroll when the default Google card expands without a '
    + 'deep link', async () => {
    mocks.shouldAutoExpand = false
    keyState.hasAnyKey = false
    keyState.googleStatus = 'missing'

    await mountPage()
    mocks.expandCard.google!()
    await nextTick()
    await nextTick()

    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled()
  })

  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty'])(
    'ignores the inherited object key %s as a provider id',
    async (providerParam) => {
      mockRoute.query = { provider: providerParam }

      const wrapper = await mountPage()

      expect(wrapper.get('[data-testid="key-tab-providers"]').classes())
        .toContain('tab-active')
      wrapper.findAll('[data-testid="provider-card"]').forEach((card: any) => {
        expect(card.attributes('data-open')).toBe('false')
      })
      expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled()
    })

  it('lets the provider query win over the tab query', async () => {
    mockRoute.query = { provider: 'openrouter', tab: 'search' }

    const wrapper = await mountPage()

    expect(wrapper.get('[data-testid="key-tab-gateways"]').classes())
      .toContain('tab-active')
  })

  it('ignores an unknown provider id', async () => {
    mockRoute.query = { provider: 'not-a-provider' }

    const wrapper = await mountPage()

    expect(wrapper.get('[data-testid="key-tab-providers"]').classes())
      .toContain('tab-active')
    wrapper.findAll('[data-testid="provider-card"]').forEach((card: any) => {
      expect(card.attributes('data-open')).toBe('false')
    })
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled()
  })

  it('still honours the tab query without a provider', async () => {
    mockRoute.query = { tab: 'search' }

    const wrapper = await mountPage()

    expect(wrapper.get('[data-testid="key-tab-search"]').classes())
      .toContain('tab-active')
    expect(cardOpenState(wrapper, 'brave')).toBe('false')
  })

  it('renders the default Google card open on the first render when keys '
    + 'are already cached (in-app navigation)', async () => {
    keyState.hasAnyKey = false
    keyState.googleStatus = 'missing'

    await mountPage()

    expect(mocks.openAtMount.google).toBe(true)
  })

  it('defers the default Google card until after hydration, even when '
    + 'keys are already cached', async () => {
    const nuxtApp = useNuxtApp()

    nuxtApp.isHydrating = true
    keyState.hasAnyKey = false
    keyState.googleStatus = 'missing'

    try {
      const wrapper = await mountPage()

      expect(mocks.openAtMount.google).toBe(false)
      expect(cardOpenState(wrapper, 'google')).toBe('true')
    } finally {
      nuxtApp.isHydrating = false
    }
  })

  it('renders an explicit deep link open on the first render, even while '
    + 'hydrating', async () => {
    const nuxtApp = useNuxtApp()

    nuxtApp.isHydrating = true
    mockRoute.query = { provider: 'openrouter' }

    try {
      await mountPage()

      expect(mocks.openAtMount.openrouter).toBe(true)
    } finally {
      nuxtApp.isHydrating = false
    }
  })

  it('expands the Google card once keys resolve with none saved',
    async () => {
      const wrapper = await mountPage()

      expect(cardOpenState(wrapper, 'google')).toBe('false')

      keyState.googleStatus = 'missing'
      keyState.hasAnyKey = false
      await nextTick()

      expect(cardOpenState(wrapper, 'google')).toBe('true')
      expect(wrapper.get('[data-testid="key-tab-providers"]').classes())
        .toContain('tab-active')
    })

  it('leaves every card collapsed when the user already has a key',
    async () => {
      const wrapper = await mountPage()

      keyState.googleStatus = 'saved'
      keyState.hasAnyKey = true
      await nextTick()

      expect(cardOpenState(wrapper, 'google')).toBe('false')
    })

  it('does not expand the default card while keys are still loading',
    async () => {
      keyState.hasAnyKey = false
      keyState.googleStatus = 'unknown'

      const wrapper = await mountPage()

      expect(cardOpenState(wrapper, 'google')).toBe('false')
    })

  it('does not override an explicit tab with the default card', async () => {
    mockRoute.query = { tab: 'search' }
    keyState.googleStatus = 'missing'
    keyState.hasAnyKey = false

    const wrapper = await mountPage()

    expect(cardOpenState(wrapper, 'google')).toBe('false')
    expect(wrapper.get('[data-testid="key-tab-search"]').classes())
      .toContain('tab-active')
  })
})
