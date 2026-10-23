import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import type { VueWrapper } from '@vue/test-utils'
import type { ExaSearchLevel } from '#shared/utils/exa-search-level'
import type {
  WebSearchOption,
  WebSearchSelection,
} from '../../../../app/types/web-search'
import WebSearchMenuItems from '../../../../app/components/ChatInput/WebSearchMenuItems.vue'

const mocks = vi.hoisted(() => ({
  exaRates: {} as Record<string, string>,
}))

mockNuxtImport('useRuntimeConfig', () => {
  return () => ({
    app: { baseURL: '/' },
    public: { ...mocks.exaRates },
  })
})

function nativeOption(enabled = true): WebSearchOption {
  return {
    value: 'web_search',
    label: 'Model\'s built-in search',
    enabled,
    disabledReason: enabled
      ? undefined
      : 'This model has no built-in web search.',
  }
}

function braveOption(hasKey = true): WebSearchOption {
  if (hasKey) {
    return {
      value: 'web_search_brave',
      label: 'Brave Search',
      providerId: 'brave',
      enabled: true,
    }
  }

  return {
    value: 'web_search_brave',
    label: 'Add Brave Search key',
    providerId: 'brave',
    enabled: false,
    addKeyHref: '/profile/keys?tab=search',
  }
}

function exaOption(hasKey = true): WebSearchOption {
  if (hasKey) {
    return {
      value: 'web_search_exa',
      label: 'Exa',
      providerId: 'exa',
      enabled: true,
    }
  }

  return {
    value: 'web_search_exa',
    label: 'Add Exa key',
    providerId: 'exa',
    enabled: false,
    addKeyHref: '/profile/keys?tab=search',
  }
}

async function mountMenuItems(props: {
  selected: WebSearchSelection
  options: WebSearchOption[]
  isToolCallingSupported: boolean
  exaSearchLevel?: ExaSearchLevel
}): Promise<{
  wrapper: VueWrapper
  selectedProviders: WebSearchSelection[]
  selectedLevels: ExaSearchLevel[]
}> {
  const selectedProviders: WebSearchSelection[] = []
  const selectedLevels: ExaSearchLevel[] = []

  const host = defineComponent({
    setup() {
      return () => h('ul', [
        h(WebSearchMenuItems, {
          selected: props.selected,
          options: props.options,
          isToolCallingSupported: props.isToolCallingSupported,
          exaSearchLevel: props.exaSearchLevel,
          onSelectProvider: (value: WebSearchSelection) => {
            selectedProviders.push(value)
          },
          onSelectExaSearchLevel: (level: ExaSearchLevel) => {
            selectedLevels.push(level)
          },
        }),
      ])
    },
  })

  const wrapper = await mountSuspended(host)

  return { wrapper, selectedProviders, selectedLevels }
}

function optionButtons(wrapper: VueWrapper) {
  return wrapper.findAll('li > button')
}

function optionLabel(button: ReturnType<typeof optionButtons>[number]) {
  return button.find(':scope > span:last-child').text()
}

function externalRowTexts(wrapper: VueWrapper): string[] {
  return wrapper.findAll('li > button, li > a')
    .map((row) => {
      const label = row.find('span.grow')

      return label.exists() ? label.text() : ''
    })
    .filter(text => text.includes('Brave') || text.includes('Exa'))
}

function rowLi(wrapper: VueWrapper, text: string) {
  return wrapper.findAll('li').find((li) => {
    return li.text().includes(text)
  })
}

