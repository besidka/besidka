import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebSearchOption } from '../../../../app/types/web-search'
import ToolbarMore from '../../../../app/components/ChatInput/ToolbarMore.client.vue'

const mocks = vi.hoisted(() => ({
  useDevice: vi.fn(),
}))

mockNuxtImport('useDevice', () => mocks.useDevice)

const webSearchOptions: WebSearchOption[] = [
  { value: 'web_search', label: 'Model\'s built-in search', enabled: true },
  {
    value: 'web_search_brave',
    label: 'Brave Search',
    providerId: 'brave',
    enabled: true,
  },
  {
    value: 'web_search_exa',
    label: 'Exa',
    providerId: 'exa',
    enabled: false,
    disabledReason: 'Add an Exa key in Search providers.',
  },
]

function mountToolbarMore(props: Record<string, unknown> = {}) {
  return mountSuspended(ToolbarMore, {
    props: {
      isWebSearchSupported: true,
      isToolCallingSupported: true,
      webSearchOptions,
      selectedWebSearchProvider: 'off',
      ...props,
    },
    attachTo: document.body,
  })
}

describe('ChatInput/ToolbarMore', () => {
  beforeEach(() => {
    mocks.useDevice.mockReturnValue({
      isIos: false,
      isAndroid: false,
      isDesktop: true,
    })
  })

  it('renders the web search options in the mobile overflow menu',
    async () => {
      const wrapper = await mountToolbarMore()

      expect(wrapper.text()).toContain('Web search')
      expect(wrapper.text()).toContain('Brave Search')
      expect(wrapper.text()).toContain('Exa')
    })

  it('does not render the web search section when neither native search '
    + 'nor tool calling is supported', async () => {
    const wrapper = await mountToolbarMore({
      isWebSearchSupported: false,
      isToolCallingSupported: false,
    })

    expect(wrapper.text()).not.toContain('Web search')
  })

  it('does not render the web search section for a deep research model',
    async () => {
      const wrapper = await mountToolbarMore({
        isDeepResearchModel: true,
      })

      expect(wrapper.text()).not.toContain('Web search')
    })

  it('emits select-web-search-provider when an option is chosen',
    async () => {
      const wrapper = await mountToolbarMore()

      const buttons = wrapper.findAll('li > button')
      const braveButton = buttons.find((button) => {
        return button.text().includes('Brave Search')
      })

      await braveButton?.trigger('click')

      expect(wrapper.emitted('select-web-search-provider')).toEqual([
        ['web_search_brave'],
      ])
    })

  it('does not emit for a disabled web search option', async () => {
    const wrapper = await mountToolbarMore()

    const buttons = wrapper.findAll('li > button')
    const exaButton = buttons.find((button) => {
      return button.text().includes('Exa')
    })

    await exaButton?.trigger('click')

    expect(wrapper.emitted('select-web-search-provider')).toBeUndefined()
  })

  it('lights the overflow badge when a web search provider is active',
    async () => {
      const wrapper = await mountToolbarMore({
        isWebSearchEnabled: true,
      })

      expect(
        wrapper.find('.indicator-item.badge-accent').exists(),
      ).toBe(true)
    })

  it('does not light the overflow badge with nothing active', async () => {
    const wrapper = await mountToolbarMore()

    expect(
      wrapper.find('.indicator-item.badge-accent').exists(),
    ).toBe(false)
  })

  it('emits toggle-image-generation from the create-image toggle',
    async () => {
      const wrapper = await mountToolbarMore({
        isImageGenerationSupported: true,
      })

      await wrapper.get('input[type="checkbox"][aria-label="Create image"]')
        .trigger('change')

      expect(wrapper.emitted('toggle-image-generation')).toHaveLength(1)
    })

  it('emits open-files-select from the attach files item', async () => {
    const wrapper = await mountToolbarMore()

    const attachButton = wrapper.findAll('li > button').find((button) => {
      return button.text().includes('Attach files')
    })

    await attachButton?.trigger('click')

    expect(wrapper.emitted('open-files-select')).toHaveLength(1)
  })
})
