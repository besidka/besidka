import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import type { VueWrapper } from '@vue/test-utils'
import type {
  WebSearchOption,
  WebSearchSelection,
} from '../../../../app/types/web-search'
import WebSearchMenuItems from '../../../../app/components/ChatInput/WebSearchMenuItems.vue'

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
}): Promise<{ wrapper: VueWrapper, selectedProviders: WebSearchSelection[] }> {
  const selectedProviders: WebSearchSelection[] = []

  const host = defineComponent({
    setup() {
      return () => h('ul', [
        h(WebSearchMenuItems, {
          selected: props.selected,
          options: props.options,
          isToolCallingSupported: props.isToolCallingSupported,
          onSelectProvider: (value: WebSearchSelection) => {
            selectedProviders.push(value)
          },
        }),
      ])
    },
  })

  const wrapper = await mountSuspended(host)

  return { wrapper, selectedProviders }
}

function optionButtons(wrapper: VueWrapper) {
  return wrapper.findAll('li > button')
}

function optionLabel(button: ReturnType<typeof optionButtons>[number]) {
  return button.find(':scope > span:last-child').text()
}

describe('ChatInput/WebSearchMenuItems', () => {
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
    expect(braveLink.classes()).not.toContain('text-warning')

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
})