describe('ChatInput/WebSearchMenuItems', () => {
  beforeEach(() => {
    mocks.exaRates = {}
  })

  it('renders Off, native search, Brave and Exa in that order', async () => {
    const { wrapper } = await mountMenuItems({
      selected: 'off',
      options: [nativeOption(), braveOption(), exaOption()],
      isToolCallingSupported: true,
    })

    const buttons = optionButtons(wrapper)

    expect(buttons.map(optionLabel)).toEqual([
      'Off',
      'Model\'s built-in search',
      'Brave Search',
      'Exa',
    ])
  })

  it('renders every option icon at a fixed size', async () => {
    const { wrapper } = await mountMenuItems({
      selected: 'off',
      options: [nativeOption(), braveOption(), exaOption()],
      isToolCallingSupported: true,
    })

    const icons = wrapper.findAll('.iconify')

    expect(icons.length).toBeGreaterThan(0)
    icons.forEach((icon) => {
      expect(icon.classes()).toContain('!size-4')
    })
  })

  it('marks the currently selected option active', async () => {
    const { wrapper } = await mountMenuItems({
      selected: 'web_search_brave',
      options: [nativeOption(), braveOption(), exaOption()],
      isToolCallingSupported: true,
    })

    const buttons = optionButtons(wrapper)
    const braveButton = buttons.find((button) => {
      return optionLabel(button) === 'Brave Search'
    })

    expect(braveButton?.classes()).toContain('bg-accent')
    expect(braveButton?.classes()).toContain('pointer-events-none')
  })

  it('emits the selected value when an enabled option is clicked', async () => {
    const { wrapper, selectedProviders } = await mountMenuItems({
      selected: 'off',
      options: [nativeOption(), braveOption(), exaOption()],
      isToolCallingSupported: true,
    })

    const buttons = optionButtons(wrapper)
    const exaButton = buttons.find((button) => {
      return optionLabel(button) === 'Exa'
    })

    await exaButton?.trigger('click')

    expect(selectedProviders).toEqual(['web_search_exa'])
  })

  it('renders a single add-key link instead of a disabled option when a '
    + 'provider has no key', async () => {
    const { wrapper, selectedProviders } = await mountMenuItems({
      selected: 'off',
      options: [nativeOption(), braveOption(false), exaOption()],
      isToolCallingSupported: true,
    })

    const braveLink = wrapper.find('a[to="/profile/keys?tab=search"]')

    expect(braveLink.exists()).toBe(true)
    expect(braveLink.text()).toContain('Add Brave Search key')
    expect(braveLink.classes()).not.toContain('link')
    expect(braveLink.classes()).toContain('text-warning')

    await braveLink.trigger('click')

    expect(selectedProviders).toEqual([])

    const braveButtons = optionButtons(wrapper).filter((button) => {
      return button.text().includes('Brave')
    })

    expect(braveButtons).toHaveLength(0)
  })

  it('shows the normal provider icon on the add-key link, not a faded '
    + 'one', async () => {
    const { wrapper } = await mountMenuItems({
      selected: 'off',
      options: [nativeOption(), braveOption(false), exaOption()],
      isToolCallingSupported: true,
    })

    const braveLink = wrapper.find('a[to="/profile/keys?tab=search"]')

    expect(braveLink.classes()).not.toContain('opacity-50')
    expect(braveLink.find('.iconify').classes()).not.toContain('opacity-50')
  })

  it('collapses Brave and Exa into a single explanatory line when the '
    + 'model cannot call tools', async () => {
    const { wrapper } = await mountMenuItems({
      selected: 'off',
      options: [nativeOption(), braveOption(false), exaOption(false)],
      isToolCallingSupported: false,
    })

    expect(wrapper.text()).toContain(
      'does not support tool calling',
    )

    const buttons = optionButtons(wrapper)
    const labels = buttons.map(optionLabel)

    expect(labels).not.toContain('Brave Search')
    expect(labels).not.toContain('Exa')
  })

  it('orders keyless providers after keyed ones with a divider before '
    + 'the first keyless row', async () => {
    const { wrapper } = await mountMenuItems({
      selected: 'off',
      options: [nativeOption(), braveOption(false), exaOption(false)],
      isToolCallingSupported: true,
    })

    expect(externalRowTexts(wrapper)).toEqual([
      'Add Brave Search key',
      'Add Exa key',
    ])

    expect(rowLi(wrapper, 'Add Brave Search key')?.classes())
      .toContain('border-t')
    expect(rowLi(wrapper, 'Add Exa key')?.classes())
      .not.toContain('border-t')
  })

  it('moves a keyed Exa above a keyless Brave, with the divider on the '
    + 'now-first keyless row', async () => {
    const { wrapper } = await mountMenuItems({
      selected: 'off',
      options: [nativeOption(), braveOption(false), exaOption(true)],
      isToolCallingSupported: true,
    })

    expect(externalRowTexts(wrapper)).toEqual([
      'Exa',
      'Add Brave Search key',
    ])

    expect(rowLi(wrapper, 'Exa')?.classes()).not.toContain('border-t')
    expect(rowLi(wrapper, 'Add Brave Search key')?.classes())
      .toContain('border-t')
  })

  it('renders no divider when both external providers have a key',
    async () => {
      const { wrapper } = await mountMenuItems({
        selected: 'off',
        options: [nativeOption(), braveOption(true), exaOption(true)],
        isToolCallingSupported: true,
      })

      expect(externalRowTexts(wrapper)).toEqual(['Brave Search', 'Exa'])
      expect(rowLi(wrapper, 'Brave Search')?.classes())
        .not.toContain('border-t')
      expect(rowLi(wrapper, 'Exa')?.classes()).not.toContain('border-t')
    })

  it('renders the keyless row\'s icon and arrow with no color override, '
    + 'so both inherit the warning color from the link', async () => {
    const { wrapper } = await mountMenuItems({
      selected: 'off',
      options: [nativeOption(), braveOption(false), exaOption()],
      isToolCallingSupported: true,
    })

    const braveLink = wrapper.find('a[to="/profile/keys?tab=search"]')
    const icons = braveLink.findAll('.iconify')

    expect(braveLink.classes()).toContain('text-warning')
    icons.forEach((icon) => {
      icon.classes().forEach((className) => {
        expect(className.startsWith('text-')).toBe(false)
      })
    })
  })

  it('emits "off" when the Off item is clicked', async () => {
    const { wrapper, selectedProviders } = await mountMenuItems({
      selected: 'web_search',
      options: [nativeOption(), braveOption(), exaOption()],
      isToolCallingSupported: true,
    })

    const buttons = optionButtons(wrapper)
    const offButton = buttons.find((button) => {
      return optionLabel(button) === 'Off'
    })

    await offButton?.trigger('click')

    expect(selectedProviders).toEqual(['off'])
  })

  describe('Exa search level section', () => {
    const exaOptions = [nativeOption(), braveOption(), exaOption()]

    function levelButton(wrapper: VueWrapper, level: ExaSearchLevel) {
      return wrapper.get(`[data-testid="exa-search-level-${level}"]`)
    }

    it('is hidden unless Exa is the selected provider', async () => {
      const { wrapper } = await mountMenuItems({
        selected: 'web_search_brave',
        options: exaOptions,
        isToolCallingSupported: true,
      })

      expect(wrapper.text()).not.toContain('Exa search level')
      expect(wrapper.find('[data-testid^="exa-search-level-"]').exists())
        .toBe(false)
    })

    it('is hidden when the model cannot call tools', async () => {
      const { wrapper } = await mountMenuItems({
        selected: 'web_search_exa',
        options: exaOptions,
        isToolCallingSupported: false,
      })

      expect(wrapper.text()).not.toContain('Exa search level')
      expect(wrapper.find('[data-testid^="exa-search-level-"]').exists())
        .toBe(false)
    })

    it('renders Lite, Auto and Deep under a titled section when Exa is '
      + 'selected', async () => {
      const { wrapper } = await mountMenuItems({
        selected: 'web_search_exa',
        options: exaOptions,
        isToolCallingSupported: true,
      })

      expect(wrapper.text()).toContain('Exa search level')

      const labels = wrapper
        .findAll('[data-testid^="exa-search-level-"]')
        .map(button => button.find('span.grow').text())

      expect(labels).toEqual(['Lite', 'Auto', 'Deep'])
    })

    it('marks only the current level active and defaults to Auto',
      async () => {
        const { wrapper } = await mountMenuItems({
          selected: 'web_search_exa',
          options: exaOptions,
          isToolCallingSupported: true,
        })

        expect(levelButton(wrapper, 'auto').classes())
          .toContain('bg-accent')
        expect(levelButton(wrapper, 'auto').classes())
          .toContain('pointer-events-none')
        expect(levelButton(wrapper, 'lite').classes())
          .not.toContain('bg-accent')
        expect(levelButton(wrapper, 'deep').classes())
          .not.toContain('bg-accent')
      })

    it('marks the passed level active', async () => {
      const { wrapper } = await mountMenuItems({
        selected: 'web_search_exa',
        options: exaOptions,
        isToolCallingSupported: true,
        exaSearchLevel: 'deep',
      })

      expect(levelButton(wrapper, 'deep').classes()).toContain('bg-accent')
      expect(levelButton(wrapper, 'auto').classes())
        .not.toContain('bg-accent')
    })

    it('shows each price from runtime config as a badge', async () => {
      mocks.exaRates = {
        exaLiteSearchCostPerThousandRequestsUsd: '4',
        exaSearchCostPerThousandRequestsUsd: '7',
        exaDeepSearchCostPerThousandRequestsUsd: '12',
      }

      const { wrapper } = await mountMenuItems({
        selected: 'web_search_exa',
        options: exaOptions,
        isToolCallingSupported: true,
      })

      expect(levelButton(wrapper, 'lite').find('.badge').text())
        .toBe('$4/1k')
      expect(levelButton(wrapper, 'auto').find('.badge').text())
        .toBe('$7/1k')
      expect(levelButton(wrapper, 'deep').find('.badge').text())
        .toBe('$12/1k')
    })

    it('keeps the badge readable on the active accent background',
      async () => {
        mocks.exaRates = {
          exaSearchCostPerThousandRequestsUsd: '7',
        }

        const { wrapper } = await mountMenuItems({
          selected: 'web_search_exa',
          options: exaOptions,
          isToolCallingSupported: true,
        })

        expect(levelButton(wrapper, 'auto').find('.badge').classes())
          .toContain('text-accent-content')
      })

    it('hides a badge whose rate is missing or invalid', async () => {
      mocks.exaRates = {
        exaLiteSearchCostPerThousandRequestsUsd: '',
        exaSearchCostPerThousandRequestsUsd: '7',
        exaDeepSearchCostPerThousandRequestsUsd: 'not-a-number',
      }

      const { wrapper } = await mountMenuItems({
        selected: 'web_search_exa',
        options: exaOptions,
        isToolCallingSupported: true,
      })

      expect(levelButton(wrapper, 'lite').find('.badge').exists())
        .toBe(false)
      expect(levelButton(wrapper, 'auto').find('.badge').exists())
        .toBe(true)
      expect(levelButton(wrapper, 'deep').find('.badge').exists())
        .toBe(false)
    })

    it('gives each level a hint title', async () => {
      const { wrapper } = await mountMenuItems({
        selected: 'web_search_exa',
        options: exaOptions,
        isToolCallingSupported: true,
      })

      expect(levelButton(wrapper, 'lite').attributes('title'))
        .toBe('Fastest and cheapest')
      expect(levelButton(wrapper, 'auto').attributes('title'))
        .toBe('Balanced default')
      expect(levelButton(wrapper, 'deep').attributes('title'))
        .toBe('Multi-step research, slower')
    })

    it('emits the chosen level and not a provider change', async () => {
      const { wrapper, selectedLevels, selectedProviders }
        = await mountMenuItems({
          selected: 'web_search_exa',
          options: exaOptions,
          isToolCallingSupported: true,
        })

      await levelButton(wrapper, 'deep').trigger('click')
      await levelButton(wrapper, 'lite').trigger('click')

      expect(selectedLevels).toEqual(['deep', 'lite'])
      expect(selectedProviders).toEqual([])
    })
  })
})
