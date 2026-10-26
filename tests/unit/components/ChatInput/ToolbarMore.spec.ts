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
    label: 'Add Exa key',
    providerId: 'exa',
    enabled: false,
    addKeyHref: '/profile/keys?tab=search',
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

  it('orders reasoning above web search above attach files, with a '
    + 'single divider between them', async () => {
    const wrapper = await mountToolbarMore({
      isReasoningSupported: true,
      reasoning: 'off',
      levels: ['low', 'medium', 'high'],
    })

    const text = wrapper.text()
    const reasoningIndex = text.indexOf('Reasoning effort')
    const webSearchIndex = text.indexOf('Web search')
    const attachFilesIndex = text.indexOf('Attach files')

    expect(reasoningIndex).toBeGreaterThanOrEqual(0)
    expect(webSearchIndex).toBeGreaterThan(reasoningIndex)
    expect(attachFilesIndex).toBeGreaterThan(webSearchIndex)
    expect(wrapper.findAll('.divider')).toHaveLength(1)
  })

  it('keeps a single divider and web search above attach files when '
    + 'reasoning is not supported', async () => {
    const wrapper = await mountToolbarMore()

    const text = wrapper.text()
    const webSearchIndex = text.indexOf('Web search')
    const attachFilesIndex = text.indexOf('Attach files')

    expect(webSearchIndex).toBeGreaterThanOrEqual(0)
    expect(attachFilesIndex).toBeGreaterThan(webSearchIndex)
    expect(wrapper.findAll('.divider')).toHaveLength(1)
  })

  it('renders no divider when neither reasoning nor web search is '
    + 'present', async () => {
    const wrapper = await mountToolbarMore({
      isWebSearchSupported: false,
      isToolCallingSupported: false,
    })

    expect(wrapper.findAll('.divider')).toHaveLength(0)
  })

  it('does not render the web search section for a deep research model',
    async () => {
      const wrapper = await mountToolbarMore({
        isDeepResearchModel: true,
      })

      expect(wrapper.text()).not.toContain('Web search')
    })

  it('does not render the web search section when image generation is '
    + 'required, even before it has been enabled', async () => {
    const wrapper = await mountToolbarMore({
      isImageGenerationRequired: true,
      isImageGenerationEnabled: false,
    })

    expect(wrapper.text()).not.toContain('Web search')
  })

  it('does not render the reasoning section when image generation is '
    + 'required, even before it has been enabled', async () => {
    const wrapper = await mountToolbarMore({
      isReasoningSupported: true,
      reasoning: 'off',
      levels: ['low', 'medium', 'high'],
      isImageGenerationRequired: true,
      isImageGenerationEnabled: false,
    })

    expect(wrapper.text()).not.toContain('Reasoning effort')
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

  it('shows the Exa search level section only when Exa is selected, '
    + 'with the passed level active', async () => {
    const wrapper = await mountToolbarMore()

    expect(wrapper.find('[data-testid^="exa-search-level-"]').exists())
      .toBe(false)

    const exaWrapper = await mountToolbarMore({
      selectedWebSearchProvider: 'web_search_exa',
      exaSearchLevel: 'deep',
    })

    expect(exaWrapper.text()).toContain('Depth')
    expect(
      exaWrapper.get('[data-testid="exa-search-level-deep"]').classes(),
    ).toContain('bg-accent')
    expect(
      exaWrapper.get('[data-testid="exa-search-level-auto"]').classes(),
    ).not.toContain('bg-accent')
  })

  it('re-emits select-exa-search-level when a level is chosen',
    async () => {
      const wrapper = await mountToolbarMore({
        selectedWebSearchProvider: 'web_search_exa',
      })

      await wrapper
        .get('[data-testid="exa-search-level-lite"]')
        .trigger('click')

      expect(wrapper.emitted('select-exa-search-level')).toEqual([
        ['lite'],
      ])
      expect(wrapper.emitted('select-web-search-provider'))
        .toBeUndefined()
    })

  it('renders a single add-key link for a provider without a key, '
    + 'instead of a disabled option', async () => {
    const wrapper = await mountToolbarMore()

    const exaLink = wrapper.find('a[to="/profile/keys?tab=search"]')

    expect(exaLink.exists()).toBe(true)
    expect(exaLink.text()).toContain('Add Exa key')
    expect(exaLink.classes()).not.toContain('link')
    expect(exaLink.classes()).toContain('text-warning')

    await exaLink.trigger('click')

    expect(wrapper.emitted('select-web-search-provider')).toBeUndefined()

    const exaButtons = wrapper.findAll('li > button').filter((button) => {
      return button.text().includes('Exa')
    })

    expect(exaButtons).toHaveLength(0)
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

  it('shows a checked, disabled reasoning toggle and no effort levels for '
    + 'an always-on model', async () => {
    const wrapper = await mountToolbarMore({
      isReasoningSupported: false,
      isReasoningAlwaysOn: true,
      isReasoningActive: true,
      reasoning: 'off',
      levels: [],
    })

    const row = wrapper.get('[data-testid="reasoning-always-on-menu-item"]')
    const toggle = row.get('input[type="checkbox"]')

    expect(row.text()).toContain('Reasoning')
    expect((toggle.element as HTMLInputElement).checked).toBe(true)
    expect(toggle.attributes('disabled')).toBeDefined()
    expect(toggle.attributes('aria-label'))
      .toBe('Reasoning is always on for this model')
    expect(wrapper.text()).not.toContain('Reasoning effort')
    expect(wrapper.emitted('select-reasoning-level')).toBeUndefined()
  })

  it('lights the overflow badge for an always-on reasoning model',
    async () => {
      const wrapper = await mountToolbarMore({
        isReasoningAlwaysOn: true,
        isReasoningActive: true,
      })

      expect(
        wrapper.find('.indicator-item.badge-accent').exists(),
      ).toBe(true)
    })

  it('hides the always-on reasoning row while image generation is '
    + 'required', async () => {
    const wrapper = await mountToolbarMore({
      isReasoningAlwaysOn: true,
      isImageGenerationSupported: true,
      isImageGenerationEnabled: true,
      isImageGenerationRequired: true,
    })

    expect(
      wrapper.find('[data-testid="reasoning-always-on-menu-item"]').exists(),
    ).toBe(false)
  })

  it('offers the memory exclusion only when the page binds it', async () => {
    const withoutModel = await mountToolbarMore()

    expect(withoutModel
      .find('[data-testid="new-chat-memory-exclusion-menu-item"]')
      .exists()).toBe(false)

    const withModel = await mountToolbarMore({ memoryExcluded: false })
    const toggle = withModel
      .get('[data-testid="new-chat-memory-exclusion-menu-item"]')

    expect(withModel.text()).toContain('Don\'t use this chat for memory')
    expect((toggle.element as HTMLInputElement).checked).toBe(false)

    await toggle.setValue(true)

    expect(withModel.emitted('toggle-memory-excluded')).toHaveLength(1)
  })

  it('marks the menu active while the chat is excluded from memory',
    async () => {
      const wrapper = await mountToolbarMore({
        isWebSearchSupported: false,
        memoryExcluded: true,
      })

      expect(wrapper.find('.indicator-item.badge-accent').exists()).toBe(true)
    })
})
