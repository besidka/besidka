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

function braveOption(enabled = true): WebSearchOption {
  return {
    value: 'web_search_brave',
    label: 'Brave Search',
    providerId: 'brave',
    enabled,
    disabledReason: enabled
      ? undefined
      : 'Add a Brave Search key in Search Providers.',
  }
}

function exaOption(enabled = true): WebSearchOption {
  return {
    value: 'web_search_exa',
    label: 'Exa',
    providerId: 'exa',
    enabled,
    disabledReason: enabled
      ? undefined
      : 'Add an Exa key in Search Providers.',
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

  it('does not emit when a disabled option is clicked, and shows the '
    + 'disabled reason as a title', async () => {
    const { wrapper, selectedProviders } = await mountMenuItems({
      selected: 'off',
      options: [nativeOption(), braveOption(false), exaOption()],
      isToolCallingSupported: true,
    })

    const buttons = optionButtons(wrapper)
    const braveButton = buttons.find((button) => {
      return optionLabel(button) === 'Brave Search'
    })

    await braveButton?.trigger('click')

    expect(selectedProviders).toEqual([])
    expect(braveButton?.attributes('title')).toBe(
      'Add a Brave Search key in Search Providers.',
    )
    expect(braveButton?.attributes('disabled')).toBeDefined()
  })

  it('links to /profile/keys under a disabled external option', async () => {
    const { wrapper } = await mountMenuItems({
      selected: 'off',
      options: [nativeOption(), braveOption(false), exaOption()],
      isToolCallingSupported: true,
    })

    const link = wrapper.find('a[to="/profile/keys"]')

    expect(link.exists()).toBe(true)
    expect(link.text()).toBe('Add a key')
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
